# Contributing to Serena Launch

Thanks for helping grow the collection. There are two ways to contribute:

1. **Suggest a video**: [open an issue](https://github.com/serenakeyitan/awesome-ai-clonable-launch-videos/issues/new?template=suggest-video.yml) with the X link. This takes a minute and needs no setup. A maintainer handles the rest.
2. **Add it yourself**: open a pull request following the steps below.

## What belongs in the collection

A good reference is a launch video that someone could realistically rebuild for their own product with code or AI tools.

**Include**

- Product launches, feature announcements, demos and teasers, publicly posted on X.
- Motion that can be recreated: UI animation, device mockups, kinetic type, data graphics, cursor demos, illustration, light 3D.
- Videos with a clear idea worth borrowing: a transition, a pacing pattern, a layout or a storytelling structure.

**Skip**

- Videos that rely mainly on live-action footage, actors or filmed locations.
- Ads that only exist as paid placements with no public post.
- Near-duplicates of a reference already in the collection. Instead, mention the new one on the existing entry's issue.
- Anything posted privately, behind a login, or without the creator's public credit.

Popularity is not a requirement. A small account with a well-made video is welcome.

## Adding a video in a pull request

### 1. Files

| File | Requirements |
| --- | --- |
| `videos/<slug>.mp4` | The original post's highest-quality file, H.264. Do not upscale, re-edit, add watermarks or crop. If the source is very long, you may include an excerpt; mark it as one (see below). |
| `previews/<slug>.jpg` | One representative frame from the video at its native aspect ratio. JPEG, under 250 KB. |

`<slug>` is lowercase kebab-case, usually `account-product-idea`, for example `photonhq-omnichannel-kinetic-type`.

### 2. Entry in `data/videos.json`

Append an object. The simplest approach is to copy a recent entry, such as id 88, and replace every value. Fields to fill:

| Field | What to put |
| --- | --- |
| `id` | The highest existing id + 1. Never reuse an id. |
| `slug` | Same as the file names. |
| `title` | `Brand — What it shows`, for example `Photon — Omnichannel Messaging`. |
| `originalTitle` | The post's first line, verbatim. |
| `account`, `followers` | Posting account (`@handle`) and its follower count. |
| `source` | The X post URL. |
| `quote` | The post text, verbatim. |
| `date` | The post date, `YYYY-MM-DD`. |
| `impressions`, `views`, `likes`, `bookmarks`, `reposts`, `replies`, `quotes` | Copied from the post. Use `null` for anything X doesn't show. **Never estimate.** |
| `snapshotDate` | The date (Pacific time) when you copied the stats. |
| `originalSeconds`, `clipSeconds`, `excerpt` | Source duration, included-file duration, and `true` if the file is an excerpt. |
| `width`, `height`, `ratio`, `hasAudio` | From the MP4, for example via `ffprobe`. |
| `category` | One of: `Launch video`, `AI launch`, `Startup launch`, `Feature clip`, `Tool demo`. |
| `styles` | One to three of: `3D animation`, `Abstract motion`, `Character animation`, `Charts`, `Cursor demo`, `Data graphics`, `Device motion`, `Image collage`, `Kinetic type`, `Logo motion`, `Mixed media`, `Photo collage`, `Terminal`, `UI motion`. |
| `readmeCategory` | One of: `device-ui-transformations`, `clean-ui-data-graphics`, `pastel-ui-cursor-demos`, `typography-abstract-motion`, `dark-gradient-mixed-media`, `illustrated-mascot-stories`. |
| `notes` | One to three sentences describing what is on screen: layout, motion, transitions, pacing. Describe, don't promote. |
| `video`, `poster` | `videos/<slug>.mp4` and `previews/<slug>.jpg`. |
| `watchUrl`, `detailUrl` | `https://serenatan.org/launchvideo/assets/<id>.mp4` and `https://serenatan.org/launchvideo/#video-<id>`. |
| `remakePrompt` | `Remake this video's motion and vibe for my product:\n<source URL>` |
| `githubVideoUrl` | Optional. Drag the MP4 into any GitHub comment box, wait for the upload, and copy the `https://github.com/user-attachments/assets/...` URL. GitHub then plays the video inline in the README. Leave it as `""` otherwise; the README shows the poster instead. |
| `flag` | Leave as `""`. Maintainers use it only to mark posts whose video plays are below 3% of impressions. |

Leave the remaining fields (`seed`, `scores`, `benchmark`, `referenceGroup`, `collectionSource`, `mediaQuality`, `originalNotes`) as in the entry you copied, or as `null`. Maintainers fill them in.

### 3. Rebuild and check

```bash
python3 scripts/build_readme.py      # regenerates README.md and data/daily-stats.json
python3 scripts/test_site_media.py
python3 scripts/test_site_summary.py
python3 scripts/test_site_llms.py
```

Commit `README.md` and `data/daily-stats.json` along with your files. Don't edit `README.md` by hand; it is generated from `data/videos.json`.

### 4. Pull request checklist

- [ ] The video fits the collection (see above) and isn't already in it.
- [ ] The MP4 and poster are named `<slug>` and meet the file requirements.
- [ ] Stats are copied from the post, with `snapshotDate` set, and none are estimated.
- [ ] `README.md` was regenerated, and the checks above pass.

One video per PR keeps review quick. Several related videos in one PR are fine if they share a source or theme.

## Updating an existing entry

- **Fresher stats**: update the numbers and `snapshotDate` together, then rebuild.
- **Corrections** (wrong account, title, date or category): fix the field and say in the PR what was wrong.
- **Better media**: a higher-quality original file may replace the current one under the same name.

## Code changes

- The website UI (React + TypeScript) lives in [serena-portfolio](https://github.com/serenakeyitan/serena-portfolio).
- This repository holds the data, media, the gallery Worker (`site-worker/`) and the MCP service (`agent-service/`).
- Run the relevant tests before opening a PR:

```bash
node --test site-worker/worker.test.mjs
(cd agent-service && npm ci && npm test)
```

Open an issue first for larger changes, so we can agree on the approach.

## Rights and removal

Every video stays credited to, and owned by, its creator. The MIT license covers the curation, prompts and code, not the videos, previews, logos or product UI. If you created a video in this collection and want it removed, [open an issue](https://github.com/serenakeyitan/awesome-ai-clonable-launch-videos/issues/new) or contact [@serenakeyitan](https://github.com/serenakeyitan), and it will be taken down promptly.

By contributing, you agree that your curation, notes and code are released under the [MIT License](LICENSE).
