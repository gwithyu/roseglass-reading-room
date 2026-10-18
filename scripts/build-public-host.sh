#!/usr/bin/env bash
set -euo pipefail
# Compile the self-contained MCP module; only safe static-reader assets are
# copied into Vercel's public output directory.
bash mcp-reader/scripts/build.sh
mkdir -p public/src
cp index.html public/index.html
cp src/*.js src/*.mjs src/*.css public/src/
cp privacy.html public/privacy.html
printf 'Roseglass public assets and MCP module built.\\n'
