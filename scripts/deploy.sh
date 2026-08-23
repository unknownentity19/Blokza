#!/usr/bin/env bash
#
# Assemble the deployable site into dist/, and optionally publish it.
#
# Why a staging directory rather than publishing the repository root: the root
# also holds builder/node_modules (~98 MB) and legacy/ (~419 MB). Netlify coped
# because netlify.toml redirected those paths to a 404, but the files were still
# uploaded; Cloudflare Pages caps a deployment at 20,000 files and 25 MB each, so
# the repository root cannot be published there at all. Listing what belongs in
# the site is also the only way to be certain the TypeScript source is not on it.
#
#   ./scripts/deploy.sh            assemble dist/ and stop, so it can be checked
#   ./scripts/deploy.sh --deploy   assemble, then publish to Cloudflare Pages
#
# Publishing is behind a flag on purpose: it is the one step here that is
# visible to the internet.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${CF_PAGES_PROJECT:-cilbs}"
DIST="dist"

echo "==> Building the editor"
npm --prefix builder run build

echo "==> Assembling $DIST"
rm -rf "$DIST"
mkdir -p "$DIST"

# The marketing pages, and the files a host reads from the site root.
cp ./*.html "$DIST"/
for f in robots.txt site.webmanifest _headers _redirects; do
  [ -f "$f" ] && cp "$f" "$DIST"/
done

# Generated, not copied. A hand-kept sitemap drifts: its lastmod dates said the
# pages were older than they were, which is the one signal crawlers use to
# decide whether to refetch. Built from the assembled dist so its membership and
# its dates describe exactly what is being published.
python3 scripts/sitemap.py "$DIST"

# Shared assets and the built editor. `.DS_Store` is excluded everywhere: it is
# noise, and it lists filenames that are nobody else's business.
rsync -a --exclude '.DS_Store' assets "$DIST"/
rsync -a --exclude '.DS_Store' app "$DIST"/

# ---------------------------------------------------------------------------
# Stamp every stylesheet and script reference with a hash of its own contents.
#
# The pages carry hand-maintained `?v=` numbers. Editing a stylesheet without
# remembering to bump one is silent and total: returning visitors keep the old
# file and see none of the change, which is indistinguishable from the edit not
# having happened. Deriving the value from the file means it can never be stale
# and never needs remembering.
# ---------------------------------------------------------------------------
echo "==> Stamping asset versions from file contents"
python3 - "$DIST" <<'STAMP'
import hashlib, pathlib, re, sys

dist = pathlib.Path(sys.argv[1])

# Images are stamped too, not just CSS and JS. `_headers` serves everything
# under /assets/* as immutable for a year, and `immutable` means browsers will
# not revalidate even on a forced reload — so an unstamped image URL is a
# screenshot you cannot replace for twelve months without renaming the file.
patterns = ["assets/css/*.css", "assets/js/*.js",
            "assets/images/**/*", "assets/og-image.png"]
digests = {}
for pat in patterns:
    for asset in dist.glob(pat):
        if asset.is_file():
            digests[asset.name] = hashlib.sha256(asset.read_bytes()).hexdigest()[:10]

# Any asset path ending in a known extension, with or without an existing ?v=.
# Two prefixes: `assets/...` as written in the HTML, and `../images/...` as
# written by url() inside assets/css — the same file reached two ways.
EXT = r'(?:css|js|png|jpe?g|webp|avif|svg|gif|ico|woff2?)'
pattern = re.compile(
    r'((?:assets/|\.\./)(?:[A-Za-z0-9_-]+/)*'
    r'([A-Za-z0-9_.-]+\.' + EXT + r'))'
    r'(\?v=[^"\'\)\s]*)?'
)

def stamp(match):
    path, name, _ = match.groups()
    digest = digests.get(name)
    return f"{path}?v={digest}" if digest else match.group(0)

changed = 0
# The stylesheets too: the hero background is referenced by url() from CSS, so
# stamping only the HTML left that one image permanently uncacheable-bustable.
for page in list(dist.glob("*.html")) + list(dist.glob("assets/css/*.css")):
    text = page.read_text(encoding="utf-8")
    updated = pattern.sub(stamp, text)
    if updated != text:
        page.write_text(updated, encoding="utf-8")
        changed += 1

# CSS is hashed by content, so stamping inside it changes it — rehash and
# restamp the HTML that points at it, or every page would request the old digest.
for asset in dist.glob("assets/css/*.css"):
    digests[asset.name] = hashlib.sha256(asset.read_bytes()).hexdigest()[:10]
for page in dist.glob("*.html"):
    text = page.read_text(encoding="utf-8")
    updated = pattern.sub(stamp, text)
    if updated != text:
        page.write_text(updated, encoding="utf-8")

print(f"    {changed} files stamped, {len(digests)} assets hashed")
STAMP

echo
echo "==> $DIST contains $(find "$DIST" -type f | wc -l | tr -d ' ') files, $(du -sh "$DIST" | cut -f1)"

# A deploy that quietly shipped the source would be worse than a failed one.
if find "$DIST" -type d \( -name node_modules -o -name legacy -o -name src \) | grep -q .; then
  echo "ERROR: $DIST contains source or dependencies. Refusing to continue." >&2
  exit 1
fi
if [ ! -f "$DIST/app/index.html" ]; then
  echo "ERROR: $DIST/app/index.html is missing — the editor did not build." >&2
  exit 1
fi
echo "==> Checked: no source, no node_modules, editor present"

if [ "${1:-}" = "--deploy" ]; then
  # Catches the two setup mistakes that only show up as a broken sign-in on the
  # live site: an unauthorised CLI, and a build with no Supabase keys in it.
  ./scripts/preflight.sh || { echo "Preflight failed — not publishing." >&2; exit 1; }
  echo
  echo "==> Publishing to Cloudflare Pages project '$PROJECT'"
  npx wrangler pages deploy "$DIST" --project-name "$PROJECT"
else
  echo
  echo "Not published. Review $DIST, then run:"
  echo "  ./scripts/deploy.sh --deploy"
fi
