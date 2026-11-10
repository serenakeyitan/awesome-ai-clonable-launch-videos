"""Check /launchvideo/llms.txt lists every published video with its links."""
import json
from pathlib import Path
from site_llms import render_llms

ROOT = Path(__file__).resolve().parent.parent
videos = json.loads((ROOT / 'data/videos.json').read_text())
text = render_llms(videos)
assert '`https://serenatan.org/launchvideo/mcp`' in text
assert 'agent/SKILL.md' in text
assert f'## All {len(videos)} videos' in text
for v in videos:
    assert v['detailUrl'] in text and v['watchUrl'] in text and v['source'] in text, v['id']
newest = max(videos, key=lambda v: (v['date'], v['id']))
assert text.index(newest['detailUrl']) < text.index(min(videos, key=lambda v: (v['date'], v['id']))['detailUrl'])
print(f'llms.txt lists all {len(videos)} videos newest first.')
