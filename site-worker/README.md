# Gallery delivery

The gallery Worker owns collection data, media and static legal/setup pages. The
React + TypeScript UI lives in `serenakeyitan/serena-portfolio`; both sites import
its `src/components/SiteHeader.tsx` and Radix UI components.

Run from this repository root:

```sh
python3 scripts/build_site.py
python3 scripts/sync_media_r2.py
node --test site-worker/worker.test.mjs
npx wrangler deploy --config site-worker/wrangler.json
```

MP4s are served from the `serenatan-launchvideo-media` R2 bucket, which slices
byte ranges natively. Slicing the bundled asset in JS used 20-300 ms CPU per
request, past the Workers Free 10 ms limit. `sync_media_r2.py` uploads new or
changed MP4s; a video not yet in R2 still plays from the bundled asset.

The build validates canonical media and runtime module dependencies, generates
`site-worker/asset-sizes.json`, and stages the gallery in `site-public/launchvideo/` (MP4s in its `assets/`).
The asset layer serves every file directly except the HTML entries and MP4s
listed in `run_worker_first`: MP4s need the Worker for byte ranges, which the
asset layer does not support. Direct asset requests are free and do not count
toward the Workers daily request limit.
Media is hardlinked where supported, otherwise copied. Treat generated assets as
read-only. References hosted elsewhere remain external.

Deploy the portfolio frontend first (`npm run build`, Pages output `dist`).
Verify `https://serenatan.org/launch`, `/consent` and their script/style
assets. Then deploy this Worker. It forwards collection/consent HTML to those
canonical extensionless Pages entries on the production `serena-portfolio-bzs.pages.dev` domain without forwarding cookies, authorization headers or query strings.
Original browser URLs and OAuth parameters remain available to the client.
An unavailable frontend returns 503; there is no alternate anonymous workflow.

Keep the existing more-specific MCP routes and authentication Worker intact.
After publication, verify `/launchvideo/`, `/launchvideo/videos.json`, a video
byte-range request and `/launchvideo/consent.html`. Use normal Chrome to check
search, filters, grid/table, details, playback, seeking and the shared header.
A local inert consent preview does not certify live OAuth acceptance.

For daily video additions, use this checked-in configuration; do not publish an
older standalone HTML bundle over the shared frontend.
