# Tests for the page (web/)

These tests need no browser. They exercise the pure modules `web/tools.js` and
`web/input.js` against a mock engine (`web/test/mock-engine.mjs`), not against the
wasm `City`.

Run them from the repository root, with Node 22 or newer:

```sh
node --test web/test/*.test.mjs
```

Note: `node --test web/test/` (a directory argument) does not work since Node 21,
which only accepts file paths or globs; the shell glob above is the equivalent.

Files:

- `input.test.mjs`: pixel -> tile conversion with CSS scaling, drag sequences (tool_drag
  only on consecutive distinct tiles), big tools, inspect (query) tools.
- `tools.test.mjs`: result -> French message for every ToolResult code, feature
  detection fallback (no tool API -> no palette), catalog and groups, shortcut table,
  hover outline geometry and colour verdict.
- `query.test.mjs`: zone status (`city.query`, an Int32Array) -> French lines, every
  index of the C++ doZoneStatus (STR202 + 1, category k + 1), unknown indices.
- `palette.test.mjs`: tile colours shared by the renderer and the legend; no overlaps;
  the legend's rows; the renderer table agrees with the lookup.
- `newcity.test.mjs`: seed box parsing (empty = random, clamp to i32, errors), random
  seeds (31-bit, never 0), feature detection, the mock's `new_random_city`.
- `mock-engine.mjs`: deterministic fake `City` implementing the tool contract of
  `docs/tools-contract.md`. Its rules are documented at the top of the file.
- `wasm-contract.test.mjs` (when present) is written by another agent against the real wasm.

## End-to-end tests (web/e2e)

`web/e2e/*.test.mjs` drive the real page in Chromium (Playwright 1.56.1) on the real wasm
engine. Run them from the repository root:

```sh
./scripts/e2e.sh
```

The script builds the wasm package (`scripts/build-web.sh`), serves `web/` on a free local
port, runs `node --test --test-concurrency=1 web/e2e/*.test.mjs` with `E2E_BASE_URL` set, and
stops the server on exit. Needs the wasm target, wasm-bindgen-cli 0.2.100, and a browser:
`E2E_CHROMIUM=<path>` picks one; otherwise the Chromium of `npx playwright install --with-deps chromium`
(run in `web/e2e`, after `npm ci` there) is used. `E2E_SHOTS_DIR=<dir>` saves screenshots of key states.

Files:

- `helpers.mjs`: launch, page with console and page error collection, tile geometry (tile to
  client pixel, canvas tile colours read from the pixels), status line parsing (date, funds,
  seed), the hover outline verdict, and the "shadow" engine: the same `web/pkg` loaded in Node
  from the same bytes, which gives the engine cost of a tool at a tile (the hover label is drawn
  on a canvas and cannot be read from the DOM).
- `load.test.mjs`: first load (sample city, date, funds, 20 French tools), another sample city,
  keyboard shortcuts, a 390 px phone viewport.
- `build.test.mjs`: road drag (funds = sum of the previewed costs), residential zone, placement
  on water (failure message), query tool (French zone status), a touch tap.
- `city.test.mjs`: new city with seeds (same seed, same pixels), Lecture and Pause, a refused
  file, save and re-open of a .cty (27 120 bytes).

Each test asserts that no console error, page error or failed request happened.
Known page bugs are kept as `todo` tests (they run and are reported, but do not fail the run):
the test names say what the page should do, and a `// BUG` comment above each says where.
