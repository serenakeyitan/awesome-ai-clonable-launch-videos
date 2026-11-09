# Connect your agent

Use Quick connect on the website, or send this to an agent that can configure MCP:

```text
Connect to Serena Launch MCP at https://serenatan.org/launchvideo/mcp.
```

For Claude chat, the copied prompt asks for one [Connect Serena Launch](https://serenatan.org/launchvideo/agent/connect/claude) link when setup is needed. This opens the prefilled connector flow after a click; it does not automatically register a connector or approve OAuth.

Chat apps may require you to add a connector in settings. Reading a setup guide or saving a skill does not install an MCP connection.

Remote MCP endpoint: **https://serenatan.org/launchvideo/mcp**. Streamable HTTP and read-only, with Clerk OAuth sign-in. Sign in and approve access in your client’s browser flow; never paste credentials into chat. The gallery and videos remain public.

| Client | Setup |
| --- | --- |
| Codex CLI | `codex mcp add serena-launch --url https://serenatan.org/launchvideo/mcp` |
| Claude Code | Quick connect opens the desktop app's Code composer with the setup prompt prefilled. Review and send it, then complete MCP setup and browser authorization. |
| Claude Desktop | Quick connect opens a desktop chat with the setup prompt prefilled. For the web connector dialog, use More → Claude web. Adding the connector and approving OAuth remain separate user actions. |
| ChatGPT | Plugins → + → Add custom MCP server. Enter the endpoint above, choose OAuth, create and install the plugin, then complete sign-in. Account and workspace policies apply. |
| Cursor | Add the JSON below to `.cursor/mcp.json`, preserving other servers. |
| Grok | https://grok.com/connectors → New Connector → Custom → enter the endpoint above. Organization admins may need to enable it. |
| Gemini CLI | Add `{"mcpServers":{"serena-launch":{"httpUrl":"https://serenatan.org/launchvideo/mcp"}}}` to Gemini settings, preserving existing settings. |
| VS Code | Run MCP: Add Server → HTTP → enter the endpoint above. |
| Raft / other agents | Send the setup prompt above. Use remote MCP settings if supported; otherwise explain that an MCP-capable client is required. |

```json
{"mcpServers":{"serena-launch":{"url":"https://serenatan.org/launchvideo/mcp"}}}
```

The same service has three read-only reference tools: `get_launch_context`, `search_launch_videos`, and `get_launch_video`, plus optional non-destructive `report_launch_task` for creation outcomes and explicit feedback. Call `get_launch_context` before each task. Every tool fetches the current catalog and workflow, returns their content version, and discovers styles dynamically. Search uses keywords, not a semantic embedding model. Equal keyword matches sort by record ID; browsing does not rank by popularity. Reference results include descriptive notes but omit exposure, engagement and legacy scores. Public gallery statistics remain unchanged.

Official use requires an authenticated MCP connection. If MCP is disconnected or unsupported, stop and guide setup; do not read public mirrors as a substitute. HTTP manifest, catalog and workflow routes require the same OAuth access token and scopes as MCP. Public SKILL.md only guides connection. The gallery and public repository remain browsable; authentication does not make already-public content private.

## Updating the library

The canonical source is this repository's `main` branch:

- Add or update references in `data/videos.json` and upload the corresponding playable media.
- Edit `agent/manifest.json` to add or rename editorial formats.
- Edit `agent/workflow.md` to change the current remake workflow.
- Run `python3 scripts/build_readme.py` and merge the changes to `main`.

The remote service resolves the current main commit through Git’s uncached ref advertisement, reads all three files at that same immutable revision, and computes a content hash. This avoids stale raw branch URLs and mixed revisions. New and existing connections see the published changes on their next tool call without editing the plugin or reinstalling. Website/media publication is still a separate deployment; use the current publishing workflow to keep its playable files in sync. Historical statistics do not become live merely because the catalog is refreshed.

The plugin contains only a stable setup/refresh bootstrap and endpoint. Changes to permissions, transport, tool contracts, or client UI capabilities may require an updated package or reconnect. A client that does not call a tool cannot receive fresh server content. Native UI connection on each named client is separate from protocol verification.

The landing-page source is in `site/`. Run `python3 scripts/build_site.py` to generate `site-dist/` with the current catalog and published media URLs. Initial hero totals and the All videos count are rendered from that same catalog snapshot, matching the client-side figures before JavaScript runs. The deployed gallery also retains its local reference assets for direct playback.

## Reading SKILL.md

The public SKILL.md endpoint returns a branded HTML reader for browser requests accepting `text/html`, including the Serena Launch favicon and shared site header. Agents using the default or Markdown Accept header still receive the original Markdown. Append `?raw=1` to force Markdown with any Accept header. Both views contain identical instructions, require no login and use `Cache-Control: no-store` with `Vary: Accept`.

## Updating instructions

`agent/workflow.md` is the single source for video-making instructions, reference inspection, fidelity, verification and request policy. Every `get_launch_context` response (and the other reference tools) loads it from the current main revision. Merging a workflow change makes it available on the next call, including on an existing connection; no Worker deployment or reconnect is required for that file.

Server instructions only direct the agent to fetch and follow that workflow. SKILL.md copies retain connection setup and the live-workflow handoff, without embedding production steps or numeric retry rules. The public SKILL.md route is served by the Worker, so changing its embedded bootstrap or server instructions requires a Worker deployment. Installed package text is not remotely rewritten, but existing bootstraps already request the live workflow before each task.

The MCP supplies references and instructions; the client performs inspection and rendering. Instructions cannot enforce an external agent's tool use or certify a 1:1 remake by themselves.

### Reference playback check

On November 8, 2026 (Pacific time), Sidehoe's published H.264/AAC MP4 was played end to end with Playwright 1.65.0 in headless bundled Chromium 158.0.8127.18 and installed Chrome 157.0.8103.38 (`channel: "chrome"`). Both reached 31.184399 seconds, decoded 778 frames and reported zero dropped frames. Seeking to 1, 8, 16, 24 and 30 seconds also succeeded. See the [measured report](../agent-service/verification/reference-playback-2026-11-08.json).

This verifies playback for that clip on this macOS environment, not every browser build or soundtrack quality; playback was muted. The workflow requires watching the reference and inspecting the result, leaving the inspection tools to the agent. [Playwright's browser documentation](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge) describes branded channels and codec differences.

## Service development

```bash
cd agent-service
npm ci
npm test
npm run dev
npm run verify:live # checks the deployed service with modern and legacy SDK clients
```

`npm run deploy` deploys the Cloudflare Worker. Fixed public source locations, bounded source reads and result limits keep this a read-only catalog service. Clerk stores account identity and verified email for authenticated MCP access. Login does not subscribe users to email updates. There is no paid gate or daily quota. See [Privacy](https://serenatan.org/launchvideo/privacy.html) and [auth rollout status](../agent-service/AUTH.md).

The agent service applies a shared short-term abuse throttle of approximately 120 HTTP requests per IP per 60 seconds across MCP and `/launchvideo/agent/*`, including preflight and unsuccessful requests. It uses Cloudflare's trusted `CF-Connecting-IP`, not user-supplied forwarding headers. Exceeding the limit returns JSON with HTTP `429` and `Retry-After: 60`; clients should back off rather than immediately retry. MCP POST bodies are capped at 64 KiB, including streamed bodies without a Content-Length. The website and video assets are served by a separate Worker and are outside this throttle. There is no daily allowance or paid quota. Cloudflare's native counters are approximate per edge location, so this is not a strict global quota, distributed-bot defense or billing cap. Shared proxy IPs also share this allowance until verified user identities are available. If the rate-limit binding is missing or fails, the service returns a retryable `503` instead of silently disabling protection.

Installation references: [Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Cursor](https://cursor.com/docs/mcp), [Grok](https://docs.x.ai/grok/connectors), [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/), [ChatGPT](https://developers.openai.com/plugins/quickstart).

## Verified update compatibility

The bootstrap SKILL.md and installed MCP URL stay fixed. Each invocation reads the current published main revision; it does not reuse an installed catalog snapshot.

| Change | Same setup and installed skill? | How it reaches the agent |
| --- | --- | --- |
| Add, edit or remove a video | Yes | The next tool call loads the current catalog. |
| Edit title, playable URL, notes or dated statistics | Yes | get_launch_video returns the current record. |
| Add styles, categories or format definitions | Yes | Current facets and the full format manifest are returned as data. |
| Add metadata fields | Yes | Full video details and the HTTP catalog expose additionalMetadata. |
| Add fields or nested structures to the manifest | Yes | The complete manifest is forwarded, including HTTP discovery links at the root. |
| Wrap the catalog in an object | Yes, for the supported videos envelope | Arrays and objects with a videos array are accepted; other envelope fields appear as catalogMetadata. |
| Change the remake workflow | Yes | Each tool response includes the current remote workflow. |
| Rename required video keys or change the major source schema | Requires a service adapter | Preserve the existing tool output and endpoint contracts for existing clients. Unsupported source schemas fail explicitly. |
| Rename MCP tools, change connection URLs or add permissions | Client-dependent | Preserve compatibility aliases or plan a client refresh/reconnect. |
| Change website layout | Website publication | Layout changes do not automatically define new MCP capabilities. |

Changes appear on the next read. Already-generated chat messages are not rewritten automatically. The seven SDK tests include both modern and legacy clients kept connected while synthetic catalog, manifest, workflow and structure changes are applied. Synthetic references stay in tests and are never published into the real collection.

The landing page shares the canonical site header at `/shared/site-header.js` and `/shared/site-header.css`, maintained in the portfolio project. `mediaQuality` records source/delivery dimensions and encoding provenance; it is visible to existing agent connections through `additionalMetadata`.

Existing client aliases such as `launch-archive` continue to work; do not add a duplicate server or reconnect solely to rename a local alias. New setup examples use `serena-launch`.

## OAuth migration

Existing unauthenticated installations must update to the OAuth plugin release and reconnect once. Approve the profile and email scopes in the browser. Future video, metadata and workflow updates still require no reinstall. A 401 means sign in or refresh authorization; a 403 means reconnect with the required scopes. Do not bypass these through the public HTTP catalog.

## Daily collection totals

The homepage compares the current collection against its previous-day closing totals in Pacific time. Additions and updated source snapshots contribute to the change; this is not daily traffic or same-post exposure growth. `scripts/build_readme.py` and `scripts/build_site.py` refresh `data/daily-stats.json`, preserving earlier dates. Unchanged days carry the last published totals forward; missing baselines stay unavailable.

## Product analytics

See [measurement definitions](measurement.md). Explicit browser and authenticated MCP events feed PostHog; no raw queries, prompts, email, OAuth parameters or session recordings. Task completion is agent-reported, with separate delivery checks. Authentication remains required for all MCP tools. Public-directory submission drafts must describe the reporting tool before any future resubmission.
