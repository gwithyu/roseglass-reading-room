#!/usr/bin/env bash
# Public Roseglass: guarded AUTHENTICATED Netlify DRAFT only. Never deploy to production.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

# Refuse to inherit the owner's personal AI credentials during ANY preflight or CLI command.
unset OPENAI_API_KEY DEEPSEEK_API_KEY DASHSCOPE_API_KEY MOONSHOT_API_KEY CLOUDFLARE_API_TOKEN RG_TOKEN || true

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

echo '=== Complete standalone reader test suite (zero paid model calls, zero GitHub Actions) ==='
node --test tests/*.test.mjs
node tests/smoke.mjs

echo '=== Build public-only files ==='
node scripts/build-public.mjs

echo '=== Bundle Netlify API Functions locally before asking to deploy ==='
FN_CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/roseglass-functions-preflight.XXXXXX")"
trap 'rm -rf "$FN_CHECK_DIR"' EXIT
npx --yes netlify-cli@latest functions:build --src netlify/functions --functions "$FN_CHECK_DIR"
# Both public routes must have runnable build artifacts. A successful CLI exit
# with only one Function would leave the reading room partly broken.
for fn in chat health; do
  artifact="$(find "$FN_CHECK_DIR" -type f \( -name "$fn.zip" -o -name "$fn.mjs" -o -name "$fn.js" -o -path "*/$fn/*" \) -print -quit)"
  if [[ -z "$artifact" ]]; then
    echo "Netlify Function '$fn' was not bundled; refusing to deploy." >&2
    exit 1
  fi
done
echo 'Both Netlify API Functions (chat + health) packaged successfully.'

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


echo '=== Deploy DRAFT with functions (requires Netlify login + network + free credits) ==='
npx --yes netlify-cli@latest deploy \
  --no-build \
  --dir dist-public \
  --functions netlify/functions
echo 'Check the returned DRAFT URL and /api/health before any production deployment.'
