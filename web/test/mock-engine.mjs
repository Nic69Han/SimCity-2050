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
//   - agents (docs/game-design-v03.md): agent_rules() is off by default and after a new city or a
//     load. Off: agent_stats() is five zeros, vehicles(max) is empty, traffic_load() is all zeros.
//     On: agent_stats() is a few fixed numbers, vehicles(max) lists min(max, 5) cars at fixed places
//     (records [id, 0, x16, y16, direction]), traffic_load() is (x + y) % 4 * 40 per tile.
//   - transport_stats() (docs/game-design-v05.md): six zeros while the agents rule is off, else the fixed
//     numbers TRANSPORT_FIXED. The transit genres 10-12 (MOCK_TRANSIT_STRUCTURES) join the catalog only with
//     the structures option AND the `transit` option, so the v0.4 catalog stays the same for the other tests.
//   - new_random_city(seed) regenerates the map from the seed (same seed, same map), resets
//     the funds to the start value, and resets speed to 3 and disasters to on, as the wasm
//     adapter does (simInit defaults); the page must push its own settings back afterwards

import {
  isZone, zoneCost, zoneTile, zoneLayer, zoneStats, ZONE_HALF,
} from "./mock-zoning.mjs";

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

// The methods of the extended buildings API, hidden unless the constructor asks for them.
const STRUCTURE_METHODS = Object.freeze([
  "structure_rules", "set_structure_rules", "structure_catalog", "structures",
  "structure_preview", "place_structure", "remove_structure", "structures_upkeep",
]);

// Extended buildings of the mock catalog (genre, footprint, price, monthly upkeep).
export const MOCK_STRUCTURES = Object.freeze([
  { genre: 1, width: 2, height: 2, cost: 200, upkeep: 5 },
  { genre: 2, width: 1, height: 1, cost: 100, upkeep: 2 },
  { genre: 3, width: 3, height: 3, cost: 1000, upkeep: 20 },
]);

// The methods of the zoning by density API (docs/game-design-v07.md), hidden unless the constructor
// asks for them with `densities: true`.
const DENSITY_METHODS = Object.freeze([
  "density_rules", "set_density_rules", "zone_preview", "place_zone", "density_layer", "density_stats",
]);

// Transport genres (the `transit` option of the mock): bus stop, bus depot, taxi depot.
export const MOCK_TRANSIT_STRUCTURES = Object.freeze([
  { genre: 10, width: 1, height: 1, cost: 50, upkeep: 1 },
  { genre: 11, width: 2, height: 2, cost: 300, upkeep: 8 },
  { genre: 12, width: 2, height: 2, cost: 400, upkeep: 10 },
]);

// transport_stats() while the agents rule is on: [buses, taxis, waiting, bus_trips_month,
// taxi_rides_month, income_month].
export const TRANSPORT_FIXED = Object.freeze([2, 1, 25, 340, 60, 1200]);

function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const OFFSET = { 1: 0, 3: 1, 4: 1, 6: 2 };

// Fixed cars of the traffic mock: [x, y, direction] in tiles, direction 0 n, 1 e, 2 s, 3 w.
const MOCK_CARS = Object.freeze([[4, 12, 1], [9, 12, 3], [15, 6, 2], [22, 18, 0], [30, 9, 1]]);

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
  #agentRules = false; // traffic agents switch (City.agent_rules)
  #structRules = false; // extended buildings switch (City.structure_rules)
  #structures = []; // placed buildings: { genre, x, y, width, height }
  #specs = MOCK_STRUCTURES; // the catalog of this mock (MOCK_STRUCTURES, plus the transit genres if asked)
  #densRules = false; // zoning by density switch (City.density_rules)
  #zones = []; // placed zones by density: { genre, density, x, y }, in placing order
  seed = 1;

  // Every successful or failed tool_down and every tool_drag, in call order.
  log = [];

  // `structures: true` gives the extended buildings API (docs/game-design-v04.md). Without it the
  // methods are hidden (own properties set to undefined), as in an engine built before the buildings.
  constructor(seed = 1, { width = 40, height = 30, funds = START_FUNDS, rubble = 60, structures = false, transit = false, densities = false } = {}) {
    this.#width = width;
    this.#height = height;
    this.#funds = funds;
    this.#rubble = rubble;
    if (structures && transit) this.#specs = [...MOCK_STRUCTURES, ...MOCK_TRANSIT_STRUCTURES];
    this.#generate(seed);
    if (!structures) for (const name of STRUCTURE_METHODS) this[name] = undefined;
    if (!densities) for (const name of DENSITY_METHODS) this[name] = undefined;
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
    this.#agentRules = false;
    this.#structRules = false;
    this.#structures = [];
    this.#densRules = false;
    this.#zones = [];
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
  // --- traffic agents (docs/game-design-v03.md, contract of crates/micropolis-wasm/src/agents.rs) ---
  agent_rules() {
    return this.#agentRules;
  }
  set_agent_rules(on) {
    this.#agentRules = Boolean(on);
  }
  // [buses, taxis, waiting, bus_trips_month, taxi_rides_month, income_month]; zeros while the rule is off.
  transport_stats() {
    return this.#agentRules ? Int32Array.from(TRANSPORT_FIXED) : Int32Array.of(0, 0, 0, 0, 0, 0);
  }
  // [active_cars, finished_trips, mean_trip_ticks, saturated_tiles, motorised_residents]
  agent_stats() {
    if (!this.#agentRules) return Int32Array.of(0, 0, 0, 0, 0);
    return Int32Array.of(MOCK_CARS.length, 1234, 42, 2, 5678);
  }
  // Records of 5 [id, kind, x16, y16, direction]; at most `max` of them. Empty while the rule is off.
  vehicles(max) {
    const n = this.#agentRules && Number.isInteger(max) ? Math.max(0, Math.min(max, MOCK_CARS.length)) : 0;
    const out = new Int32Array(n * 5);
    for (let i = 0; i < n; i++) {
      const [x, y, dir] = MOCK_CARS[i];
      out.set([i + 1, 0, x * 16 + 8, y * 16 + 8, dir], i * 5);
    }
    return out;
  }
  // One load per tile, index x * height + y like tiles(); zeros while the rule is off.
  traffic_load() {
    const out = new Uint8Array(this.#width * this.#height);
    if (!this.#agentRules) return out;
    for (let x = 0; x < this.#width; x++) {
      for (let y = 0; y < this.#height; y++) out[x * this.#height + y] = ((x + y) % 4) * 40;
    }
    return out;
  }
  // --- extended buildings (docs/game-design-v04.md, contract of crates/micropolis-wasm/src/structures.rs);
  // present only with the constructor option `structures: true` ---
  // Mock rules: off by default and after a new city or a load. Turning the rule off (set_structure_rules
  // (false)) removes every placed building, with no refund (docs/game-design-v04.md). Catalog: genre 1
  // (2x2, 200 $, upkeep 5), genre 2 (1x1, 100 $, upkeep 2), genre 3 (3x3, 1000 $, upkeep 20). A building
  // needs every tile of its footprint to be dirt on the map and free of buildings: rubble gives
  // NeedBulldoze (-1), anything else Failed (0); funds below the price give NoMoney (-2). The tiles stay
  // dirt (the inert tile is not modelled). structures() states are 0 (no power or water is modelled).
  structure_rules() {
    return this.#structRules;
  }
  set_structure_rules(on) {
    this.#structRules = Boolean(on);
    if (!this.#structRules) this.#structures = [];
  }
  // Records of 8 [genre, width, height, cost, upkeep, flags, radius, effect].
  structure_catalog() {
    return Int32Array.from(this.#specs.flatMap((s) => [s.genre, s.width, s.height, s.cost, s.upkeep, 0, 4, 1]));
  }
  // Records of 6 [genre, x, y, width, height, state], in placing order.
  structures() {
    return Int32Array.from(this.#structures.flatMap((s) => [s.genre, s.x, s.y, s.width, s.height, 0]));
  }
  // Dry run of a placement: { result, cost }, as place_structure would decide, without changing state.
  #structVerdict(genre, x, y) {
    const spec = this.#specOf(genre);
    if (!this.#structRules || !spec || !this.#inside(x, y)) return { result: RESULT.FAILED, cost: 0 };
    if (x + spec.width > this.#width || y + spec.height > this.#height) return { result: RESULT.FAILED, cost: 0 };
    let rubble = false;
    for (let i = x; i < x + spec.width; i++) {
      for (let j = y; j < y + spec.height; j++) {
        if (this.#structureAt(i, j)) return { result: RESULT.FAILED, cost: 0 };
        const tile = this.#get(i, j);
        if (tile === RUBBLE) rubble = true;
        else if (tile !== DIRT) return { result: RESULT.FAILED, cost: 0 };
      }
    }
    if (rubble) return { result: RESULT.NEED_BULLDOZE, cost: spec.cost };
    if (this.#funds < spec.cost) return { result: RESULT.NO_MONEY, cost: spec.cost };
    return { result: RESULT.OK, cost: spec.cost };
  }
  #specOf(genre) {
    return this.#specs.find((s) => s.genre === genre);
  }
  #structureAt(x, y) {
    return this.#structures.find((s) => x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height);
  }
  // Int32Array [code, cost] like tool_preview; [0, 0] while the rule is off.
  structure_preview(genre, x, y) {
    const v = this.#structVerdict(genre, x, y);
    return Int32Array.of(v.result, v.result === RESULT.FAILED ? 0 : v.cost);
  }
  place_structure(genre, x, y) {
    const v = this.#structVerdict(genre, x, y);
    if (v.result === RESULT.OK) {
      const spec = this.#specOf(genre);
      this.#funds -= v.cost;
      this.#structures.push({ genre, x, y, width: spec.width, height: spec.height });
    }
    return v.result;
  }
  // Takes up the building holding tile (x, y): 1 when one was removed, else 0. No refund.
  remove_structure(x, y) {
    if (!this.#structRules) return RESULT.FAILED;
    const hit = this.#structureAt(x, y);
    if (!hit) return RESULT.FAILED;
    this.#structures = this.#structures.filter((s) => s !== hit);
    return RESULT.OK;
  }
  // Monthly upkeep of the placed buildings, in dollars.
  structures_upkeep() {
    return this.#structures.reduce((sum, s) => sum + this.#specOf(s.genre).upkeep, 0);
  }

  // --- zoning by density (docs/game-design-v07.md, contract of crates/micropolis-wasm/src/densities.rs);
  // present only with the constructor option `densities: true` ---
  // Mock rules: off by default and after a new city or a load. Off: zone_preview is [0, 0] and place_zone
  // is Failed (0), and every zone counts as dense in density_layer and density_stats (the cap is lifted,
  // the zones are kept). On: a zone is a 3x3 square centred on (x, y), with every tile dirt; rubble gives
  // NeedBulldoze (-1), anything else Failed (0); funds below the price give NoMoney (-2). Prices: 80, 100
  // and 150 dollars for light, medium and dense (MOCK_ZONE_COST x a percentage). The classic zone tool
  // writes its tiles but records no density, so it is not in the layer nor in the statistics.
  density_rules() {
    return this.#densRules;
  }
  set_density_rules(on) {
    this.#densRules = Boolean(on);
  }
  // Dry run of place_zone: { result, cost }, as the engine would decide, without changing state.
  #zoneVerdict(genre, density, x, y) {
    const none = { result: RESULT.FAILED, cost: 0 };
    if (!this.#densRules || !isZone(genre, density)) return none;
    if (!this.#inside(x - ZONE_HALF, y - ZONE_HALF) || !this.#inside(x + ZONE_HALF, y + ZONE_HALF)) return none;
    let rubble = false;
    for (let i = x - ZONE_HALF; i <= x + ZONE_HALF; i++) {
      for (let j = y - ZONE_HALF; j <= y + ZONE_HALF; j++) {
        const tile = this.#get(i, j);
        if (tile === RUBBLE) rubble = true;
        else if (tile !== DIRT) return none;
      }
    }
    const cost = zoneCost(density);
    if (rubble) return { result: RESULT.NEED_BULLDOZE, cost };
    if (this.#funds < cost) return { result: RESULT.NO_MONEY, cost };
    return { result: RESULT.OK, cost };
  }
  // Int32Array [code, cost] like tool_preview; [0, 0] while the rule is off or the tile is refused.
  zone_preview(genre, density, x, y) {
    const v = this.#zoneVerdict(genre, density, x, y);
    return Int32Array.of(v.result, v.result === RESULT.FAILED ? 0 : v.cost);
  }
  place_zone(genre, density, x, y) {
    const v = this.#zoneVerdict(genre, density, x, y);
    if (v.result === RESULT.OK) {
      this.#funds -= v.cost;
      for (let i = x - ZONE_HALF; i <= x + ZONE_HALF; i++) {
        for (let j = y - ZONE_HALF; j <= y + ZONE_HALF; j++) this.#set(i, j, zoneTile(genre));
      }
      this.#zones.push({ genre, density, x, y });
    }
    return v.result;
  }
  // One value per tile, index x * height + y like tiles(): 0 nothing, the zone's density (dense while off).
  density_layer() {
    return zoneLayer(this.#zones, this.#width, this.#height, this.#densRules);
  }
  // [light, medium, dense, farms, farm jobs]: dense only while the rule is off; no farms in the mock.
  density_stats() {
    return zoneStats(this.#zones, this.#densRules);
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
    this.#agentRules = false;
    this.#structRules = false;
    this.#structures = [];
    this.#densRules = false;
    this.#zones = [];
  }
  take_events() {
    return 0;
  }
  save_cty() {
    return new Uint8Array(0);
  }
}
