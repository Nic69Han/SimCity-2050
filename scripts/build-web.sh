#!/usr/bin/env bash
# Build the wasm adapter into web/pkg and copy sample cities into web/cities.
# Needs: rustup target add wasm32-unknown-unknown ; cargo install wasm-bindgen-cli --version 0.2.100
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -p micropolis-wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir web/pkg \
  target/wasm32-unknown-unknown/release/micropolis_wasm.wasm
mkdir -p web/cities
cp assets/cities/*.cty web/cities/
echo "Done. Serve with: python3 -m http.server -d web 8000"
