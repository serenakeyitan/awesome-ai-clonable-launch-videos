---
name: serena-launch
description: Find launch-video references and remake one using the live Serena Launch workflow.
---

# Serena Launch

Connect the existing MCP server; do not package a downloadable skill.

Server: https://serenatan.org/launchvideo/mcp (Streamable HTTP, browser OAuth). The user signs in and approves access; never request credentials or tokens in chat. If chat cannot configure MCP, give one connect link rather than a tutorial. For Claude, reply only with [Connect Serena Launch](https://serenatan.org/launchvideo/agent/connect/claude). For other clients, use their setup link or shortest settings path. Claim connection only after initialize, tools/list and get_launch_context succeed.

Before each launch-video task, call get_launch_context and follow the workflow it returns. Never embed the workflow or catalog in permanent instructions.

If MCP is unsupported or unavailable, fetch https://serenatan.org/launchvideo/agent/manifest.json and its workflowUrl and catalogUrl before each task. Never use fallback to bypass authentication, authorization or throttling. Follow the current workflow; report fetch failures instead of using a stale copy.
