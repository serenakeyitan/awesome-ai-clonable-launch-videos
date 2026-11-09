from pathlib import Path
import re
import unittest
from site_summary import compact, render_summary

TEMPLATE = (Path(__file__).resolve().parent.parent / 'site/index.html').read_text()


class SiteSummaryTests(unittest.TestCase):
    def test_one_snapshot_populates_both_counts_and_total_before_javascript(self):
        first = render_summary(TEMPLATE, [{'impressions': 73880000}])
        updated = render_summary(first, [{'impressions': 73880000}, {'impressions': 19900}])
        for element_id in ['total-videos', 'result-count']:
            self.assertRegex(updated, rf'id="{element_id}"[^>]*>2<')
        self.assertRegex(updated, r'id="total-impressions">73.90M<')
        self.assertNotIn('73.88M', updated)

    def test_unbuilt_source_has_no_stale_numeric_counts(self):
        for element_id in ['total-videos', 'total-impressions', 'result-count']:
            self.assertRegex(TEMPLATE, rf'id="{element_id}"[^>]*>—<')

    def test_missing_metrics_and_empty_catalog_are_not_stale(self):
        html = render_summary(TEMPLATE, [{'impressions': None}, {}])
        self.assertRegex(html, r'id="total-impressions">0<')
        self.assertRegex(render_summary(html, []), r'id="total-videos">0<')

    def test_compact_matches_javascript_rounding_at_exact_half_boundaries(self):
        self.assertEqual(compact(1125000), '1.13M')
        self.assertEqual(compact(1250), '1.3K')

    def test_template_changes_fail_instead_of_silently_publishing_wrong_counts(self):
        with self.assertRaises(ValueError):
            render_summary(TEMPLATE.replace('id="total-videos"', 'id="renamed"'), [])


if __name__ == '__main__':
    unittest.main()
