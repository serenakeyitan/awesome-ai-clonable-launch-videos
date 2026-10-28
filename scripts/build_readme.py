"""Build the visual, prompt-first README from the attributed video metadata."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent.parent
VIDEOS = json.loads((ROOT / 'data/videos.json').read_text())
GROUPS = [
    ('device-ui-transformations', 'A. Device & UI Transformations', 'Phones, floating windows, camera moves, and interfaces that change shape.'),
    ('clean-ui-data-graphics', 'B. Clean UI, Data & Graphics', 'One focal point per scene: charts, code cards, simple geometry, and useful product actions.'),
    ('pastel-ui-cursor-demos', 'C. Pastel UI & Cursor Demos', 'Product stories driven by clear interfaces, oversized cursors, and quick visual payoffs.'),
    ('typography-abstract-motion', 'D. Typography & Abstract Motion', 'Kinetic type, counters, glowing outlines, rings, and waveform-led product stories.'),
    ('dark-gradient-mixed-media', 'E. Dark, Gradient & Mixed Media', 'Dark interfaces, floating devices, image collage, and product demos mixed with people or generated footage.'),
]

def duration(seconds):
    total = round(seconds)
    return f'{total // 60}:{total % 60:02d}'

def compact(number):
    return f'{number / 1_000_000:.2f}M' if number >= 1_000_000 else f'{number / 1000:.1f}K' if number >= 1000 else str(number)

def prompt(video):
    return f"clone this video 1:1 for my product\n{video['source']}"

def stats(video):
    v = video
    rows = [
        ('Posting account', v['account']), ('Post date', v['date']),
        ('Stats snapshot (PT)', v['snapshotDate']), ('Post impressions', f"{v['impressions']:,}"),
        ('Video plays', f"{v['views']:,}"), ('Likes', f"{v['likes']:,}"),
        ('Bookmarks', f"{v['bookmarks']:,}"), ('Reposts', f"{v['reposts']:,}"),
        ('Replies', f"{v['replies']:,}"), ('Quotes', f"{v['quotes']:,}"),
        ('Account followers', f"{v['followers']:,}"),
        ('Original duration', duration(v['originalSeconds'])),
        ('Included file', duration(v['clipSeconds']) + (' — excerpt' if v['excerpt'] else ' — full clip')),
        ('Aspect ratio', v['ratio']), ('Reference resolution', f"{v['width']} × {v['height']}"),
        ('Audio track', 'Present' if v['hasAudio'] else 'None'),
    ]
    return '\n'.join(['| Metadata | Value |', '| --- | --- |'] + [f'| {key} | {value} |' for key, value in rows])

parts = [f'''# Awesome AI Clonable Launch Videos

### ▶ [Watch the collection](https://serenatan.org/launchvideo/)

![Launch video collection](assets/collection.png)

[![Awesome](https://awesome.re/badge.svg)](https://awesome.re)
[![References](https://img.shields.io/badge/video_references-{len(VIDEOS)}-black)](#table-of-contents)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> A visual collection of launch videos worth studying — with playable MP4s, performance data, and copyable prompts to clone them 1:1 for your product with AI.

For founders, designers, and builders making their next product launch. Browse a style, watch a reference, then copy the prompt and make it yours.

**Every entry includes a preview, the video file, a remake prompt, and credit to the original creator.** The [live site](https://serenatan.org/launchvideo/) plays videos directly in the cards; all {len(VIDEOS)} compressed reference files are also included in [videos/](videos/).

Inspired by the visual + copyable-prompt format of [Awesome NotebookLM Templates](https://github.com/serenakeyitan/awesome-notebookLM-prompts).

## Table of Contents
''']
for key, title, _ in GROUPS:
    entries = [v for v in VIDEOS if v['readmeCategory'] == key]
    parts.append(f'### [{title}](#{key})\n')
    parts.extend(f"- [{v['title']}](#{v['slug']})" for v in entries)
    parts.append('')
parts.append('---\n')

for key, title, description in GROUPS:
    parts.append(f'<a id="{key}"></a>\n\n## {title}\n\n{description}\n')
    for v in (x for x in VIDEOS if x['readmeCategory'] == key):
        v['remakePrompt'] = prompt(v)
        included = duration(v['clipSeconds']) + (f" excerpt of {duration(v['originalSeconds'])}" if v['excerpt'] else '')
        parts.append(f'''<a id="{v['slug']}"></a>

### {v['title']}

[![{v['title']} preview]({v['poster']})]({v['watchUrl']})

**{included} · {v['ratio']} · {compact(v['impressions'])} impressions · {compact(v['views'])} plays**

[▶ Watch video]({v['watchUrl']}) · [MP4 file]({v['video']}) · [Browse with stats]({v['detailUrl']})

{' '.join(v['notes'])}

```text
{v['remakePrompt']}
```

*Source: [{v['account']}]({v['source']}) · {v['date']}*

<details>
<summary>Metadata & stats</summary>

{stats(v)}

</details>

---
''')

parts.append('''## How to use these prompts

1. Pick a video and copy its prompt, including the Twitter/X source link.
2. Paste it into your AI coding or video tool.
3. Add your product details and assets.

## Data & source notes

- Metrics are historical snapshots from **October 27–28, 2026 (Pacific time)**. Each entry records its own date; counts are not live.
- Impressions describe post exposure, not video plays. They do not establish organic reach or exclude paid promotion.
- Posting-account follower counts may describe a founder or employee rather than a company.
- Files are compressed references, up to 540p. Eight entries are excerpts; their original durations are shown. Stats describe the full source posts.
- Style notes are based on sampled frames and supplied metadata. Style categories are editorial judgments.
- Full metadata, original Chinese notes, source links, and prompts are in [data/videos.json](data/videos.json).

## Contributing

Suggestions are welcome! Open a PR with a public source post, a preview, a useful style breakdown, and a copyable remake prompt. Include a dated source for any stats, and label excerpts clearly. Add the entry to `data/videos.json`, then run:

```bash
python3 scripts/build_readme.py
```

## License & credits

Original curation, prompts, and repository code are [MIT licensed](LICENSE). Third-party videos, previews, product UI, logos, and branding remain with their respective owners; the MIT license does not grant rights to those assets. Every video links to its original post.
''')

assert len(VIDEOS) == len({v['slug'] for v in VIDEOS}) == 40
assert len([v for key, _, _ in GROUPS for v in VIDEOS if v['readmeCategory'] == key]) == 40
for video in VIDEOS:
    assert (ROOT / video['video']).is_file(), video['video']
    assert (ROOT / video['poster']).is_file(), video['poster']
(ROOT / 'README.md').write_text('\n'.join(parts))
(ROOT / 'data/videos.json').write_text(json.dumps(VIDEOS, ensure_ascii=False, indent=2) + '\n')
print(f'Built README with {len(VIDEOS)} previews, prompts, local MP4 links, source credits, and metadata tables.')
