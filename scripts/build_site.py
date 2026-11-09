"""Build the frontend against the repository catalog and published reference media."""
from pathlib import Path
import argparse
import json
import shutil
from build_daily_stats import update_daily_stats
from site_summary import render_summary
from verify_site import verify_site

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=ROOT / 'site-dist')
OUT = parser.parse_args().output.resolve()
OUT.mkdir(exist_ok=True)
shutil.copy2(update_daily_stats(), OUT / 'daily-stats.json')
for source in (ROOT / 'site').iterdir():
    if source.is_file():
        shutil.copy2(source, OUT / source.name)
    elif source.is_dir():
        shutil.copytree(source, OUT / source.name, dirs_exist_ok=True)
html = (OUT / 'index.html').read_text().replace('"assets/', '"https://serenatan.org/launchvideo/assets/')
videos = json.loads((ROOT / 'data/videos.json').read_text())
(OUT / 'index.html').write_text(render_summary(html, videos))
for video in videos:
    video['video'] = video['watchUrl']
    video['poster'] = 'https://raw.githubusercontent.com/serenakeyitan/awesome-ai-clonable-launch-videos/main/' + video['poster']
(OUT / 'videos.json').write_text(json.dumps(videos, ensure_ascii=False) + '\n')
verify_site(OUT)
print(f'Built {OUT} with {len(videos)} published playable references.')
