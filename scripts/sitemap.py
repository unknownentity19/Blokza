#!/usr/bin/env python3
"""
Generate sitemap.xml from the pages actually on disk.

Hand-maintaining it drifted twice: every `lastmod` read 2026-08-22 while the
pages themselves had been rewritten days later, and a hand-kept list is one
forgotten edit away from advertising a page that no longer exists or omitting
one that does.

Membership is derived, not listed: a page is in the sitemap unless it says
`noindex`. That is the same fact expressed once instead of twice, so the two
cannot disagree — a sign-in page carrying noindex can never end up submitted
to a crawler.

`lastmod` comes from the file's own modification time. Run from the repo root,
or with a directory argument:

    python3 scripts/sitemap.py [dir]
"""

import datetime
import pathlib
import re
import sys

ORIGIN = "https://saaswise.dev"

# How much each page matters relative to the others. The only hand-kept values
# here, because nothing on disk expresses editorial importance.
PRIORITY = {
    "index.html": "1.0",
    "pricing.html": "0.9", "product.html": "0.9", "templates.html": "0.9",
    "docs.html": "0.8", "features-builder.html": "0.8",
    "features-publish.html": "0.8", "features-responsive.html": "0.8",
    "how.html": "0.7",
    "about.html": "0.6", "contact.html": "0.6",
    "changelog.html": "0.5", "community.html": "0.5", "support.html": "0.5",
    "careers.html": "0.4", "security.html": "0.4",
    "demo-lift.html": "0.4", "demo-market.html": "0.4",
    "demo-showcase.html": "0.4", "demo-stack.html": "0.4",
    "privacy.html": "0.3", "terms.html": "0.3",
}
DEFAULT_PRIORITY = "0.5"


def main() -> int:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    entries = []
    skipped = []

    for page in sorted(root.glob("*.html")):
        text = page.read_text(encoding="utf-8", errors="replace")
        if re.search(r'<meta\s+name="robots"[^>]*noindex', text):
            skipped.append(page.name)
            continue
        loc = ORIGIN + "/" + ("" if page.name == "index.html" else page.name)
        stamp = datetime.date.fromtimestamp(page.stat().st_mtime).isoformat()
        entries.append((loc, stamp, PRIORITY.get(page.name, DEFAULT_PRIORITY)))

    # Home first, then by descending priority so the file reads as a hierarchy.
    entries.sort(key=lambda e: (-float(e[2]), e[0]))

    body = "\n".join(
        f"  <url>\n    <loc>{loc}</loc>\n"
        f"    <lastmod>{stamp}</lastmod>\n"
        f"    <priority>{prio}</priority>\n  </url>"
        for loc, stamp, prio in entries
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n</urlset>\n"
    )
    (root / "sitemap.xml").write_text(xml, encoding="utf-8")
    print(f"    sitemap.xml: {len(entries)} urls, {len(skipped)} noindex pages left out "
          f"({', '.join(skipped) or 'none'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
