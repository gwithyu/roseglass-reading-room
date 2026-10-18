#!/usr/bin/env bash
# Public Roseglass: guarded anonymous Netlify PREVIEW only. Never deploy to production.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22+ is required. Please install Node or run: nvm use 22' >&2; exit 1
fi
NODE_MAJOR="$(node -p 'parseInt(process.versions.node.split(".")[0],10)')"
if (( NODE_MAJOR < 22 )); then
  echo 'Node.js 22+ is required. In your Mac terminal: nvm use 22' >&2; exit 1
fi
if [[ ! -f netlify.toml || ! -f netlify/functions/chat.mjs || ! -f scripts/build-public.mjs ]]; then
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

echo
echo 'You are about to create a PUBLIC, temporary Netlify draft URL.'
echo 'No Plus plugin, no GitHub Actions, no author-paid model quota, no production deploy.'
echo 'Netlify anonymous previews must be claimed within one hour or will be removed.'
read -r -p 'Create this public preview now? Type YES to proceed: ' ACK
if [[ "$ACK" != "YES" ]]; then
  echo 'Canceled without contacting Netlify.'
  exit 0
fi

# Avoid passing accidental owner AI tokens to the deployment CLI.
unset OPENAI_API_KEY DEEPSEEK_API_KEY DASHSCOPE_API_KEY MOONSHOT_API_KEY CLOUDFLARE_API_TOKEN RG_TOKEN || true

echo '=== Deploy temporary DRAFT only (requires network, may use free Netlify allowances) ==='
npx --yes netlify-cli@latest deploy \
  --allow-anonymous \
  --no-build \
  --dir dist-public \
  --functions netlify/functions
echo 'Check the returned URL and /api/health before claiming or publishing.'
