# Serena Launch measurement

Owner: Serena Tan. Purpose: understand discovery, connection, activation and return use. These are product events, not the X impression/play snapshots in the gallery.

## Main measures

- **Browser connection funnel:** unique browser visitors → quick-connect clicked → signed-in consent page viewed → consent submitted. A click or an Allow submission is not proof that OAuth completed.
- **MCP activation:** an authenticated account successfully retrieves an existing reference with `get_launch_video`. Context discovery and searches are diagnostics, not activation. First activation is the account's first such event.
- **D1 / D7 account retention:** activated accounts that successfully retrieve a reference again on calendar day 1 / 7 after first activation, divided by activated accounts whose day 1 / 7 has elapsed. Use the project's Pacific time zone and show cohort sizes. Today's new users are not eligible for D1 yet.

Track browser return visits separately from account retention. A browser ID is not a person; another device or cleared storage starts another browser history. Cross-browser connection attribution is incomplete. MCP read access does not prove that a finished video was created or exported.

## Events

| Event | Source | Purpose / properties |
| --- | --- | --- |
| `collection_viewed` | browser | Visit; entry path, referrer host, allowlisted UTM campaign fields |
| `reference_opened` | browser | Detail view; reference ID, surface |
| `reference_played` | browser | Playback began; reference ID, surface |
| `reference_failed` | browser | Media error; reference ID, surface and numeric error category |
| `reference_engaged` | browser | At least 5 seconds of actual playback; once per video per page |
| `reference_prompt_copied` | browser | Successful reference brief copy; reference ID |
| `collection_filtered` | browser | Search/filter use; query length, result count, category/style/sort; no search text |
| `setup_prompt_copied` | browser | Successful copy; placement |
| `quick_connect_clicked` | browser | Client and desktop/web destination; not a completed connection |
| `consent_viewed` | signed-in browser | Verified requesting client, no OAuth query parameters |
| `consent_submitted` | signed-in browser | Explicit allow/deny; not proof of completed OAuth |
| `consent_failed` | browser | Fixed error category only |
| `mcp_tool_completed` | server | Verified account, tool, outcome, reference found/ID, result count, query length, latency; no prompts or tokens |

## Collection rules

Explicit events only: no session replay, automatic DOM capture, full URLs, OAuth state/codes/tokens, email addresses, names, product prompts or free-text searches. Honor browser Do Not Track / Global Privacy Control. Authenticated account IDs are opaque Clerk IDs. Browser and server events share the same account distinct ID after sign-in.

Test events carry `is_test=true`; all production insights exclude them. Do not manufacture historical baselines. Retention starts with the first real activation collected after release. A network/provider failure must not break browsing, consent or a successful MCP response.

Use the free analytics plan and do not enable paid overages or session recordings. Keep Clerk's existing account-security email delivery; no separate welcome-email service or newsletter subscription is added.

## Usage, feedback and creation

- Most used clients/tools: authenticated MCP calls by safe client label/tool name. Quick-connect clicks are a separate intent metric. Unknown client IDs stay `other`.
- Most used references: web opens, 5-second engagement, copied briefs and successful MCP detail retrieval by reference ID. These measure different actions; none proves that a video was chosen for a finished render. Catalog ID maps to the current public Serena Launch detail link.
- Explicit feedback: `reference_feedback`, rating helpful/not_helpful and optional fixed reason. MCP feedback includes the task ID when supplied, linking feedback to the same creation outcome. The gallery offers Yes/No in reference details; the MCP accepts feedback only when explicitly stated by the user. Do not infer satisfaction or send conversation text.
- Creation tasks: `launch_task_started`, `launch_task_completed`, `launch_task_failed`, joined by authenticated account + returned UUID task ID. Count unique task IDs, not reports. Repeated outcome reports use stable event UUIDs. A missing outcome is unknown, never an automatic failure.
- Completion rate: distinct started tasks with matching completed outcomes / distinct started tasks in the same 30-day start cohort. Display pending/unreported separately and allow recent tasks time to finish. Tasks started before instrumentation are not counted in that denominator.
- Completion is agent-reported. Individual booleans record HTML, source, MP4, music, playback and download checks; `checks_passed` requires all six. The reference service does not inspect the actual output. Agent report coverage is incomplete when clients do not call the reporting tool.

Reporting adds one non-destructive write tool `report_launch_task`; catalog tools remain read-only. Reports contain no output URLs, source files, prompts or email addresses. The service acknowledges reports only after PostHog accepts them; an ingestion/network error returns recorded=false, without interrupting video creation. Browser analytics is best effort and cannot observe blocked/disabled clients.
