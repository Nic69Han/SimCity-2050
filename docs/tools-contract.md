# Building tools: contract between layers

Applies ARCHITECTURE.md (hexagonal): the core decides everything (costs, validity,
effects); the wasm adapter only translates; the page only displays and forwards input.

## Core (`crates/micropolis-core`, `tool.rs`) — already ported and validated per tool
`Simulation::tool_down(tool, x, y) -> ToolResult` (click), `Simulation::tool_drag(tool, x0, y0, x1, y1)`
(drag step; for tools of size > 1 it places at `(x1, y1)`), `Simulation::query_tool`, `do_zone_status`.
`ToolResult` codes: `NoMoney = -2`, `NeedBulldoze = -1`, `Failed = 0`, `Ok = 1`.

### To add in the core (agent "toolcore")
* `EditingTool::{ALL, cost(), size(), key()}`: cost in dollars (table in `tool.rs`), size in tiles (1, 3, 4 or 6),
  `key()` a stable ASCII id like `"road"`, `"residential"`, `"coal_power"`.
* `Simulation::tool_preview(tool, x, y) -> ToolPreview { result: ToolResult, cost: i32 }`: dry run, **no state
  change at all** (no tile, funds, rng, events or map_serial change); `result` is what `tool_down` would
  return (including `NoMoney` when funds are insufficient), `cost` the total cost it would charge.
* Placement origin: for a tool of size `s > 1`, `(x, y)` is the tile the C++ passes to `build_building`
  (the centre-ish tile); `EditingTool::footprint(x, y) -> (x0, y0, w, h)` gives the covered rectangle so
  the UI can draw the outline.

## wasm adapter (`crates/micropolis-wasm`, class `City`) — wave 2
```
tool_count() -> u32
tool_info(i: u32) -> Int32Array [id, cost, size]     // id = EditingTool index
tool_key(i: u32) -> string
tool_down(id: i32, x: i32, y: i32) -> i32            // ToolResult code
tool_drag(id: i32, x0, y0, x1, y1) -> void
tool_preview(id: i32, x: i32, y: i32) -> Int32Array  // [result, cost]
tool_footprint(id: i32, x: i32, y: i32) -> Int32Array // [x0, y0, w, h]
query(x: i32, y: i32) -> string                      // zone status text, '' if none
new_random_city(seed: i32) -> void
```
## Page (`web/`)
Palette of tools, hover outline coloured by `tool_preview` (green ok / red not ok), click = `tool_down`,
drag = `tool_drag(last_tile, current_tile)`; a status line explains `ToolResult` codes; keyboard
shortcuts; works with mouse and touch (pointer events). The page keeps no game state.

## Differential tests (agents "toolscript", "newcity")
`reference/oracle` and `examples/fingerprint` gain a script mode so that tool actions applied during a run
must give identical per-tick fingerprints in C++ and Rust.
