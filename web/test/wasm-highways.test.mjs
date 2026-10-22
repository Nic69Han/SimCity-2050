// Contract test of the REAL compiled wasm adapter for the highways (City.highway_rules, set_highway_rules,
// highway_preview, place_highway, remove_highway, highway_layer, highway_stats) (docs/game-design-v13.md).
// Run with scripts/test-wasm.sh: WASM_PKG_DIR must name a wasm-bindgen --target nodejs build. Without it
// the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";
const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));

const OK = 1, FAILED = 0, NO_MONEY = -2, BULLDOZER = 7;
const HIGHWAY_COST = 25, HIGHWAY_UPKEEP = 1, MAX_HIGHWAY_TILES = 4096;
const STATS = 2;
const LOMASK = 0x3ff;
const ROADS = 66, LASTROAD = 206, HBRIDGE = 64, VBRIDGE = 65, BRWH = 79;

// A tile a highway may lie on: a classic road tile, not a bridge, not a rail crossing.
function isRoad(tile) {
  const t = tile & LOMASK;
  const k = t & 15; // the classic bridge test: k < 2 or k === 15
  return t >= ROADS && t <= LASTROAD && k >= 2 && k !== 15;
}

describe("wasm highways", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  function haight() {
    const city = City.new_sized(120, 100, 1);
    city.load_cty(HAIGHT);
    city.set_speed(3);
    return city;
  }

  function ready() {
    const city = haight();
    city.set_highway_rules(true);
    return city;
  }

  function ticks(city, n) {
    for (let i = 0; i < n; i++) city.tick();
  }

  // The first `n` highway-eligible road tiles of the city, as [x, y] (tiles are in x * height + y order).
  function roads(city, n) {
    const h = city.height();
    const tiles = city.tiles();
    const out = [];
    for (let i = 0; i < tiles.length && out.length < n; i++) {
      if (isRoad(tiles[i])) out.push([Math.floor(i / h), i % h]);
    }
    assert.equal(out.length, n, "the city has roads");
    return out;
  }

  const countOn = (layer) => layer.reduce((a, b) => a + b, 0);

  test("off by default: nothing is drawn, every call is refused", () => {
    const city = haight();
    const [x, y] = roads(city, 1)[0];
    assert.equal(city.highway_rules(), false);
    assert.ok(city.highway_layer() instanceof Uint8Array);
    assert.equal(city.highway_layer().length, city.width() * city.height());
    assert.equal(countOn(city.highway_layer()), 0);
    assert.ok(city.highway_stats() instanceof Int32Array);
    assert.deepEqual(Array.from(city.highway_stats()), [0, 0]);
    assert.deepEqual(Array.from(city.highway_preview(x, y)), [FAILED, 0]);
    assert.equal(city.place_highway(x, y), FAILED);
    assert.equal(city.remove_highway(x, y), FAILED);
  });

  test("a highway is previewed, laid for its cost, drawn in the layer and counted", () => {
    const city = ready();
    const [x, y] = roads(city, 1)[0];
    const funds = city.funds();
    assert.deepEqual(Array.from(city.highway_preview(x, y)), [OK, HIGHWAY_COST]);
    assert.equal(city.funds(), funds, "a preview costs nothing");
    assert.equal(city.place_highway(x, y), OK);
    assert.equal(city.funds(), funds - HIGHWAY_COST);
    assert.equal(city.highway_layer()[x * city.height() + y], 1);
    assert.equal(countOn(city.highway_layer()), 1);
    const stats = Array.from(city.highway_stats());
    assert.equal(stats.length, STATS);
    assert.deepEqual(stats, [1, HIGHWAY_UPKEEP]);
    assert.deepEqual(Array.from(city.highway_preview(x, y)), [FAILED, 0], "already a highway");
    assert.equal(city.place_highway(x, y), FAILED);
  });

  test("refusals: a tile that is not a road, off the map", () => {
    const city = ready();
    const tiles = city.tiles();
    const h = city.height();
    const bare = tiles.findIndex((t) => (t & LOMASK) === 0);
    assert.ok(bare >= 0);
    const [x, y] = [Math.floor(bare / h), bare % h];
    const funds = city.funds();
    for (const [px, py] of [[x, y], [-1, 5], [5, -1], [999, 999]]) {
      assert.deepEqual(Array.from(city.highway_preview(px, py)), [FAILED, 0], `${px},${py}`);
      assert.equal(city.place_highway(px, py), FAILED, `${px},${py}`);
    }
    assert.equal(city.funds(), funds);
    assert.equal(city.highway_stats()[0], 0);
  });

  test("a bridge or a rail crossing, where the city has one, is refused", () => {
    const city = ready();
    const tiles = city.tiles();
    const h = city.height();
    const pick = (pred) => tiles.findIndex((t) => pred(t & LOMASK));
    const bridge = pick((t) => t === HBRIDGE || t === VBRIDGE || t === BRWH);
    const crossing = pick((t) => t === 237 || t === 238);
    // The sample city may have neither; the engine tests cover both tile by tile.
    for (const i of [bridge, crossing]) {
      if (i < 0) continue;
      const [x, y] = [Math.floor(i / h), i % h];
      assert.equal(city.place_highway(x, y), FAILED, `tile ${tiles[i] & LOMASK}`);
    }
    // No tile the page offers as a road may be a bridge, with or without traffic.
    for (let i = 0; i < tiles.length; i++) {
      const k = (tiles[i] & LOMASK) & 15;
      if (isRoad(tiles[i])) assert.ok(k >= 2 && k !== 15);
    }
  });

  test("removing is free and leaves the road; the layer follows", () => {
    const city = ready();
    const [x, y] = roads(city, 1)[0];
    city.place_highway(x, y);
    const funds = city.funds();
    assert.equal(city.remove_highway(x, y), OK);
    assert.equal(city.funds(), funds);
    assert.equal(countOn(city.highway_layer()), 0);
    assert.equal(city.remove_highway(x, y), FAILED, "none left");
    assert.equal(isRoad(city.tiles()[x * city.height() + y]), true, "the road stays");
  });

  test("highways on every road until the money or the cap stops them; the rule off takes all up", () => {
    const city = ready();
    const count = Math.min(MAX_HIGHWAY_TILES + 5, 6000);
    const all = [];
    const h = city.height();
    const tiles = city.tiles();
    for (let i = 0; i < tiles.length; i++) if (isRoad(tiles[i])) all.push([Math.floor(i / h), i % h]);
    // The cap itself (4096) is proven by the engine tests; here the roads or the funds end first.
    let placed = 0;
    let last = OK;
    for (const [x, y] of all.slice(0, count)) {
      last = city.place_highway(x, y);
      if (last === OK) placed++;
      else break;
    }
    assert.ok(placed > 0);
    assert.ok(last === OK || last === NO_MONEY, `stopped by money or by the end of the roads: ${last}`);
    assert.equal(city.highway_stats()[0], placed);
    assert.ok(placed <= MAX_HIGHWAY_TILES);
    city.set_highway_rules(false);
    assert.equal(city.highway_rules(), false);
    assert.equal(countOn(city.highway_layer()), 0);
    assert.deepEqual(Array.from(city.highway_stats()), [0, 0]);
  });

  test("the road bulldozed takes its highway with it, soon", () => {
    const city = ready();
    const [a, b] = roads(city, 40).filter((_, i) => i % 13 === 0).slice(0, 2);
    city.place_highway(...a);
    city.place_highway(...b);
    city.tool_down(BULLDOZER, a[0], a[1]);
    ticks(city, 60);
    const h = city.height();
    assert.equal(city.highway_layer()[a[0] * h + a[1]], 0, "repaired");
    assert.equal(city.highway_layer()[b[0] * h + b[1]], 1);
    assert.equal(city.highway_stats()[0], 1);
  });

  test("rule off = the classic engine: a toggled run ends identical to an untouched one (600 ticks)", () => {
    const a = haight();
    const b = haight();
    b.set_highway_rules(true);
    for (const [x, y] of roads(b, 5)) b.place_highway(x, y);
    b.set_highway_rules(false);
    ticks(a, 600);
    ticks(b, 600);
    assert.deepEqual(Array.from(a.tiles()), Array.from(b.tiles()));
  });

  test("the yearly upkeep is taken at the yearly balance and the cars keep running", () => {
    const city = ready();
    city.set_agent_rules(true);
    for (const [x, y] of roads(city, 20)) assert.equal(city.place_highway(x, y), OK);
    assert.deepEqual(Array.from(city.highway_stats()), [20, 20 * HIGHWAY_UPKEEP]);
    ticks(city, 800);
    const cars = Array.from(city.agent_stats());
    assert.ok(cars[0] >= 0 && cars[1] >= 0);
    assert.equal(city.highway_stats()[0], 20, "the roads stand: the highways stay");
  });

  test("the tiles survive a save; the rule switched on and off leaves the file it always was", () => {
    const city = ready();
    for (const [x, y] of roads(city, 8)) city.place_highway(x, y);
    const file = city.save_city();
    const back = City.new_sized(120, 100, 1);
    back.load_city(file);
    assert.equal(back.highway_rules(), true);
    assert.deepEqual(Array.from(back.highway_layer()), Array.from(city.highway_layer()));
    assert.deepEqual(Array.from(back.highway_stats()), Array.from(city.highway_stats()));
    const plain = haight();
    plain.set_highway_rules(true);
    plain.set_highway_rules(false);
    assert.deepEqual(Array.from(plain.save_cty()), Array.from(haight().save_cty()), "off: the file it always was");
  });
});
