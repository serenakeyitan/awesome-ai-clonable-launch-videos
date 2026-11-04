"""Build the frontend against the repository catalog and published reference media."""
from pathlib import Path
import json
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'site-dist'
OUT.mkdir(exist_ok=True)
for source in (ROOT / 'site').iterdir():
    if source.is_file():
        shutil.copy2(source, OUT / source.name)
    elif source.is_dir():
        shutil.copytree(source, OUT / source.name, dirs_exist_ok=True)
html = (OUT / 'index.html').read_text().replace('"assets/', '"https://serenatan.org/launchvideo/assets/')
(OUT / 'index.html').write_text(html)
videos = json.loads((ROOT / 'data/videos.json').read_text())
for video in videos:
    video['video'] = video['watchUrl']
    video['poster'] = 'https://raw.githubusercontent.com/serenakeyitan/awesome-ai-clonable-launch-videos/main/' + video['poster']
(OUT / 'videos.json').write_text(json.dumps(videos, ensure_ascii=False) + '\n')
print(f'Built site-dist with {len(videos)} published playable references.')
