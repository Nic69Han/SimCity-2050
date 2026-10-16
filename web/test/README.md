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
- `playback.test.mjs`: the play loop (one animation-frame loop at most, cancelled on pause,
  Lecture/Pause/Lecture in one frame) and ticks per frame by speed.
- `latest.test.mjs`: "latest wins" for the asynchronous city loads (a late sample does not
  replace a newer city or file).
- `status.test.mjs`: status line, stats line and load message text (formatted from engine numbers).
- `view3d-model.test.mjs`: the 3D view's pure part (`web/view3d-model.js`): altitudes and their
  column-major layout (`heights[i]` matches `tiles[i]`), height to world units, chunk diffing, tile
  classification, chunk geometry and volumes, picking by ray, and the mock's relief.
- `pointer-seam.test.mjs`: `attachPointer` with a view's own `tileOf` and the abort signal.
- `wasm-contract.test.mjs` (when present) is written by another agent against the real wasm.
- `relief.test.mjs`: relief rules (`web/relief.js`: the checkbox reads and sets the engine's flag, the
  reason the terraforming buttons are off), the terraforming catalog entries (keys U and D, the Terrain
  group, the engine calls and the drag line), and the mock's terraform rules (cost, cascade, refusals).
- `tutorial.test.mjs`: the guided first steps (`web/tutorial-model.js`): each step's check on hand-made tile
  arrays (zone, road touching a zone, power plant, powered zone with a power line, commercial and industrial
  zones, time advanced, population), the order and no regression of `progress`, the tile digest, the record
  kept per browser and a storage that throws.

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
- `load.test.mjs`: first load (sample city, date, funds, 20 French tools, "Chargement…" until the
  sample is in), another sample city, keyboard shortcuts, a 390 px phone viewport.
- `build.test.mjs`: road drag (funds = sum of the previewed costs), residential zone, placement
  on water (failure message, no bulldozer), no money left (the refusal, nothing built), query
  tool (French zone status), a touch tap.
- `city.test.mjs`: new city with seeds (same seed, same pixels), Lecture and Pause (one loop,
  no frame while paused), a refused file (its own live region, the status line kept), the city
  selector ("Ville aléatoire", "Fichier local", a sample re-loads), save and re-open of a .cty
  (27 120 bytes).
- `relief.test.mjs` (e2e, `?mock=1`): the Règles de relief checkbox, the disabled buttons and their reasons,
  raise/lower/refusal in the 3D view against the mock's costs, a new city and a loaded file showing the
  engine's flag. The real-engine part is skipped while the wasm build has no `terraform()`.
- `tutorial.test.mjs` (e2e, real wasm): a new city shows step 1, a residential zone placed with the tool
  moves the guide to step 2; «Passer» and «Recommencer» with the choice kept over a reload; a sample or an
  opened file starts folded; on the built Haight-Ashbury city steps 1 to 5 are read as done and playing
  completes the guide.
- `play.test.mjs`: the speed slider and the Catastrophes checkbox reach the engine: after N
  frames the status and stats lines equal those of the shadow engine run for the same ticks.

Each test asserts that no console error, page error or failed request happened.
There are no `todo` tests: a known page bug is fixed, or it is a failing test (the run fails).

## Saves (web/saves.js, web/storage.js, web/errors.js)

- `saves.test.mjs`: the autosave schedule with a fake clock (a write each minute only while
  something changed, nothing before the startup question is answered), the digest skip, the
  quota error path (reported, retried), names and metadata text, engine detection
  (save_city / load_city, else save_cty / load_cty), page preferences (kept, corrupt values
  ignored, a blocked store does not throw).
- `storage.test.mjs`: the port over the in-memory adapter (copies, corrupt records listed as
  corrupt, quota), and the IndexedDB adapter over a small fake IDBFactory (open, transactions,
  a missing or refused IndexedDB is "unavailable").
- `errors.test.mjs`: engine codes (`<code>: <detail>`) and the legacy English messages to French;
  storage codes to French.

Dev hook (end-to-end tests only): `window.__saves.flush()` writes the autosave now, when the city
changed since the last write, and resolves to "saved", "same", "skipped", "idle" or "error". The
timer is a minute; the tests do not wait for it. It holds no game state.
