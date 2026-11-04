# Connect your agent

Send this to an agent with web access:

```text
set up https://serenatan.org/launchvideo/agent/SKILL.md
```

Remote MCP endpoint: **https://serenatan.org/launchvideo/mcp**. Streamable HTTP, public and read-only, no API key or sign-in.

| Client | Setup |
| --- | --- |
| Codex CLI | `codex mcp add launch-archive --url https://serenatan.org/launchvideo/mcp` |
| Claude Code | `claude mcp add --transport http launch-archive https://serenatan.org/launchvideo/mcp` |
| Claude / Cowork / Desktop | Customize → Connectors → Add custom connector. Enter the endpoint above; choose No sign in. |
| ChatGPT | Plugins → + → Add custom MCP server. Enter the endpoint above, choose No authentication, create the plugin and install it. Account and workspace policies apply. |
| Cursor | Add the JSON below to `.cursor/mcp.json`, preserving other servers. |
| Grok | https://grok.com/connectors → New Connector → Custom → enter the endpoint above. Organization admins may need to enable it. |
| Gemini CLI | Add `{"mcpServers":{"launch-archive":{"httpUrl":"https://serenatan.org/launchvideo/mcp"}}}` to Gemini settings, preserving existing settings. |
| VS Code | Run MCP: Add Server → HTTP → enter the endpoint above. |
| Raft / other agents | Send the setup prompt above. Use remote MCP settings if supported; otherwise fetch the live manifest and catalog over HTTP. |

```json
{"mcpServers":{"launch-archive":{"url":"https://serenatan.org/launchvideo/mcp"}}}
```

The same service has three stable tools: `get_launch_context`, `search_launch_videos`, and `get_launch_video`. Call `get_launch_context` before each task. Every tool fetches the current catalog and workflow, returns their content version, and discovers styles dynamically. Search uses keywords, not a semantic embedding model.

Agents without MCP can fetch [manifest.json](https://serenatan.org/launchvideo/agent/manifest.json), its `workflowUrl`, and its `catalogUrl` before each task. On an upstream failure the service returns an explicit error, never a baked-in catalog snapshot.

## Updating the library

The canonical source is this repository's `main` branch:

- Add or update references in `data/videos.json` and upload the corresponding playable media.
- Edit `agent/manifest.json` to add or rename editorial formats.
- Edit `agent/workflow.md` to change the current remake workflow.
- Run `python3 scripts/build_readme.py` and merge the changes to `main`.

The remote service fetches these files on every call and computes a content hash. New and existing connections see the published changes on their next tool call without editing the plugin or reinstalling. Website/media publication is still a separate deployment; use the current publishing workflow to keep its playable files in sync. Historical statistics do not become live merely because the catalog is refreshed.

The plugin contains only a stable setup/refresh bootstrap and endpoint. Changes to permissions, transport, tool contracts, or client UI capabilities may require an updated package or reconnect. A client that does not call a tool cannot receive fresh server content. Native UI connection on each named client is separate from protocol verification.

The landing-page source is in `site/`. Run `python3 scripts/build_site.py` to generate `site-dist/` with the current catalog and published media URLs. The deployed gallery also retains its local reference assets for direct playback.

## Service development

```bash
cd agent-service
npm ci
npm test
npm run dev
npm run verify:live # checks the deployed service with modern and legacy SDK clients
```

`npm run deploy` deploys the Cloudflare Worker. Fixed public source URLs, bounded source reads and result limits keep this a read-only catalog service. It has no database, visitor analytics, paid gate or lead collection.

Installation references: [Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Cursor](https://cursor.com/docs/mcp), [Grok](https://docs.x.ai/grok/connectors), [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/), [ChatGPT](https://developers.openai.com/plugins/quickstart).
