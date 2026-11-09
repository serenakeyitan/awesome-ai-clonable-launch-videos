"""Reject repository-only media paths before publishing gallery assets."""
import argparse
import json
import re
from html.parser import HTMLParser
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


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.paths.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.paths.append(attrs['href'])


def verify_runtime_assets(directory):
    root = Path(directory).resolve()
    if not (root / 'index.html').is_file():
        raise ValueError('Missing gallery index.html')
    queue = []

    def local_path(ref, parent):
        url = urlparse(ref)
        if url.scheme or url.netloc:
            return None
        path = unquote(url.path)
        if path.startswith('/launchvideo/'):
            path = path[len('/launchvideo/'):]
            parent = root
        elif path.startswith('/'):
            return None  # Shared site assets belong to the portfolio deployment.
        target = (parent / path).resolve()
        if not target.is_relative_to(root):
            raise ValueError('Asset path leaves gallery deployment')
        return target

    for html in root.glob('*.html'):
        page = PageAssets()
        page.feed(html.read_text())
        queue.extend((ref, html.parent) for ref in page.paths)
    visited = set()
    while queue:
        ref, parent = queue.pop()
        path = local_path(ref, parent)
        if path is None or path in visited:
            continue
        if not path.is_file():
            raise ValueError('Missing runtime asset: ' + str(path.relative_to(root)))
        visited.add(path)
        if path.suffix in ['.js', '.mjs']:
            text = path.read_text()
            imports = re.findall(r"\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?['\"](\.[^'\"]+)['\"]", text)
            imports += re.findall(r"\bimport\s*\(\s*['\"](\.[^'\"]+)['\"]", text)
            queue.extend((ref, path.parent) for ref in imports)
        if path.name == 'analytics.mjs':
            config = root / 'analytics-config.json'
            if not config.is_file() or not json.loads(config.read_text()).get('project_token'):
                raise ValueError('Missing analytics-config.json project configuration')
    return len(visited)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--require-local-media', action='store_true')
    args = parser.parse_args()
    verify_runtime_assets(args.directory)
    print('Verified {} published video and poster URLs.'.format(verify_site(args.directory, args.require_local_media)))
