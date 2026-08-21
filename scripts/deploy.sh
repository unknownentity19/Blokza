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

PROJECT="${CF_PAGES_PROJECT:-altask}"
DIST="dist"

echo "==> Building the editor"
npm --prefix builder run build

echo "==> Assembling $DIST"
rm -rf "$DIST"
mkdir -p "$DIST"

# The marketing pages, and the files a host reads from the site root.
cp ./*.html "$DIST"/
for f in robots.txt sitemap.xml site.webmanifest _headers _redirects; do
  [ -f "$f" ] && cp "$f" "$DIST"/
done

# Shared assets and the built editor. `.DS_Store` is excluded everywhere: it is
# noise, and it lists filenames that are nobody else's business.
rsync -a --exclude '.DS_Store' assets "$DIST"/
rsync -a --exclude '.DS_Store' app "$DIST"/

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
