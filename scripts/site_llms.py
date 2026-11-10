"""Render /launchvideo/llms.txt: the collection for agents, newest first."""

GALLERY = 'https://serenatan.org/launchvideo/'


def render_llms(videos):
    def notes(v):
        n = v.get('notes') or []
        return ' '.join(n if isinstance(n, list) else [n])

    ordered = sorted(videos, key=lambda v: (str(v.get('date', '')), v['id']), reverse=True)
    lines = [
        '# Serena Launch — AI-clonable viral launch videos',
        '',
        '> Curated launch-video references with dated stats, notes on what to borrow, and copyable remake prompts. Updated daily.',
        '',
        '## Connect your agent',
        '',
        f'- MCP server (Streamable HTTP, OAuth sign-in): `{GALLERY}mcp`',
        f'- [Setup and usage (SKILL.md)]({GALLERY}agent/SKILL.md)',
        f'- [Video catalog (JSON)]({GALLERY}videos.json)',
        f'- [Gallery]({GALLERY})',
        '- [Source on GitHub](https://github.com/serenakeyitan/awesome-ai-clonable-launch-videos)',
        '',
        f'## All {len(ordered)} videos, newest first',
        '',
    ]
    for v in ordered:
        meta = ' · '.join(filter(None, [v.get('account'), v.get('date'), v.get('category'), ', '.join(v.get('styles') or []),
                                        f"{v.get('ratio')}, {round(v.get('clipSeconds') or 0)}s"]))
        lines += [
            f"### [{v['title']}]({v['detailUrl']})",
            '',
            meta,
            '',
            notes(v),
            '',
            f"[Watch MP4]({v['watchUrl']}) · [Original post]({v['source']})",
            '',
        ]
    return '\n'.join(lines)
