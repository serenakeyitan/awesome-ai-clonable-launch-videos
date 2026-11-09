"""Render initial gallery counts from the same snapshot as videos.json."""
from decimal import Decimal, ROUND_HALF_UP
import re


def compact(value):
    if value >= 1_000_000:
        number = Decimal.from_float(value / 1_000_000).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return f'{number:.2f}M'
    if value >= 1_000:
        number = Decimal.from_float(value / 1_000).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)
        return f'{number:.1f}K'
    return str(value)


def render_summary(html, videos):
    values = {'total-videos': str(len(videos)),
              'total-impressions': compact(sum(v.get('impressions') or 0 for v in videos)),
              'result-count': str(len(videos))}
    for element_id, value in values.items():
        pattern = rf'(<(?:strong|span)\b[^>]*\bid="{element_id}"[^>]*>)[^<]*(</(?:strong|span)>)'
        html, count = re.subn(pattern, lambda match: match[1] + value + match[2], html)
        if count != 1:
            raise ValueError(f'Expected one {element_id} summary element')
    return html
