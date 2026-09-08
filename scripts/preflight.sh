#!/usr/bin/env bash
#
# Check everything that can be checked without signing in as you.
#
# The steps that need your account cannot be automated here: creating the Neon
# project, running the schema, and adding your origins to Neon Auth. This
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
echo "BLOKZA deploy preflight"
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

# ---------------------------------------------------------------- neon
echo
echo "Neon"
ENV_FILE="builder/.env.local"
DATA_URL=""
if [ -f "$ENV_FILE" ]; then
  DATA_URL="$(grep -E '^VITE_NEON_DATA_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)"
fi

if [ -z "$DATA_URL" ]; then
  bad "$ENV_FILE has no Data API URL"
  info "Neon Console -> Data API. The URL is public; the connection string is not."
  todo "Create $ENV_FILE containing:
      VITE_NEON_DATA_URL=https://ep-xxx.apirest.<region>.aws.neon.tech/neondb/rest/v1"
else
  ok "$ENV_FILE has a Data API URL"

  # An unauthenticated call must be refused, and refused for the right reason.
  # A 200 here would mean the table is readable by anyone holding the URL.
  BODY="$(curl -s --max-time 15 "$DATA_URL/sites?select=id&limit=1" 2>/dev/null || true)"
  if printf '%s' "$BODY" | grep -q 'authorization bearer token\|JWT'; then
    ok "the Data API is up and demands a token"
  elif printf '%s' "$BODY" | grep -q '^\[{'; then
    bad "an unauthenticated read returned rows — row-level security is not protecting the table"
    info "Anyone with the URL could read your sites. Fix before deploying."
    todo "Re-run neon/schema.sql; check 'alter table public.sites enable row level security' applied"
  elif [ "$BODY" = "[]" ]; then
    bad "an unauthenticated read succeeded and returned an empty set"
    info "The table is exposed without a token. That is not what the schema intends."
    todo "Re-run neon/schema.sql and confirm the anonymous role has no grant"
  elif printf '%s' "$BODY" | grep -qi 'does not exist\|PGRST'; then
    bad "the sites table is not exposed"
    todo "Paste neon/schema.sql into the Neon SQL editor and run it"
  else
    bad "could not reach the Data API"
    info "$(printf '%s' "$BODY" | head -c 160)"
    todo "Check the URL, and whether the project is suspended (free projects scale to zero)"
  fi
fi

# ---------------------------------------------------------------- neon auth
echo
echo "Neon Auth"
AUTH_URL="${NEON_AUTH_URL:-}"
if [ -z "$AUTH_URL" ]; then
  info "NEON_AUTH_URL is not set in this shell — it lives in the Vercel project."
  info "Export it here to check it: export NEON_AUTH_URL=https://ep-xxx.neonauth...../neondb/auth"
else
  if curl -s --max-time 15 "$AUTH_URL/ok" 2>/dev/null | grep -q '"ok":true'; then
    ok "auth endpoint is up"
  else
    bad "auth endpoint did not answer"
    todo "Check NEON_AUTH_URL against Neon Console -> Auth -> Configuration"
  fi

  # The failure that only shows up in production: localhost is trusted by
  # default, so an untrusted production origin passes every local test and
  # then answers 403 INVALID_ORIGIN on the live site.
  ORIGIN_CODE="$(curl -s --max-time 15 -X POST "$AUTH_URL/sign-in/email" \
    -H 'Content-Type: application/json' -H 'Origin: https://blokza.com' \
    -d '{"email":"preflight@example.invalid","password":"not-a-real-password"}' 2>/dev/null \
    | grep -o '"code":"[A-Z_]*"' | head -1 || true)"
  case "$ORIGIN_CODE" in
    *INVALID_ORIGIN*)
      bad "https://blokza.com is not a trusted origin"
      info "Sign-in works locally and fails only once deployed, which is why this is checked here."
      todo "Neon Console -> Auth -> Configuration: add https://blokza.com and your Vercel preview domain" ;;
    *) ok "https://blokza.com is a trusted origin" ;;
  esac
fi

# ---------------------------------------------------------------- the build
echo
echo "Build"
# The contact form posts to our own function, which needs a mailbox to send
# through. Missing credentials answer 503 and the visitor gets the fallback —
# survivable, but worth catching before the deploy rather than after.
if grep -q 'action="/api/contact"' contact.html 2>/dev/null; then
  ok "contact form posts to /api/contact"
else
  bad "the contact form does not point at /api/contact"
fi

if [ -f "api/contact.mjs" ]; then
  ok "the contact function is present"
else
  bad "api/contact.mjs is missing — the form would 404"
fi

# Only checkable from a shell that has them exported; they live in Vercel.
if [ -n "${SMTP_USER:-}" ] && [ -n "${SMTP_PASS:-}" ]; then
  ok "SMTP credentials are set in this shell"
else
  info "SMTP_USER / SMTP_PASS are not set here — they belong in the Vercel project."
  info "Without them /api/contact answers 503 and the form shows its fallback."
fi

if [ -f vercel.json ]; then
  ok "vercel.json present (headers, redirects and the function region)"
else
  bad "vercel.json is missing — headers and redirects would silently vanish on deploy"
fi
if [ -f "api/auth.mjs" ]; then
  ok "the auth proxy is present"
else
  bad "api/auth.mjs is missing — sign-in would have nowhere to go"
fi

if npm --prefix builder test >/tmp/blokza-preflight-test.log 2>&1; then
  ok "tests pass ($(grep -oE 'Tests +[0-9]+ passed' /tmp/blokza-preflight-test.log | tail -1 | tr -s ' '))"
else
  bad "tests are failing"
  info "See /tmp/blokza-preflight-test.log"
  todo "Fix the failing tests before deploying"
fi

# ---------------------------------------------------------------- verdict
echo
echo "-----------------------------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  echo "All $PASS checks passed. Push to deploy — Vercel builds from git."
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
