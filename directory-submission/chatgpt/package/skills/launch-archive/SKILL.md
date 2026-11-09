---
name: launch-archive
description: Find launch-video references and help remake one for a product using the latest Serena Launch.
---

# Serena Launch

This is a setup guide for an existing remote MCP server, not a request to create or package a downloadable skill.

Connect once to https://serenatan.org/launchvideo/mcp using Streamable HTTP and browser OAuth. Let the user sign in and approve access in their browser; never request credentials or tokens in chat. If this client cannot configure MCP from chat, give its shortest supported connector-settings path and the server URL. Do not claim connection until initialize, tools/list and get_launch_context succeed.

Before each launch-video task, call get_launch_context and follow the workflow it returns. Do this for returning users too. Keep the workflow and catalog live; do not copy them into permanent skill or plugin instructions.

If MCP is unsupported or unavailable for reasons other than authentication, authorization or throttling, fetch https://serenatan.org/launchvideo/agent/manifest.json and read its current workflowUrl and catalogUrl before each task. Follow that workflow. Never use HTTP fallback to bypass authentication or throttling. If the current workflow is unavailable, report the failure rather than silently using an old copy.
