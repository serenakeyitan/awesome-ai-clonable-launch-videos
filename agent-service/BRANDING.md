# Serena Launch branding

The public name is **Serena Launch**. Preserve the `launch-archive` package/server identifiers and `/launchvideo/mcp` URL for existing connections.

- Website, plugin 0.1.3 and Clerk use the supplied popcorn mascot (`site/mascot/serena-popcorn.png`). The website mirrors and crops it through the existing `.intro-mascot` layout; the source PNG remains unchanged.
- Clerk application: `app_3LkVh87NlDpgcVKaOkA8NuugYhi`. Application settings controls its name and uploaded logo. Account Portal → Customization uses Light mode, blue `#0000FF`, paper `#F4F4F4` and Flush elevation. Retain the existing authentication methods, OAuth resource and consent flow.
- The website prompt explicitly requests an OAuth MCP connection. The setup guide tells clients not to manufacture a downloadable skill as a substitute for connection. Some chat clients still require their own connector-settings step.
- Daily badges use `data/daily-stats.json`; regenerate through the README or site builder. They compare collection totals, including new references, rather than claiming daily source-platform growth or visitor tracking.
