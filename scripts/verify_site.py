"""Reject repository-only media paths before publishing gallery assets."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse, unquote


def verify_site(directory, require_local_media=False):
    directory = Path(directory)
    videos = json.loads((directory / 'videos.json').read_text())
    if not videos:
        raise ValueError('The gallery catalog is empty')
    errors = []
    for video in videos:
        label = 'Reference ' + str(video['id'])
        url = urlparse(video.get('video', ''))
        if video.get('video') != video.get('watchUrl') or url.scheme != 'https' or not url.netloc:
            errors.append(label + ': playback must use its published watchUrl')
        poster = urlparse(video.get('poster', ''))
        if poster.scheme != 'https' or not poster.netloc:
            errors.append(label + ': poster must use a published URL')
        if require_local_media and url.netloc == 'serenatan.org':
            prefix = '/launchvideo/'
            if not url.path.startswith(prefix + 'assets/'):
                errors.append(label + ': expected a gallery-hosted asset')
            else:
                path = directory / unquote(url.path[len(prefix):])
                if not path.is_file() or path.stat().st_size == 0:
                    errors.append(label + ': published asset is missing')
    if errors:
        raise ValueError('\n'.join(errors))
    return len(videos)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--require-local-media', action='store_true')
    args = parser.parse_args()
    print('Verified {} published video and poster URLs.'.format(verify_site(args.directory, args.require_local_media)))
