#!/usr/bin/env bash
# Public Roseglass: guarded AUTHENTICATED Netlify DRAFT only. Never deploy to production.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22+ is required. Please install Node or run: nvm use 22' >&2; exit 1
fi
NODE_MAJOR="$(node -p 'parseInt(process.versions.node.split(".")[0],10)')"
if (( NODE_MAJOR < 22 )); then
  echo 'Node.js 22+ is required. In your Mac terminal: nvm use 22' >&2; exit 1
fi
if [[ ! -f netlify.toml || ! -f netlify/functions/chat.mjs || ! -f netlify/functions/health.mjs || ! -f scripts/build-public.mjs ]]; then
  echo 'Missing public standalone site files; do not deploy.' >&2; exit 1
fi
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BRANCH="$(git branch --show-current)"
  if [[ "$BRANCH" != "feature/public-byok-local-bridge-20261018" ]]; then
    echo "Wrong branch: '$BRANCH'. Preview is limited to the audited public BYOK branch." >&2; exit 1
  fi
fi

echo '=== Offline tests (zero paid model calls, zero GitHub Actions) ==='
node --test \
  tests/invite-links.test.mjs \
  tests/api-ui.test.mjs \
  tests/pages-byok.test.mjs \
  tests/netlify-byok.test.mjs \
  tests/pages-build.test.mjs

echo '=== Build public-only files ==='
node scripts/build-public.mjs

echo '=== Bundle Netlify API Functions locally before asking to deploy ==='
FN_CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/roseglass-functions-preflight.XXXXXX")"
trap 'rm -rf "$FN_CHECK_DIR"' EXIT
npx --yes netlify-cli@latest functions:build --src netlify/functions --functions "$FN_CHECK_DIR"
if [[ -z "$(find "$FN_CHECK_DIR" -type f -print -quit)" ]]; then
  echo 'Netlify produced no Function build artifacts; refusing to deploy.' >&2
  exit 1
fi
echo 'Local Netlify Function packaging passed.'

echo
echo 'Netlify Functions require an authenticated Netlify account (Free is supported).'
echo 'Before continuing, log in on YOUR Mac with: npx --yes netlify-cli@latest login'
echo 'You are about to deploy a PUBLIC Netlify draft with working AI Functions.'
echo 'No Plus plugin, no GitHub Actions, no author-paid model quota, no production deploy.'
echo 'Account is required: anonymous deploy cannot provide functioning API backend.'
read -r -p 'Create this public preview now? Type YES to proceed: ' ACK
if [[ "$ACK" != "YES" ]]; then
  echo 'Canceled without contacting Netlify.'
  exit 0
fi

# Avoid passing accidental owner AI tokens to the deployment CLI.
unset OPENAI_API_KEY DEEPSEEK_API_KEY DASHSCOPE_API_KEY MOONSHOT_API_KEY CLOUDFLARE_API_TOKEN RG_TOKEN || true

echo '=== Deploy DRAFT with functions (requires Netlify login + network + free credits) ==='
npx --yes netlify-cli@latest deploy \
  --no-build \
  --dir dist-public \
  --functions netlify/functions
echo 'Check the returned DRAFT URL and /api/health before any production deployment.'
