#!/usr/bin/env bash
# Contract test of the compiled wasm adapter: builds micropolis-wasm for wasm32, runs
# wasm-bindgen --target nodejs into a temporary directory, then runs the Node tests
# web/test/wasm-*.test.mjs (contract, sizes, budget...) against that build (through WASM_PKG_DIR).
# Needs: rustup target add wasm32-unknown-unknown ; cargo install wasm-bindgen-cli --version 0.2.100
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build -p micropolis-wasm --target wasm32-unknown-unknown --release
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
wasm-bindgen --target nodejs --out-dir "$OUT" \
  target/wasm32-unknown-unknown/release/micropolis_wasm.wasm
WASM_PKG_DIR="$OUT" node --test web/test/wasm-*.test.mjs
