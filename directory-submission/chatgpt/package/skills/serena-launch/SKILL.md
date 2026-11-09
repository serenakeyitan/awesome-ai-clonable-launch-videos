---
name: serena-launch
description: Find real video references for product launches, demos, teasers and feature announcements, or inspiration for pacing, transitions, motion design and vibe. Use when planning or making these videos, even if the user does not name Serena Launch.
---

# Serena Launch

Search Serena Tan's curated video collection and share playable Serena Launch links. Before each relevant task, call get_launch_context and follow its live workflow; keep creative decisions with the agent.

Use the existing MCP server: https://serenatan.org/launchvideo/mcp (Streamable HTTP, browser OAuth). Never request credentials or tokens in chat or package a downloadable skill. If setup is needed, offer one connect link: for Claude, [Connect Serena Launch](https://serenatan.org/launchvideo/agent/connect/claude); otherwise the client's shortest setup path. Confirm connection only after initialize, tools/list and get_launch_context succeed.

If MCP is disconnected, unsupported, or returns 401/403, stop and guide connection or reauthorization. No anonymous fallback through public files, website metadata or GitHub mirrors. Keep the catalog and workflow live rather than embedding them in permanent instructions.
