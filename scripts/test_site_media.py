import json
from pathlib import Path
import tempfile
import unittest
from verify_site import verify_site, verify_runtime_assets


class PublishedMediaTests(unittest.TestCase):
    def test_rejects_the_raw_repository_catalog_that_caused_live_404s(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            video = {'id': 34, 'video': 'videos/grok-bot-online-shopping.mp4',
                     'watchUrl': 'https://serenatan.org/launchvideo/assets/34.mp4',
                     'poster': 'previews/grok-bot-online-shopping.jpg'}
            (out / 'videos.json').write_text(json.dumps([video]))
            with self.assertRaisesRegex(ValueError, 'published watchUrl'):
                verify_site(out)

    def test_allows_a_canonical_externally_hosted_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            url = 'https://github.com/user-attachments/assets/published-video'
            (out / 'videos.json').write_text(json.dumps([{'id': 67, 'video': url, 'watchUrl': url, 'poster': 'https://example.com/poster.jpg'}]))
            self.assertEqual(verify_site(out, require_local_media=True), 1)

    def test_published_catalog_requires_the_file_when_deploying_local_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            video = {'id': 34, 'video': 'https://serenatan.org/launchvideo/assets/34.mp4',
                     'watchUrl': 'https://serenatan.org/launchvideo/assets/34.mp4',
                     'poster': 'https://raw.githubusercontent.com/serenakeyitan/awesome-ai-clonable-launch-videos/main/previews/grok-bot-online-shopping.jpg'}
            (out / 'videos.json').write_text(json.dumps([video]))
            with self.assertRaisesRegex(ValueError, 'asset is missing'):
                verify_site(out, require_local_media=True)
            (out / 'assets').mkdir()
            (out / 'assets/34.mp4').write_bytes(b'nonempty fixture')
            self.assertEqual(verify_site(out, require_local_media=True), 1)


class RuntimeAssetTests(unittest.TestCase):
    def test_rejects_missing_dynamic_analytics_dependency(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'index.html').write_text('<script type="module" src="app.js"></script>')
            (out / 'app.js').write_text("import('./analytics.mjs').catch(()=>null)")
            with self.assertRaisesRegex(ValueError, 'Missing runtime asset: analytics.mjs'):
                verify_runtime_assets(out)
            (out / 'analytics.mjs').write_text("import {capturePayload} from './analytics-events.mjs';")
            (out / 'analytics-config.json').write_text('{"project_token":"public-test-key"}')
            with self.assertRaisesRegex(ValueError, 'Missing runtime asset: analytics-events.mjs'):
                verify_runtime_assets(out)
            (out / 'analytics-events.mjs').write_text('export const capturePayload=()=>{};')
            self.assertEqual(verify_runtime_assets(out), 3)


if __name__ == '__main__':
    unittest.main()
