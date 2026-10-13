// Deterministic fake of the wasm `City` (docs/tools-contract.md), for `node --test` and for
// the dev-only page (?mock=1). It is NOT the engine: its rules are simple stand-ins so that
// the page logic can be exercised. Costs and sizes copy crates/micropolis-core/src/tool.rs.
//
// Mock rules (documented so tests can rely on them):
//   - origin off the map, or any footprint tile off the map or on water -> Failed (0), cost 0
//   - footprint on rubble and tool is not bulldozer                  -> NeedBulldoze (-1)
//   - funds below the cost                                           -> NoMoney (-2)
//   - otherwise Ok (1); the preview cost is charged, bulldozer clears rubble, others build their tile
//   - query never changes state; it returns Int32Array [] off the map, else
//     [category, density, land_value, crime, pollution, growth] (docs/tools-contract.md).
//     The category follows the tile (dirt reports 29, as the C++ does); the four other
//     values are deterministic functions of (x, y) covering every index of web/query.js.
//   - footprint origin: size 1 at (x, y); size 3 starts at (x-1, y-1); size 4 at (x-1, y-1);
//     size 6 at (x-2, y-2)
//   - heights() is the relief: one altitude 0..=63 per tile, index x * height + y, sea level 8
//   - relief rules (docs/3d.md, roadmap step 1): relief_rules() is off by default and after a new
//     city or a load (a file's flag is not modelled). Off, terraform returns 0 (Failed) and
//     terraform_preview [0, 0]. On, terraform(x, y, delta) moves the tile by one step (+1 raise,
//     -1 lower), then each dirt or tree neighbour whose slope to a moved tile is more than 2 steps
//     follows by one step, up to 3 tiles from the origin (each tile moves at most once). Cost:
//     10 dollars per moved tile. Water is refused (0), a building or rubble needs a bulldozer
//     (-1), a tile at 0 or 63 cannot move past it (0), funds below the cost give -2. Building
//     tools do not add a levelling surcharge in the mock.
//   - tiles are C++ tile character numbers (micropolis.h), so the page draws them in colour
//   - terrain adds cost: every tree tile under a building-type tool costs TREE_CLEAR more,
//     so tool_preview's cost differs from the catalog price (the page must show the preview's)
//   - new_random_city(seed) regenerates the map from the seed (same seed, same map), resets
//     the funds to the start value, and resets speed to 3 and disasters to on, as the wasm
//     adapter does (simInit defaults); the page must push its own settings back afterwards

export const RESULT = Object.freeze({ NO_MONEY: -2, NEED_BULLDOZE: -1, FAILED: 0, OK: 1 });

export const DIRT = 0;
export const WATER = 2;
export const TREES = 21;
export const RUBBLE = 44;
export const RESIDENTIAL = 240;
export const START_FUNDS = 20000;
export const TREE_CLEAR = 10; // extra dollars per tree tile cleared by a building tool
export const SEA_LEVEL = 8;
export const ALT_MAX = 63;
export const SLOPE = 2; // steps of altitude a neighbour may differ before the cascade follows
export const CASCADE_DEPTH = 3; // tiles from the origin a terraforming step can reach
export const TERRAFORM_COST = 10; // dollars per tile moved
const NO_TERRAIN_COST = new Set(["query", "bulldozer", "water", "land", "forest"]);

// Tile written by a successful build, per tool key (the rest of the tools write residential).
const TILE_OF = Object.freeze({
  road: 64, network: 64, wire: 208, railroad: 224, residential: 240, commercial: 423,
  industrial: 612, seaport: 693, airport: 709, coal_power: 745, fire_station: 761,
  police_station: 770, stadium: 779, nuclear_power: 811, park: TREES, forest: TREES,
  water: WATER, land: DIRT,
});

// Query category (string-table index, web/query.js) of a tile.
const CATEGORY_OF = new Map([
  [DIRT, 29], [WATER, 2], [TREES, 3], [RUBBLE, 4], [64, 8], [208, 9], [224, 10], [RESIDENTIAL, 11],
  [423, 12], [612, 13], [693, 14], [709, 15], [745, 16], [761, 17], [770, 18], [779, 19], [811, 20],
]);

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
  #rubble = 60;
  #disasters = true;
  #alt; // relief: one altitude per tile, index x * height + y (City.heights)
  #rules = false; // relief rules (City.relief_rules)
  seed = 1;

  // Every successful or failed tool_down and every tool_drag, in call order.
  log = [];

  constructor(seed = 1, { width = 40, height = 30, funds = START_FUNDS, rubble = 60 } = {}) {
    this.#width = width;
    this.#height = height;
    this.#funds = funds;
    this.#rubble = rubble;
    this.#generate(seed);
  }

  // Map from a seed: a lake in the top-left corner, then rubble patches. Deterministic.
  #generate(seed) {
    this.seed = seed | 0;
    this.#map = new Uint16Array(this.#width * this.#height).fill(DIRT);
    this.#alt = this.#reliefOf(this.seed);
    const rnd = lcg(this.seed);
    for (let x = 3; x < 10; x++) for (let y = 3; y < 8; y++) this.#set(x, y, WATER);
    for (let i = 0; i < this.#rubble; i++) {
      const x = Math.floor(rnd() * this.#width);
      const y = Math.floor(rnd() * this.#height);
      if (this.#get(x, y) === DIRT) this.#set(x, y, RUBBLE);
    }
  }

  // Same signature as the engine's new_random_city(seed: i32). The page keeps its own
  // speed and disasters settings; the engine's are kept here too, as the page re-applies them.
  new_random_city(seed) {
    this.#generate(seed | 0);
    this.#funds = START_FUNDS;
    this.#speed = 3; // engine defaults after a new city
    this.#disasters = true;
    this.#rules = false; // a new city starts with the rules off
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
    let trees = 0;
    for (let i = x0; i < x0 + w; i++) for (let j = y0; j < y0 + h; j++) if (this.#get(i, j) === TREES) trees++;
    const cost = t.cost + (NO_TERRAIN_COST.has(t.key) ? 0 : trees * TREE_CLEAR);
    if (rubble && t.key !== "bulldozer") return { result: RESULT.NEED_BULLDOZE, cost: t.cost };
    if (this.#funds < cost) return { result: RESULT.NO_MONEY, cost };
    return { result: RESULT.OK, cost };
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
            this.#set(i, j, TILE_OF[t.key] ?? RESIDENTIAL);
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
    if (!this.#inside(x, y)) return Int32Array.of();
    const category = CATEGORY_OF.get(this.#get(x, y)) ?? 1;
    // deterministic spread over every index of web/query.js (density 1-4, land 5-8, ...)
    return Int32Array.of(
      category,
      1 + ((x + y) % 4),
      5 + ((x * 3 + y) % 4),
      9 + (x % 4),
      13 + (y % 4),
      17 + ((x + 2 * y) % 4),
    );
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
  // Relief (City.heights, docs/3d.md): one altitude per tile, index x * height + y like tiles(),
  // 0..=63, sea level 8. A smooth fake hill country, independent of the tiles, deterministic for
  // the seed; neighbouring tiles differ by at most 2 (until terraforming changes them).
  heights() {
    return this.#alt.slice();
  }
  #reliefOf(seed) {
    const w = this.#width, h = this.#height;
    const out = new Uint8Array(w * h);
    const phase = ((seed >>> 0) % 997) * 0.01;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const v = SEA_LEVEL + 4 * Math.sin(x * 0.11 + phase) + 3 * Math.cos(y * 0.13 - 2 * phase) +
          2 * Math.sin((x + y) * 0.05 + 3 * phase);
        out[x * h + y] = Math.min(ALT_MAX, Math.max(0, Math.round(v)));
      }
    }
    return out;
  }
  relief_rules() {
    return this.#rules;
  }
  set_relief_rules(on) {
    this.#rules = Boolean(on);
  }
  // Dry run of terraform(x, y, delta): { result, cost, moves: [[index, altitude], ...] }.
  #terraformPlan(x, y, delta) {
    const none = { result: RESULT.FAILED, cost: 0, moves: [] };
    if (!this.#rules || !this.#inside(x, y) || (delta !== 1 && delta !== -1)) return none;
    const h = this.#height;
    const tile = this.#get(x, y);
    if (tile === WATER) return none;
    if (tile !== DIRT && tile !== TREES) return { result: RESULT.NEED_BULLDOZE, cost: 0, moves: [] };
    const at = new Map(); // index -> new altitude of the moved tiles
    const altOf = (i) => (at.has(i) ? at.get(i) : this.#alt[i]);
    const start = this.#alt[x * h + y] + delta;
    if (start < 0 || start > ALT_MAX) return none;
    at.set(x * h + y, start);
    const queue = [{ x, y, d: 0 }];
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      if (c.d === CASCADE_DEPTH) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, ny = c.y + dy;
        if (!this.#inside(nx, ny)) continue;
        const ni = nx * h + ny;
        if (at.has(ni)) continue;
        const nt = this.#get(nx, ny);
        if (nt !== DIRT && nt !== TREES) continue; // water, buildings and rubble stay as they are
        const here = altOf(c.x * h + c.y), cur = this.#alt[ni];
        let target = cur;
        if (here - cur > SLOPE) target = cur + 1;
        else if (cur - here > SLOPE) target = cur - 1;
        if (target === cur || target < 0 || target > ALT_MAX) continue;
        at.set(ni, target);
        queue.push({ x: nx, y: ny, d: c.d + 1 });
      }
    }
    const cost = TERRAFORM_COST * at.size;
    const result = this.#funds < cost ? RESULT.NO_MONEY : RESULT.OK;
    return { result, cost, moves: [...at] };
  }
  terraform_preview(x, y, delta) {
    const p = this.#terraformPlan(x, y, delta);
    return Int32Array.of(p.result, p.result === RESULT.OK || p.result === RESULT.NO_MONEY ? p.cost : 0);
  }
  terraform(x, y, delta) {
    const p = this.#terraformPlan(x, y, delta);
    if (p.result === RESULT.OK) {
      this.#funds -= p.cost;
      for (const [i, v] of p.moves) this.#alt[i] = v;
    }
    this.log.push({ op: "terraform", x, y, delta, result: p.result });
    return p.result;
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
  enable_disasters(on) {
    this.#disasters = Boolean(on);
  }
  disasters() {
    return this.#disasters;
  }
  tick() {}
  // A loaded file: the page's checks read the flag from the engine, and this one is off after a load.
  load_cty() {
    this.#rules = false;
  }
  take_events() {
    return 0;
  }
  save_cty() {
    return new Uint8Array(0);
  }
}
