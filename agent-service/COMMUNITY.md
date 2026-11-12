# Community publishing

`create_community_upload` requires an explicit public-posting agreement (`user_confirmed: true`), an MP4 size up to 100 MB, and ideally the creation `task_id` for retry deduplication. The client PUTs the actual bytes to the expiring upload URL, then calls `publish_community_video`. Uploading alone never makes the file public. There is no user-facing draft, preview or second approval. A completed task response contains the one-time offer for the client to ask; MCP cannot force a remote model to ask or access a file it cannot read.

The public Community tab lists posts and supplies per-post share links. Clerk session authentication protects author-only metadata edits, replacement and deletion. R2 media keys use the separate `community/` prefix in the reference bucket; conversation storage is unchanged. Every public media request verifies that the upload is still the active published version. Upload tokens expire after 30 minutes. Hourly cleanup removes abandoned uploads. Limits: 100 active posts, 5 pending uploads, 500 MB per account per 24 hours.

Apply additive D1 migration `0003_community.sql` before deploying the new Worker binding/routes. Community analytics joins `task_id`, `post_id`, and `reference_ids`; it excludes upload tokens, media URLs and user text. Browser viewing and 5-second engagement events use Community post IDs, separate from reference views.

Deploy with the existing Worker configuration and `--keep-vars`. Verify an authenticated upload against the live MCP, public feed/playback, author-only replacement and deletion, then remove the temporary test post. Unit/integration tests use actual D1/R2 APIs in Miniflare, not production credentials.
