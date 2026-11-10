# Telemetry and privacy

Telemetry defaults on when no preference has been saved; explicit opt-outs remain off. OAuth Allow/Deny still posts natively and does not authorize a recorder. A preference is not an active recording: a supported local recorder must also be connected and select a session.

## User journey

1. Open https://serenatan.org/launchvideo/sharing and sign in.
2. Review Telemetry and Privacy (turn it off at any time). Download `agent/recorder.mjs` from this repository (Node 22+).
3. Run `node serena-recorder.mjs connect --client claude-code` (or `codex`). Open the displayed site URL, compare the code, approve the recorder. No API key or token is pasted into chat.
4. Claude Code: run `node serena-recorder.mjs install-claude --project .`. Hooks preserve existing project configuration; recording begins only when that project session calls the configured Serena Launch MCP server (default name `serena-launch`, override with `--server NAME`). The entire selected conversation's user/AI text, including preceding messages in that session, is shared. Use a dedicated video-making conversation.
5. Codex: select one native JSONL rollout using `node serena-recorder.mjs record --client codex --file /path/to/session.jsonl`. Ctrl+C stops it. Add `--once` to import a finished source snapshot. No directory scanning or blanket Codex-app access.
6. View text, stop uploads, disconnect devices or delete recordings in Telemetry settings. Off stops new uploads; existing records remain until the user deletes them.

Claude/ChatGPT ordinary web chats cannot supply a whole transcript through a remote MCP connection. Their connector-only sessions are not recorded. No workflow prompt asks the agent to reconstruct or transmit a chat.

## Data and access

- R2 bucket `serena-launch-conversations`: private immutable text chunks. No public access or custom domain. Message text is verbatim, without redaction or summarization, and may itself contain sensitive information.
- D1 `serena-launch-conversations`: consent version/revision, hashed device credentials, session/task/reference IDs, sequence numbers and chunk hashes. Preferences survive sign-out. Client authorizations expire after 90 days; unapproved connection codes expire in ten minutes.
- Browser API accepts verified Clerk **session** tokens from the site's authorized origin. Existing MCP OAuth tokens cannot read recordings. Recorder credentials can only upload sessions belonging to that device/account; they cannot read stored conversations or change consent.
- Users read/delete their records. The existing `ANALYTICS_INTERNAL_USER_ID` account can review all authorized sessions in Team view. No role can expose R2 keys as a public URL. Page rendering uses React escaped text, never raw HTML/Markdown execution.
- Raw text is not sent to PostHog, the catalog, tool responses or application logs. PostHog receives sharing enabled/disabled, session started/finished/deleted, opaque session/task IDs and the client/status only.
- Conversation text is retained until the user explicitly deletes it. There is no automatic age-based deletion or expiry filter, and R2 must have no object-expiration rule for `sessions/`. The hourly job only retries explicitly requested deletions (100 per pass) and removes expired device authorizations. Failed deletion leaves a tombstone and is retried; the owner cannot read a tombstoned record. The legacy session `expires_at` column is unused by retention and set to the maximum safe integer for compatibility with older deployments. Cloudflare backups have their own retention.

## Fidelity and operational limits

Native user/assistant text blocks are copied directly. Newlines, spaces, Unicode and code remain unchanged. Native ask-user questions and responses are preserved as their original payload text. Thinking/system messages and other tool outputs are excluded; images/files are not uploaded. This release covers native text-message and supported ask-user records, not every platform-specific interactive UI or hidden history. Source-complete means the available source snapshot was synced, not independent proof that a host exposed all history.

The collector retains an exact pending chunk locally before upload. Sequence + SHA-256 acknowledgements make retries idempotent; missing sequences/conflicting content are rejected. Source rewriting, malformed JSON/UTF-8 and oversized messages stop collection explicitly instead of truncating or guessing. An unterminated line waits until complete, or is parsed at a finished-snapshot import. Native logs and any unsent local chunk remain on the user's computer after server-side deletion.

A selected live session stops on session end, explicit interruption, revocation, or a six-hour maximum. Reopening a closed shared source requires a new selected conversation. If the terminal/source file disappears or is rewritten, no complete label is asserted. A local hook can fail without blocking the AI task; the server's session status/last update is the recording evidence.

## Verification

`npm test` in `agent-service` exercises actual local D1/R2 bindings through Miniflare plus source adapters and the authenticated route logic. Test fixtures are synthetic; no user's real conversation is uploaded by the suite. The frontend tests ensure sharing choice does not submit/intercept the OAuth form. `wrangler deploy --dry-run` verifies deployment packaging/bindings, not browser authorization.
