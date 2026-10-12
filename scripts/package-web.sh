#!/usr/bin/env bash
# Build the wasm package and assemble the static site (only what a browser needs) in dist/.
# Needs: rustup target add wasm32-unknown-unknown ; cargo install wasm-bindgen-cli --version 0.2.100
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build-web.sh >/dev/null
rm -rf dist
mkdir -p dist/pkg dist/cities
cp web/index.html web/style.css dist/
# every page script except the dev-only fake engine (web/dev-mock.js, loaded only with ?mock=1)
for f in web/*.js; do
  [ "$(basename "$f")" = "dev-mock.js" ] || cp "$f" dist/
done
cp web/pkg/micropolis_wasm.js web/pkg/micropolis_wasm_bg.wasm dist/pkg/
cp assets/cities/*.cty dist/cities/
echo "dist/ ready: $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
