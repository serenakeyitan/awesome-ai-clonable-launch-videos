# Serena Launch — ChatGPT and Codex directory preparation

The current source package and `serena-launch-public-draft-0.1.6.zip` remove anonymous fallback and require the authenticated MCP connection. Historical draft archives and submission receipts are retained as records, not current install instructions. This package update does not submit or change a directory application.

Status: preparation in progress. No official submission or publication has been confirmed.

This separate public-upload copy was derived from the owned private plugin `plugins_6aeaae871e388191b7cb548314554c40`, release `pluginrel_6aee6930b8648191a47cc68290a23b5f` (0.1.3). The private plugin was subsequently updated to 0.1.4 for naming consistency (release `pluginrel_6af152c2a1dc819182d97af6d027df47`): its skill is now `serena-launch`, with Serena Launch display metadata. Its existing identity, audience, MCP configuration and avatars are preserved. Private release 0.1.5 (`pluginrel_6af1661eec8c8191a9ceda2b67dc7c5f`) subsequently adds the one-link Claude setup handoff; its connection and presentation remain unchanged. The public package preserves the technical name `launch-archive` and uses Serena Launch as its display name.

## Prepared

- Portable plugin source with the existing remote OAuth MCP endpoint and skill.
- Creativity listing, existing popcorn branding, five positive cases and three negative boundary cases.
- The owner clarified that the enlarged-popcorn illustration is for the plugin application, not the website. Both `logo` and `composerIcon` use this submission-only avatar. The website's original mascot and framing are restored; the existing private plugin and Clerk account-portal logo are unchanged.
- Current catalog and tool metadata were verified through the official MCP SDK; that evidence is in `../claude/protocol-check.json`. This is not a ChatGPT native conversation test.
- Homepage, privacy policy, support and owner-approved terms pages are live and content-verified. Support was deployed as gallery Worker version `97dbe31a-092c-4783-8c22-95a8e35ab2c5`; terms were deployed as `f1c833ce-ca71-44ea-9d95-084e68521dba`. Each deployment added only its respective static page.
- The owner confirmed an individual publisher, Serena Tan, all available countries, current free access without commerce, Personal organization, and base terms for users aged 13 and older. The package records this targeting and commerce declaration.
- A dedicated reviewer account is provisioned. Access instructions remain outside the repository and ZIP; reviewer mailbox sign-in has not been verified.

## Remaining gates

1. Complete individual identity verification in the confirmed OpenAI Personal organization, Default project. The dashboard showed Individual “Start” and opened a Persona identity-check handoff; the owner must complete it.
2. The four required listing URLs are complete. Their live content checks are in `url-checks.json`.
3. Rehearse the existing development plugin in ChatGPT, then record actual prompts, tool calls and results plus an unsupported rendering request. Verify the video and reviewer-accessible hosting before adding `review.demo_recording_url`.
4. Verify the dedicated reviewer mailbox sign-in. Owner Google credentials must never be shared. Reviewers must not need access to Serena's mailbox, phone or social account.
5. Finalize, validate and inspect the ZIP. Upload only after preparation is complete (unless the owner explicitly requests an incomplete draft upload). Run the exact saved submission's connection, domain verification and review tests.
6. The authorized developer completes legal/policy attestations and final submission. An uploaded draft is not a submitted application; approval is not publication.

## Sources

- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/deploy/submission-errors

The ChatGPT and Codex public directory uses one submission path. No duplicate private plugin is needed.
