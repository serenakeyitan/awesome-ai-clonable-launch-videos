"""Keep dated collection totals, without tracking visitors or inventing play counts."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent


def totals(videos):
    return {'videos': len(videos),
            'impressions': sum(v.get('impressions') or 0 for v in videos)}


def collection_observations(videos, now):
    """Use actual catalog revision times, never fabricate times for dated totals."""
    log = subprocess.check_output(
        ['git', 'log', '--first-parent', '--format=%H %cI', 'HEAD', '--', 'data/videos.json'],
        cwd=ROOT, text=True)
    cutoff = now - timedelta(hours=48)
    observations = []
    for line in log.splitlines():
        revision, recorded = line.split(' ', 1)
        at = datetime.fromisoformat(recorded)
        catalog = json.loads(subprocess.check_output(
            ['git', 'show', f'{revision}:data/videos.json'], cwd=ROOT))
        observations.append({'recordedAt': at.astimezone(timezone.utc).isoformat(),
                             **totals(catalog), 'sourceRevision': revision})
        # Keep one actual state before the window for a valid baseline.
        if at <= cutoff:
            break
    observations.reverse()
    current = totals(videos)
    if not observations or any(observations[-1][key] != current[key] for key in current):
        observations.append({'recordedAt': now.isoformat(), **current})
    return observations


def update_daily_stats():
    source = (ROOT / 'data/videos.json').read_bytes()
    videos = json.loads(source)
    path = ROOT / 'data/daily-stats.json'
    history = json.loads(path.read_text()) if path.exists() else {'timeZone': 'America/Los_Angeles', 'snapshots': []}
    now = datetime.now(timezone.utc)
    today = now.astimezone(ZoneInfo(history['timeZone'])).date().isoformat()
    snapshot = {'date': today, 'videos': len(videos),
                'impressions': sum(v.get('impressions') or 0 for v in videos),
                'plays': sum(v.get('views') or 0 for v in videos),
                'catalogHash': sha256(source).hexdigest()}
    history['snapshots'] = sorted([s for s in history['snapshots'] if s['date'] != today] + [snapshot], key=lambda s: s['date'])
    history['observations'] = collection_observations(videos, now)
    path.write_text(json.dumps(history, indent=2) + '\n')
    return path


if __name__ == '__main__':
    update_daily_stats()
