"""Upload hosted gallery MP4s to the R2 bucket the gallery Worker reads.

Run after scripts/build_site.py and before deploying site-worker. Objects use
the public path without /launchvideo/, e.g. assets/34.mp4. Uploads are skipped
when this machine already sent the same file (tracked in .wrangler/), so pass
--all to re-upload everything, e.g. from a fresh checkout.
"""
from pathlib import Path
import argparse
import json
import subprocess

ROOT = Path(__file__).resolve().parent.parent
BUCKET = json.loads((ROOT / 'site-worker/wrangler.json').read_text())['r2_buckets'][0]['bucket_name']
STATE = ROOT / '.wrangler/r2-media-uploaded.json'

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--all', action='store_true', help='re-upload every MP4')
parser.add_argument('--local', action='store_true', help='write to the local wrangler dev bucket')
args = parser.parse_args()

sizes = json.loads((ROOT / 'site-worker/asset-sizes.json').read_text())
media = ROOT / 'site-public/launchvideo'
state = {} if args.all or args.local or not STATE.exists() else json.loads(STATE.read_text())
uploaded = 0
for path, size in sorted(sizes.items()):
    source = media / path.lstrip('/')
    stat = source.stat()
    if stat.st_size != size:
        raise SystemExit(f'{source} does not match asset-sizes.json; rebuild first')
    stamp = f'{stat.st_size}:{int(stat.st_mtime)}'
    if state.get(path) == stamp:
        continue
    subprocess.run(['npx', 'wrangler', 'r2', 'object', 'put', f'{BUCKET}{path}', '--config', 'site-worker/wrangler.json', '--file', str(source),
                    '--content-type', 'video/mp4', '--local' if args.local else '--remote'],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    state[path] = stamp
    uploaded += 1
    if not args.local:
        STATE.parent.mkdir(exist_ok=True)
        STATE.write_text(json.dumps(state, indent=1) + '\n')
print(f'Uploaded {uploaded} of {len(sizes)} MP4s to {BUCKET}{" (local)" if args.local else ""}.')
