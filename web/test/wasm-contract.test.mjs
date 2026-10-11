// Contract test of the REAL compiled wasm adapter, through its JavaScript API.
// Run it with scripts/test-wasm.sh, which builds the package into a temporary directory
// (wasm-bindgen --target nodejs) and sets WASM_PKG_DIR to that directory. Without
// WASM_PKG_DIR the suite is skipped: it needs a build, the other tests need none.
// The expected tool table is the one of docs/tools-contract.md and the core's tool.rs.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: run scripts/test-wasm.sh";

const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));

// Tile characters (low 10 bits) used by the checks.
const LOMASK = 0x03ff;
const DIRT = 0;
const ROAD_MIN = 64; // ROADBASE
const ROAD_MAX = 206;

// Tool ids, in the order of EditingTool.
const TOOLS = [
  { id: 0, key: "residential", cost: 100, size: 3 },
  { id: 1, key: "commercial", cost: 100, size: 3 },
  { id: 2, key: "industrial", cost: 100, size: 3 },
  { id: 3, key: "fire_station", cost: 500, size: 3 },
  { id: 4, key: "police_station", cost: 500, size: 3 },
  { id: 5, key: "query", cost: 0, size: 1 },
  { id: 6, key: "wire", cost: 5, size: 1 },
  { id: 7, key: "bulldozer", cost: 1, size: 1 },
  { id: 8, key: "railroad", cost: 20, size: 1 },
  { id: 9, key: "road", cost: 10, size: 1 },
  { id: 10, key: "stadium", cost: 5000, size: 4 },
  { id: 11, key: "park", cost: 10, size: 1 },
  { id: 12, key: "seaport", cost: 3000, size: 4 },
  { id: 13, key: "coal_power", cost: 3000, size: 4 },
  { id: 14, key: "nuclear_power", cost: 5000, size: 4 },
  { id: 15, key: "airport", cost: 10000, size: 6 },
  { id: 16, key: "network", cost: 100, size: 1 },
  { id: 17, key: "water", cost: 0, size: 1 },
  { id: 18, key: "land", cost: 0, size: 1 },
  { id: 19, key: "forest", cost: 0, size: 1 },
];
const RESIDENTIAL = 0;
const BULLDOZER = 7;
const ROAD = 9;
const WIRE = 6;

const OK = 1;
const FAILED = 0;

/** Plain array of a typed array or of a wasm-bindgen result. */
const list = (x) => Array.from(x);

/** A city of haight.cty with its startup events drained, as the page does. */
function loadHaight(City) {
  const city = new City(1);
  city.load_cty(HAIGHT);
  city.take_events();
  return city;
}

/** The first tile (x, y) where `id` previews as Ok, scanning the whole map. */
function freeTile(city, id) {
  for (let x = 0; x < city.width(); x++) {
    for (let y = 0; y < city.height(); y++) {
      if (city.tool_preview(id, x, y)[0] === OK) return [x, y];
    }
  }
  throw new Error(`no free tile for tool ${id}`);
}

/** Tile value at (x, y), column-major as the page reads it. */
const tileAt = (city, x, y) => city.tiles()[x * city.height() + y];

describe("wasm contract", { skip: SKIP }, () => {
  // The package is loaded lazily so that the skip above happens before any require.
  let City;
  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  describe("tool table", () => {
    test("tool_count is 20 and every entry is [id, cost, size] with its key", () => {
      const city = new City(1);
      assert.equal(city.tool_count(), 20);
      for (const t of TOOLS) {
        assert.deepEqual(list(city.tool_info(t.id)), [t.id, t.cost, t.size], t.key);
        assert.equal(city.tool_key(t.id), t.key);
      }
    });

    test("indices outside the table give nothing", () => {
      const city = new City(1);
      assert.equal(list(city.tool_info(20)).length, 0);
      assert.equal(city.tool_key(20), "");
    });
  });

  describe("tool_down, funds and previews", () => {
    test("a road costs exactly its preview cost", () => {
      const city = loadHaight(City);
      const [x, y] = freeTile(city, ROAD);
      const [result, cost] = list(city.tool_preview(ROAD, x, y));
      assert.equal(result, OK);
      assert.ok(cost >= 10, `a road costs at least 10, preview ${cost}`);

      const before = city.funds();
      assert.equal(city.tool_down(ROAD, x, y), OK);
      assert.equal(before - city.funds(), cost);
      const t = tileAt(city, x, y) & LOMASK;
      assert.ok(t >= ROAD_MIN && t <= ROAD_MAX, `tile ${t} is a road`);
    });

    test("a refused click changes neither funds nor tiles", () => {
      const city = loadHaight(City);
      const [x, y] = freeTile(city, ROAD);
      city.tool_down(ROAD, x, y);
      // A zone cannot go on a road: the click fails.
      const funds = city.funds();
      const tiles = list(city.tiles());
      const result = city.tool_down(RESIDENTIAL, x, y);
      assert.equal(result, FAILED);
      assert.equal(city.funds(), funds);
      assert.deepEqual(list(city.tiles()), tiles);
    });

    test("bulldozer removes the road and charges its preview cost", () => {
      const city = loadHaight(City);
      const [x, y] = freeTile(city, ROAD);
      city.tool_down(ROAD, x, y);
      const [result, cost] = list(city.tool_preview(BULLDOZER, x, y));
      assert.equal(result, OK);
      const before = city.funds();
      assert.equal(city.tool_down(BULLDOZER, x, y), OK);
      assert.equal(before - city.funds(), cost);
      const t = tileAt(city, x, y) & LOMASK;
      assert.ok(t < ROAD_MIN || t > ROAD_MAX, `tile ${t} is no longer a road`);
    });

    test("a zone costs its preview cost and reports a status", () => {
      const city = loadHaight(City);
      const [x, y] = freeTile(city, RESIDENTIAL);
      const [, cost] = list(city.tool_preview(RESIDENTIAL, x, y));
      assert.ok(cost >= 100, `a zone costs at least 100, preview ${cost}`);
      const before = city.funds();
      assert.equal(city.tool_down(RESIDENTIAL, x, y), OK);
      assert.equal(before - city.funds(), cost);

      const zone = list(city.query(x, y));
      assert.equal(zone.length, 6);
      for (const v of zone.slice(1)) assert.ok(v >= 1 && v <= 20, `status ${v}`);
    });

    test("query on bare ground and on a built zone differ", () => {
      const city = loadHaight(City);
      const dirt = list(city.tiles()).findIndex((t) => (t & LOMASK) === DIRT);
      assert.ok(dirt >= 0, "haight has bare ground");
      const ground = list(city.query(Math.floor(dirt / city.height()), dirt % city.height()));
      assert.equal(ground.length, 6);

      const [x, y] = freeTile(city, RESIDENTIAL);
      city.tool_down(RESIDENTIAL, x, y);
      const zone = list(city.query(x, y));
      assert.equal(zone.length, 6);
      assert.notEqual(zone[0], ground[0]);
    });

    test("query is empty off the map", () => {
      const city = loadHaight(City);
      assert.equal(list(city.query(-1, 0)).length, 0);
      assert.equal(list(city.query(city.width(), city.height())).length, 0);
    });

    test("invalid tool ids neither throw nor change the city", () => {
      const city = loadHaight(City);
      const funds = city.funds();
      const tiles = list(city.tiles());
      for (const id of [-1, 20, 1000]) {
        assert.equal(city.tool_down(id, 10, 10), FAILED);
        city.tool_drag(id, 10, 10, 14, 10);
        assert.deepEqual(list(city.tool_preview(id, 10, 10)), [0, 0]);
        assert.deepEqual(list(city.tool_footprint(id, 10, 10)), [10, 10, 1, 1]);
      }
      assert.equal(city.funds(), funds);
      assert.deepEqual(list(city.tiles()), tiles);
    });

    test("footprints: a 3x3 zone is laid from its top-left tile, a road is one tile", () => {
      const city = new City(1);
      assert.deepEqual(list(city.tool_footprint(RESIDENTIAL, 20, 30)), [19, 29, 3, 3]);
      assert.deepEqual(list(city.tool_footprint(ROAD, 20, 30)), [20, 30, 1, 1]);
      assert.deepEqual(list(city.tool_footprint(15, 20, 30)), [19, 29, 6, 6]);
    });
  });

  describe("drag", () => {
    test("a road line of five tiles lays five roads and costs their previews", () => {
      const city = loadHaight(City);
      // A row of five tiles that are all free for a road.
      let start = null;
      for (let x = 0; x + 4 < city.width() && !start; x++) {
        for (let y = 0; y < city.height() && !start; y++) {
          if ([0, 1, 2, 3, 4].every((k) => city.tool_preview(ROAD, x + k, y)[0] === OK)) {
            start = [x, y];
          }
        }
      }
      assert.ok(start, "a free row of five tiles");
      const [x, y] = start;
      // Clearing a tile can add to the cost, so the expected total is the sum of the previews.
      let expected = 0;
      for (let k = 0; k <= 4; k++) expected += city.tool_preview(ROAD, x + k, y)[1];
      const before = city.funds();
      city.tool_drag(ROAD, x, y, x + 4, y);
      assert.equal(before - city.funds(), expected);
      for (let k = 0; k <= 4; k++) {
        const t = tileAt(city, x + k, y) & LOMASK;
        assert.ok(t >= ROAD_MIN && t <= ROAD_MAX, `tile ${k} is a road`);
      }
    });

    test("a wire drag fills the line too", () => {
      const city = loadHaight(City);
      const [x, y] = freeTile(city, WIRE);
      const before = city.funds();
      city.tool_drag(WIRE, x, y, x, y + 2);
      assert.ok(before - city.funds() >= 5, "at least one wire tile was paid for");
    });
  });

  describe("new_random_city", () => {
    test("same seed gives the same tiles, another seed another city", () => {
      const a = new City(1);
      const b = new City(9);
      a.new_random_city(42);
      b.new_random_city(42);
      assert.deepEqual(list(a.tiles()), list(b.tiles()));

      const c = new City(1);
      c.new_random_city(43);
      assert.notDeepEqual(list(a.tiles()), list(c.tiles()));
    });

    test("funds 20000, year 1900, speed 3, and a NewCity event", () => {
      const city = loadHaight(City);
      city.new_random_city(7);
      assert.equal(city.funds(), 20000);
      assert.equal(city.year(), 1900);
      assert.equal(city.speed(), 3);
      assert.equal(city.take_events(), 1);
    });

    test("the new city keeps running for ticks", () => {
      const city = new City(1);
      city.new_random_city(11);
      const before = city.year() * 12 + city.month();
      for (let i = 0; i < 200; i++) city.tick();
      assert.ok(city.year() * 12 + city.month() > before, "the calendar advances");
      assert.equal(typeof city.score(), "number");
    });
  });

  describe("determinism", () => {
    test("the same actions and ticks give the same city", () => {
      const run = () => {
        const city = loadHaight(City);
        const [x, y] = freeTile(city, RESIDENTIAL);
        city.tool_down(RESIDENTIAL, x, y);
        city.tool_drag(ROAD, x, y + 4, x + 6, y + 4);
        city.set_speed(3);
        for (let i = 0; i < 100; i++) city.tick();
        return { tiles: list(city.tiles()), funds: city.funds(), pop: city.population() };
      };
      assert.deepEqual(run(), run());
    });
  });
});
