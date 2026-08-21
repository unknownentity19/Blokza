#!/usr/bin/env bash
#
# Check everything that can be checked without signing in as you.
#
# Three steps in the setup need your account and cannot be automated here:
# creating the Cloudflare and Supabase accounts, and authorising Wrangler. This
# script covers the rest — and, more usefully, *verifies* the parts you did by
# hand, so a mistake shows up now rather than as a broken sign-in on the live
# site.
#
# Nothing here writes to your project or publishes anything.
#
#   ./scripts/preflight.sh
#
# Exit status is 0 only when everything needed for a working deploy is present.

set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0
FAIL=0
TODO=()

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
info() { printf '    %s\n' "$1"; }
todo() { TODO+=("$1"); }

echo
echo "Altask deploy preflight"
echo "======================="

# ---------------------------------------------------------------- toolchain
echo
echo "Toolchain"
if command -v node >/dev/null 2>&1; then
  ok "node $(node --version)"
else
  bad "node is not installed"
  todo "Install Node.js 18 or newer: https://nodejs.org"
fi

if [ -d builder/node_modules ]; then
  ok "builder dependencies installed"
else
  bad "builder dependencies are missing"
  todo "Run: npm --prefix builder install"
fi

# ---------------------------------------------------------------- cloudflare
echo
echo "Cloudflare"
WHOAMI="$(npx --yes wrangler whoami 2>&1 || true)"
if printf '%s' "$WHOAMI" | grep -qiE 'you are logged in|associated with the email|account id'; then
  ACCOUNT="$(printf '%s' "$WHOAMI" | grep -oiE '[a-z0-9._%+-]+@[a-z0-9.-]+' | head -1)"
  ok "Wrangler is authorised${ACCOUNT:+ as $ACCOUNT}"
else
  bad "Wrangler is not authorised"
  info "This one has to be you — it signs in to your Cloudflare account."
  todo "Run: npx wrangler login   (opens a browser, then come back)"
fi

# ---------------------------------------------------------------- supabase
echo
echo "Supabase"
ENV_FILE="builder/.env.local"
SUPA_URL=""
SUPA_KEY=""
if [ -f "$ENV_FILE" ]; then
  SUPA_URL="$(grep -E '^VITE_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)"
  SUPA_KEY="$(grep -E '^VITE_SUPABASE_ANON_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)"
fi

if [ -z "$SUPA_URL" ] || [ -z "$SUPA_KEY" ]; then
  bad "$ENV_FILE has no project URL and anon key"
  info "Supabase → Project Settings → API. Both values are public by design."
  todo "Create $ENV_FILE containing:
      VITE_SUPABASE_URL=https://yourproject.supabase.co
      VITE_SUPABASE_ANON_KEY=eyJhbGciOi..."
elif printf '%s' "$SUPA_URL" | grep -q 'yourproject\|dummy'; then
  bad "$ENV_FILE still holds the placeholder values"
  todo "Replace the placeholders in $ENV_FILE with your real project URL and anon key"
else
  ok "$ENV_FILE has a project URL and anon key"

  # Is the project awake? A paused free-tier project is indistinguishable from
  # being offline, and it is the most common reason sign-in stops working.
  API_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "apikey: $SUPA_KEY" "$SUPA_URL/rest/v1/" 2>/dev/null || echo 000)"
  case "$API_STATUS" in
    200) ok "project is reachable and awake" ;;
    000) bad "could not reach $SUPA_URL"
         info "Wrong URL, no network, or the free project is paused."
         todo "Open the Supabase dashboard; if the project is paused, resume it" ;;
    401|403) bad "the project rejected the anon key (HTTP $API_STATUS)"
         todo "Re-copy the anon public key from Project Settings → API" ;;
    *)   bad "unexpected response from the project (HTTP $API_STATUS)" ;;
  esac

  if [ "$API_STATUS" = "200" ]; then
    # Does the sites table exist, and does row-level security hide other
    # people's rows from an unauthenticated request?
    BODY="$(curl -s --max-time 10 -H "apikey: $SUPA_KEY" \
      "$SUPA_URL/rest/v1/sites?select=id&limit=1" 2>/dev/null || true)"
    if printf '%s' "$BODY" | grep -q 'PGRST205\|does not exist\|Could not find the table'; then
      bad "the sites table does not exist"
      todo "Paste supabase/schema.sql into the Supabase SQL editor and run it"
    elif [ "$BODY" = "[]" ]; then
      ok "sites table exists, and an unauthenticated read returns nothing"
      info "That is row-level security doing its job — the anon key alone sees no rows."
    elif printf '%s' "$BODY" | grep -q '^\[{'; then
      bad "an unauthenticated read returned rows — row-level security is not protecting the table"
      info "Anyone with the anon key could read your sites. This must be fixed before deploying."
      todo "Re-run supabase/schema.sql; check 'alter table public.sites enable row level security' applied"
    else
      bad "unexpected reply when reading the sites table"
      info "$(printf '%s' "$BODY" | head -c 160)"
    fi
  fi
fi

# ---------------------------------------------------------------- the build
echo
echo "Build"
if [ -f _redirects ]; then
  ok "_redirects present (Cloudflare ignores netlify.toml)"
else
  bad "_redirects is missing — every redirect would silently vanish on deploy"
fi
[ -f _headers ] && ok "_headers present" || bad "_headers is missing"

if npm --prefix builder test >/tmp/altask-preflight-test.log 2>&1; then
  ok "tests pass ($(grep -oE 'Tests +[0-9]+ passed' /tmp/altask-preflight-test.log | tail -1 | tr -s ' '))"
else
  bad "tests are failing"
  info "See /tmp/altask-preflight-test.log"
  todo "Fix the failing tests before deploying"
fi

# ---------------------------------------------------------------- verdict
echo
echo "-----------------------------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  echo "All $PASS checks passed. Ready to deploy:"
  echo
  echo "  ./scripts/deploy.sh --deploy"
  echo
  exit 0
fi

echo "$PASS passed, $FAIL need attention."
echo
echo "Your turn — these need your accounts and cannot be done for you:"
for i in "${!TODO[@]}"; do
  printf '  %d. %s\n' "$((i + 1))" "${TODO[$i]}"
done
echo
echo "Then run this again:  ./scripts/preflight.sh"
echo
exit 1
