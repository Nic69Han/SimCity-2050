// Deterministic fake of the wasm `City` (docs/tools-contract.md), for `node --test` and for
// the dev-only page (?mock=1). It is NOT the engine: its rules are simple stand-ins so that
// the page logic can be exercised. Costs and sizes copy crates/micropolis-core/src/tool.rs.
//
// Mock rules (documented so tests can rely on them):
//   - origin off the map, or any footprint tile off the map or on water -> Failed (0), cost 0
//   - footprint on rubble and tool is not bulldozer                  -> NeedBulldoze (-1)
//   - funds below the cost                                           -> NoMoney (-2)
//   - otherwise Ok (1); the cost is charged, bulldozer clears rubble, others build (tile 64)
//   - query never changes state; query text is '' on bare dirt
//   - footprint origin: size 1 at (x, y); size 3 starts at (x-1, y-1); size 4 at (x-1, y-1);
//     size 6 at (x-2, y-2)

export const RESULT = Object.freeze({ NO_MONEY: -2, NEED_BULLDOZE: -1, FAILED: 0, OK: 1 });

export const DIRT = 0;
export const WATER = 2;
export const RUBBLE = 36;
export const BUILDING = 64;

// Index = EditingTool index (tool.rs order). cost in dollars, size in tiles.
export const MOCK_TOOLS = Object.freeze([
  { key: "residential", cost: 100, size: 3 },
  { key: "commercial", cost: 100, size: 3 },
  { key: "industrial", cost: 100, size: 3 },
  { key: "fire_station", cost: 500, size: 3 },
  { key: "police_station", cost: 500, size: 3 },
  { key: "query", cost: 0, size: 1 },
  { key: "wire", cost: 5, size: 1 },
  { key: "bulldozer", cost: 1, size: 1 },
  { key: "railroad", cost: 20, size: 1 },
  { key: "road", cost: 10, size: 1 },
  { key: "stadium", cost: 5000, size: 4 },
  { key: "park", cost: 10, size: 1 },
  { key: "seaport", cost: 3000, size: 4 },
  { key: "coal_power", cost: 3000, size: 4 },
  { key: "nuclear_power", cost: 5000, size: 4 },
  { key: "airport", cost: 10000, size: 6 },
  { key: "network", cost: 100, size: 1 },
  { key: "water", cost: 0, size: 1 },
  { key: "land", cost: 0, size: 1 },
  { key: "forest", cost: 0, size: 1 },
]);

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const OFFSET = { 1: 0, 3: 1, 4: 1, 6: 2 };

export class MockCity {
  #width;
  #height;
  #map; // column-major like the engine: tiles[x * height + y]
  #funds;
  #speed = 2;

  // Every successful or failed tool_down and every tool_drag, in call order.
  log = [];

  constructor(seed = 1, { width = 40, height = 30, funds = 20000, rubble = 60 } = {}) {
    this.#width = width;
    this.#height = height;
    this.#funds = funds;
    this.#map = new Uint16Array(width * height).fill(DIRT);
    const rnd = lcg(seed);
    // a lake in the top-left corner, then some rubble patches away from it
    for (let x = 3; x < 10; x++) for (let y = 3; y < 8; y++) this.#set(x, y, WATER);
    for (let i = 0; i < rubble; i++) {
      const x = Math.floor(rnd() * width);
      const y = Math.floor(rnd() * height);
      if (this.#get(x, y) === DIRT) this.#set(x, y, RUBBLE);
    }
  }

  #inside(x, y) {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.#width && y < this.#height;
  }
  #get(x, y) {
    return this.#map[x * this.#height + y];
  }
  #set(x, y, t) {
    this.#map[x * this.#height + y] = t;
  }
  #tool(id) {
    return Number.isInteger(id) && id >= 0 && id < MOCK_TOOLS.length ? MOCK_TOOLS[id] : null;
  }

  // [x0, y0, w, h] covered by tool `id` placed at (x, y).
  #footprint(id, x, y) {
    const t = this.#tool(id);
    if (!t) return [x, y, 0, 0];
    const off = OFFSET[t.size] ?? 0;
    return [x - off, y - off, t.size, t.size];
  }

  // Dry run: { result, cost } exactly as tool_down would decide, without changing state.
  #verdict(id, x, y) {
    const t = this.#tool(id);
    if (!t) return { result: RESULT.FAILED, cost: 0 };
    if (t.key === "query") return { result: RESULT.OK, cost: 0 };
    const [x0, y0, w, h] = this.#footprint(id, x, y);
    let rubble = false;
    for (let i = x0; i < x0 + w; i++) {
      for (let j = y0; j < y0 + h; j++) {
        if (!this.#inside(i, j)) return { result: RESULT.FAILED, cost: 0 };
        const tile = this.#get(i, j);
        if (tile === WATER) return { result: RESULT.FAILED, cost: 0 };
        if (tile === RUBBLE) rubble = true;
      }
    }
    if (rubble && t.key !== "bulldozer") return { result: RESULT.NEED_BULLDOZE, cost: t.cost };
    if (this.#funds < t.cost) return { result: RESULT.NO_MONEY, cost: t.cost };
    return { result: RESULT.OK, cost: t.cost };
  }

  tool_count() {
    return MOCK_TOOLS.length;
  }
  tool_info(i) {
    const t = MOCK_TOOLS[i];
    if (!t) throw new RangeError(`no tool ${i}`);
    return Int32Array.of(i, t.cost, t.size);
  }
  tool_key(i) {
    const t = MOCK_TOOLS[i];
    if (!t) throw new RangeError(`no tool ${i}`);
    return t.key;
  }
  tool_preview(id, x, y) {
    const v = this.#verdict(id, x, y);
    return Int32Array.of(v.result, v.cost);
  }
  tool_footprint(id, x, y) {
    return Int32Array.of(...this.#footprint(id, x, y));
  }
  tool_down(id, x, y) {
    const v = this.#verdict(id, x, y);
    const t = this.#tool(id);
    if (v.result === RESULT.OK && t && t.key !== "query") {
      this.#funds -= v.cost;
      const [x0, y0, w, h] = this.#footprint(id, x, y);
      for (let i = x0; i < x0 + w; i++) {
        for (let j = y0; j < y0 + h; j++) {
          if (t.key === "bulldozer") {
            if (this.#get(i, j) === RUBBLE) this.#set(i, j, DIRT);
          } else {
            this.#set(i, j, BUILDING);
          }
        }
      }
    }
    if (t) this.log.push({ op: "down", tool: t.key, x, y, result: v.result });
    return v.result;
  }
  // The engine decides what a drag places; the mock only records the call and, for size-1
  // tools, places at the new tile (like the C++ UI does for single-tile tools).
  tool_drag(id, x0, y0, x1, y1) {
    const t = this.#tool(id);
    this.log.push({ op: "drag", tool: t?.key, x0, y0, x1, y1 });
    if (t && t.size === 1 && t.key !== "query") this.tool_down(id, x1, y1);
  }
  query(x, y) {
    if (!this.#inside(x, y)) return "";
    const tile = this.#get(x, y);
    if (tile === WATER) return `Tuile (${x}, ${y}) : eau`;
    if (tile === RUBBLE) return `Tuile (${x}, ${y}) : décombres`;
    if (tile === BUILDING) return `Tuile (${x}, ${y}) : bâtiment`;
    return "";
  }

  // --- city state used by the page (not part of the tool contract) ---
  width() {
    return this.#width;
  }
  height() {
    return this.#height;
  }
  tiles() {
    return this.#map.slice();
  }
  funds() {
    return this.#funds;
  }
  year() {
    return 1900;
  }
  month() {
    return 0;
  }
  population() {
    return 0;
  }
  score() {
    return 0;
  }
  demand() {
    return [0, 0, 0];
  }
  speed() {
    return this.#speed;
  }
  set_speed(s) {
    this.#speed = s;
  }
  enable_disasters() {}
  tick() {}
  load_cty() {}
  take_events() {
    return 0;
  }
  save_cty() {
    return new Uint8Array(0);
  }
}
