"""Keep dated collection totals, without tracking visitors or inventing play counts."""
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent


def update_daily_stats():
    source = (ROOT / 'data/videos.json').read_bytes()
    videos = json.loads(source)
    path = ROOT / 'data/daily-stats.json'
    history = json.loads(path.read_text()) if path.exists() else {'timeZone': 'America/Los_Angeles', 'snapshots': []}
    today = datetime.now(ZoneInfo(history['timeZone'])).date().isoformat()
    snapshot = {'date': today, 'videos': len(videos),
                'impressions': sum(v.get('impressions') or 0 for v in videos),
                'plays': sum(v.get('views') or 0 for v in videos),
                'catalogHash': sha256(source).hexdigest()}
    history['snapshots'] = sorted([s for s in history['snapshots'] if s['date'] != today] + [snapshot], key=lambda s: s['date'])
    path.write_text(json.dumps(history, indent=2) + '\n')
    return path


if __name__ == '__main__':
    update_daily_stats()
