// Contract test of the REAL compiled wasm adapter for the water network (City.place_pipe,
// pipe_preview, remove_pipe, place_pump, pump_preview, remove_pump, watered, water_layer,
// water_dry_zones, water_stats, water_costs, water_piece), through its JavaScript API. Run with
// scripts/test-wasm.sh: WASM_PKG_DIR must name a wasm-bindgen --target nodejs build. Without it the
// suite is skipped (the other tests need no build).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const OK = 1, FAILED = 0, NO_MONEY = -2;
const NOTHING = 0, DRY_PIPE = 1, WATERED_PIPE = 2, PUMP = 3;

describe("wasm water network", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  // A new random city (seed 42) with the rules on, and a shore tile that takes a pump with a free
  // tile to its east.
  function shoreCity() {
    const city = City.new_sized(120, 100, 42);
    city.set_water_rules(true);
    for (let x = 2; x < 118; x++) {
      for (let y = 2; y < 98; y++) {
        if (city.pump_preview(x, y)[0] === OK && city.pipe_preview(x + 1, y)[0] === OK) return { city, x, y };
      }
    }
    throw new Error("no shore tile");
  }

  test("off by default: everything is refused for free and the views are empty", () => {
    const city = new City(1);
    assert.equal(city.water_rules(), false);
    const funds = city.funds();
    assert.equal(city.place_pipe(5, 5), FAILED);
    assert.equal(city.place_pump(5, 5), FAILED);
    assert.equal(city.remove_pipe(5, 5), FAILED);
    assert.equal(city.remove_pump(5, 5), FAILED);
    assert.deepEqual(Array.from(city.pipe_preview(5, 5)), [FAILED, 0]);
    assert.deepEqual(Array.from(city.pump_preview(5, 5)), [FAILED, 0]);
    assert.equal(city.watered(5, 5), false);
    assert.deepEqual(Array.from(city.water_stats()), [0, 0, 0, 0]);
    assert.equal(city.water_dry_zones().length, 0);
    assert.equal(city.water_layer().length, city.width() * city.height());
    assert.equal(city.water_layer().every((v) => v === NOTHING), true);
    assert.equal(city.funds(), funds);
  });

  test("the switch turns on and off", () => {
    const city = new City(1);
    city.set_water_rules(true);
    assert.equal(city.water_rules(), true);
    city.set_water_rules(false);
    assert.equal(city.water_rules(), false);
  });

  test("the costs are exposed: pipe, pump, most pumps", () => {
    const [pipe, pump, most] = new City(1).water_costs();
    assert.deepEqual([pipe > 0, pump > pipe, most > 0], [true, true, true]);
  });

  test("a pump on the shore and a pipe next to it: costs, layer and coverage", () => {
    const { city, x, y } = shoreCity();
    const [pipeCost, pumpCost] = city.water_costs();
    const funds = city.funds();
    assert.deepEqual(Array.from(city.pump_preview(x, y)), [OK, pumpCost]);
    assert.equal(city.funds(), funds, "a preview changes nothing");
    assert.equal(city.place_pump(x, y), OK);
    assert.equal(city.place_pipe(x + 1, y), OK);
    assert.equal(city.funds(), funds - pumpCost - pipeCost);
    assert.equal(city.place_pipe(x + 1, y), FAILED, "already there");
    assert.equal(city.funds(), funds - pumpCost - pipeCost);

    const h = city.height();
    const layer = city.water_layer();
    assert.equal(layer[x * h + y], PUMP);
    assert.equal(layer[(x + 1) * h + y], WATERED_PIPE);
    assert.equal(city.water_piece(x, y), PUMP);
    assert.equal(city.water_piece(x + 1, y), 1);
    assert.equal(city.water_piece(x + 5, y), 0);
    assert.equal(city.watered(x + 1, y), true);
    assert.equal(city.watered(x + 2, y + 2), true, "within reach");
    assert.equal(city.watered(x + 30, y), false, "far from the pipes");
    assert.deepEqual(Array.from(city.water_stats()).slice(0, 2), [1, 2]);

    // a pipe nothing feeds is dry
    assert.equal(city.place_pipe(x + 20, y), OK);
    assert.equal(city.water_layer()[(x + 20) * h + y], DRY_PIPE);

    // taking up: a pump leaves a pipe in its place, and the pipes go
    assert.equal(city.remove_pipe(x, y), FAILED, "that is a pump");
    assert.equal(city.remove_pump(x, y), OK);
    assert.equal(city.water_layer()[x * h + y], DRY_PIPE);
    assert.equal(city.water_layer()[(x + 1) * h + y], DRY_PIPE, "nothing feeds it any more");
    assert.equal(city.remove_pipe(x, y), OK);
    assert.equal(city.water_layer()[x * h + y], NOTHING);
    assert.equal(city.remove_pipe(x + 1, y), OK);
    assert.equal(city.funds(), funds - pumpCost - 2 * pipeCost, "taking up is free");
  });

  test("refusals: no water near, off the map, no money", () => {
    const { city } = shoreCity();
    assert.equal(city.place_pump(0, 0), FAILED);
    assert.equal(city.place_pipe(-1, 0), FAILED);
    assert.equal(city.place_pipe(500, 500), FAILED);
    // lay pipes until the funds are below the price of one more
    const [pipeCost] = city.water_costs();
    const w = city.width();
    for (let i = 0; city.funds() >= pipeCost; i++) city.place_pipe(i % w, Math.floor(i / w));
    const funds = city.funds();
    assert.ok(funds < pipeCost);
    assert.equal(city.pipe_preview(w - 1, 99)[0], NO_MONEY);
    assert.equal(city.place_pipe(w - 1, 99), NO_MONEY);
    assert.equal(city.funds(), funds);
  });

  test("the network and the rule are saved and loaded back", () => {
    const { city, x, y } = shoreCity();
    city.place_pump(x, y);
    city.place_pipe(x + 1, y);
    const back = new City(1);
    back.load_city(city.save_city());
    assert.equal(back.water_rules(), true);
    const h = back.height();
    assert.equal(back.water_layer()[x * h + y], PUMP);
    assert.equal(back.water_layer()[(x + 1) * h + y], WATERED_PIPE);
    assert.deepEqual(Array.from(back.water_stats()), Array.from(city.water_stats()));
  });
});
