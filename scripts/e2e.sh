#!/usr/bin/env bash
# End-to-end tests of the page (web/) on the real wasm engine, in Chromium driven by Playwright.
#   1. scripts/build-web.sh: the wasm package (web/pkg) and the sample cities (web/cities);
#   2. python3 serves web/ on a free local port, stopped when the script exits;
#   3. node --test runs web/e2e/*.test.mjs with E2E_BASE_URL pointing at that server.
# Playwright: the global install at /opt/node22 when present, else web/e2e/node_modules
# (installed with npm ci). Browser: $E2E_CHROMIUM when set; else the Chromium that
# `npx playwright install --with-deps chromium` (in web/e2e) installed.
# Optional: E2E_SHOTS_DIR=<dir> saves screenshots of the key states there.
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/build-web.sh

GLOBAL_PLAYWRIGHT=/opt/node22/lib/node_modules/playwright/index.mjs
if [ ! -f "$GLOBAL_PLAYWRIGHT" ] && [ ! -d web/e2e/node_modules/playwright ]; then
  (cd web/e2e && npm ci)
fi

if [ -n "${E2E_PORT:-}" ]; then
  PORT="$E2E_PORT"
else
  PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
fi
SERVER_LOG="$(mktemp)"
python3 -m http.server -d web "$PORT" --bind 127.0.0.1 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then break; fi
  sleep 0.1
done
if ! curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then
  cat "$SERVER_LOG" >&2
  echo "e2e: the static server did not start on port $PORT" >&2
  exit 1
fi

export E2E_BASE_URL="http://127.0.0.1:$PORT/"
node --test --test-concurrency=1 web/e2e/*.test.mjs
