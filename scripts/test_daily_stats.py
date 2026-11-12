"""Catalog observation times survive midnight and metadata-only rebuilds."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import build_daily_stats as stats


class CollectionHistoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.run_git('init', '--quiet')
        self.videos = [{'id': 1, 'impressions': 100}, {'id': 2, 'impressions': None}]
        self.commit('2026-11-10T23:44:32+00:00')
        self.videos.append({'id': 3, 'impressions': 50})
        self.commit('2026-11-12T07:27:01+00:00')
        self.videos[-1]['title'] = 'A metadata change'
        self.commit('2026-11-12T07:32:09+00:00')
        self.now = datetime(2026, 11, 12, 8, 30, tzinfo=timezone.utc)

    def run_git(self, *args, env=None):
        return subprocess.check_output(['git', *args], cwd=self.root, env=env)

    def commit(self, at):
        (self.root / 'data/videos.json').write_text(json.dumps(self.videos))
        self.run_git('add', 'data/videos.json')
        env = {**os.environ, 'GIT_AUTHOR_NAME': 'Test', 'GIT_COMMITTER_NAME': 'Test',
               'GIT_AUTHOR_EMAIL': 'test@example.invalid', 'GIT_COMMITTER_EMAIL': 'test@example.invalid',
               'GIT_AUTHOR_DATE': at, 'GIT_COMMITTER_DATE': at}
        self.run_git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Catalog update', env=env)

    def test_preserves_actual_revision_times_instead_of_dated_snapshots(self):
        with patch.object(stats, 'ROOT', self.root):
            observations = stats.collection_observations(self.videos, self.now)
        self.assertEqual([o['recordedAt'] for o in observations], [
            '2026-11-10T23:44:32+00:00', '2026-11-12T07:27:01+00:00', '2026-11-12T07:32:09+00:00'])
        self.assertEqual([(o['videos'], o['impressions']) for o in observations], [(2, 100), (3, 150), (3, 150)])

    def test_rebuilding_unchanged_catalog_does_not_reset_the_observation_time(self):
        with patch.object(stats, 'ROOT', self.root):
            first = stats.collection_observations(self.videos, self.now)
            second = stats.collection_observations(self.videos, self.now.replace(hour=10))
        self.assertEqual(first, second)

    def test_includes_uncommitted_metric_changes_without_guessing_their_time(self):
        self.videos.append({'id': 4, 'impressions': 20})
        with patch.object(stats, 'ROOT', self.root):
            observations = stats.collection_observations(self.videos, self.now)
        self.assertEqual(observations[-1], {'recordedAt': self.now.isoformat(), 'videos': 4, 'impressions': 170})


if __name__ == '__main__':
    unittest.main()
