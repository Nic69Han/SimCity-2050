// Highways of the mock engine (docs/game-design-v13.md), used by mock-engine.mjs when its `highways` option is on.
// A small in-memory state: the rule switch and the set of highway tiles. The engine's real rules are the core's
// (crates/micropolis-core/src/highways.rs); the mock is not the engine.
//
// Mock rules: highway_rules() is off by default and after a new city or a load. Switching it off removes every
// highway with no refund. On: a highway goes on a road tile (the mock's road, tile 64) that has no highway yet;
// highway_preview is [code, HIGHWAY_COST] for an allowed tile and [0, 0] otherwise (Failed: not a road, or already
// a highway; NoMoney -2 when the funds are short). highway_layer() is one byte per tile, index x * height + y, 1 for a
// highway. highway_stats() is [tiles, tiles * HIGHWAY_UPKEEP]. The mock never demolishes a road, so a highway stays.

// The methods of the highways API, hidden unless the constructor asks with `highways: true`.
export const HIGHWAY_METHODS = Object.freeze([
  "highway_rules", "set_highway_rules", "highway_preview", "place_highway", "remove_highway", "highway_layer",
  "highway_stats",
]);

export const MOCK_ROAD = 64; // the mock's road tile (tile number of the C++ road)
export const HIGHWAY_COST = 25; // dollars per highway tile
export const HIGHWAY_UPKEEP = 1; // dollars per highway tile and year
export const RESULT_FAILED = 0;
export const RESULT_OK = 1;
export const RESULT_NO_MONEY = -2;

const keyOf = (x, y) => `${x},${y}`;

export class MockHighways {
  #on = false;
  #tiles = new Set(); // "x,y" of each highway tile

  /** Back to the start: rule off, no highway. */
  reset() {
    this.#on = false;
    this.#tiles.clear();
  }

  rule() {
    return this.#on;
  }

  /** Switching the rule off removes every highway, with no refund. */
  setRule(on) {
    if (!on) this.#tiles.clear();
    this.#on = Boolean(on);
  }

  has(x, y) {
    return this.#tiles.has(keyOf(x, y));
  }

  /** Puts a highway on (x, y); the caller has checked the tile. */
  add(x, y) {
    this.#tiles.add(keyOf(x, y));
  }

  /** Takes the highway on (x, y) away: true when there was one. */
  remove(x, y) {
    return this.#tiles.delete(keyOf(x, y));
  }

  count() {
    return this.#tiles.size;
  }

  /** One byte per tile, index x * height + y: 1 for a highway. */
  layer(width, height) {
    const out = new Uint8Array(width * height);
    for (const k of this.#tiles) {
      const [x, y] = k.split(",").map(Number);
      out[x * height + y] = 1;
    }
    return out;
  }

  /** [tiles, yearly upkeep]; zeros when there is none. */
  stats() {
    const n = this.count();
    return Int32Array.of(n, n * HIGHWAY_UPKEEP);
  }
}
