# Serena Launch — ChatGPT and Codex directory preparation

Status: preparation in progress. No official submission or publication has been confirmed.

This separate public-upload copy was derived from the owned private plugin `plugins_6aeaae871e388191b7cb548314554c40`, release `pluginrel_6aee6930b8648191a47cc68290a23b5f` (0.1.3). Its private source and audience have not been changed. The public package preserves the technical name `launch-archive` and uses Serena Launch as its display name.

## Prepared

- Portable plugin source with the existing remote OAuth MCP endpoint and skill.
- Creativity listing, existing popcorn branding, five positive cases and three negative boundary cases.
- Current catalog and tool metadata were verified through the official MCP SDK; that evidence is in `../claude/protocol-check.json`. This is not a ChatGPT native conversation test.
- Homepage, privacy policy and support page are live and content-verified. The support page was deployed as gallery Worker version `97dbe31a-092c-4783-8c22-95a8e35ab2c5`; only that new static page was uploaded. Terms still require owner approval and publication before their URL can be included.

## Remaining gates

1. Confirm the intended publisher identity, country targeting and current commerce declaration; confirm the matching verified identity in the intended OpenAI organization/project.
2. Review the proposed terms in `terms-draft.md` and publish the approved terms. Do not treat this draft as a published policy.
3. Rehearse the existing development plugin in ChatGPT, then record actual prompts, tool calls and results plus an unsupported rendering request. Verify the video and reviewer-accessible hosting before adding `review.demo_recording_url`.
4. Configure a dedicated reviewer account. Owner Google credentials must never be shared. Reviewers must not need access to Serena's mailbox, phone or social account.
5. Finalize, validate and inspect the ZIP. Upload only after preparation is complete (unless the owner explicitly requests an incomplete draft upload). Run the exact saved submission's connection, domain verification and review tests.
6. The authorized developer completes legal/policy attestations and final submission. An uploaded draft is not a submitted application; approval is not publication.

## Sources

- https://developers.openai.com/plugins/deploy/submission
- https://developers.openai.com/plugins/deploy/submission-errors

The ChatGPT and Codex public directory uses one submission path. No duplicate private plugin is needed.
