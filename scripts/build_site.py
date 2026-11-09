"""Build the frontend against the repository catalog and published reference media."""
from pathlib import Path
import argparse
import json
import shutil
import os
import re
from urllib.parse import urlparse, unquote
from build_daily_stats import update_daily_stats
from site_summary import render_summary
from verify_site import verify_site, verify_runtime_assets

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
# Media stays in the catalog repository. External canonical references are not
# duplicated into the static asset deployment.
sizes = {}
for video in json.loads((ROOT / 'data/videos.json').read_text()):
    url = urlparse(video['watchUrl'])
    if url.hostname != 'serenatan.org':
        continue
    if not re.fullmatch(r'/launchvideo/assets/[0-9]+\.mp4', url.path):
        raise ValueError('Invalid gallery media path')
    source = (ROOT / video['video']).resolve()
    if not source.is_relative_to((ROOT / 'videos').resolve()) or source.suffix != '.mp4':
        raise ValueError('Invalid source media path')
    target = OUT / unquote(url.path[len('/launchvideo/'):])
    target.parent.mkdir(parents=True, exist_ok=True)
    same_file = target.exists() and target.stat().st_ino == source.stat().st_ino and target.stat().st_dev == source.stat().st_dev
    if not same_file:
        if target.exists():
            target.unlink()
        try:
            os.link(source, target)
        except OSError:
            shutil.copy2(source, target)
    sizes['/' + str(target.relative_to(OUT))] = target.stat().st_size
(ROOT / 'site-worker/asset-sizes.json').write_text(json.dumps(sizes) + '\n')
verify_site(OUT)
verify_runtime_assets(OUT)
print(f'Built {OUT} with {len(videos)} published playable references.')
