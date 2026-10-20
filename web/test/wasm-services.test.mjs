// Contract test of the REAL compiled wasm adapter for the public services (City.service_rules,
// set_service_rules, service_stats, coverage_layer), through its JavaScript API. Run with
// scripts/test-wasm.sh: WASM_PKG_DIR must name a wasm-bindgen --target nodejs build. Without it
// the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const OK = 1, FAILED = 0;
const SCHOOL = 30, SCHOOL_SIZE = 2;
const WIDTH = 97, HEIGHT = 83; // not square on purpose: x * height + y differs from y * width + x
const STATS_LENGTH = 10;
const TOOL_WIRE = 6, TOOL_COAL = 13;
const POWER_TICKS = 400;
const LAYER_KINDS = [-1, 0, 1, 2, 3];
const FULL = 255;

describe("wasm public services", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  const allZero = (a) => Array.from(a).every((v) => v === 0);

  // A city with both rules on and a powered school: a coal plant, a wire line, a school at its end.
  function poweredSchool(seed = 42) {
    const city = City.new_sized(WIDTH, HEIGHT, seed);
    city.set_structure_rules(true);
    city.set_service_rules(true);
    for (let x = 10; x < WIDTH - 12; x++) {
      for (let y = 10; y < HEIGHT - 12; y++) {
        const spot = tryBuild(city, x, y);
        if (spot) return { city, ...spot };
      }
    }
    throw new Error("no free spot for a plant, a wire and a school");
  }

  function tryBuild(city, x, y) {
    if (city.structure_preview(SCHOOL, x + 8, y)[0] !== OK) return null;
    if (city.tool_down(TOOL_COAL, x, y) !== OK) return null;
    city.tool_drag(TOOL_WIRE, x + 2, y, x + 7, y);
    if (city.place_structure(SCHOOL, x + 8, y) !== OK) return null;
    for (let i = 0; i < POWER_TICKS; i++) city.tick();
    return { sx: x + 8, sy: y };
  }

  test("the methods exist for feature detection", () => {
    const city = new City(1);
    for (const m of ["service_rules", "set_service_rules", "service_stats", "coverage_layer"]) {
      assert.equal(typeof city[m], "function", m);
    }
  });

  test("off by default: stats are 10 zeros, layers are all zero and genre 30 is refused", () => {
    const city = City.new_sized(WIDTH, HEIGHT, 7);
    assert.equal(city.service_rules(), false);
    const stats = city.service_stats();
    assert.ok(stats instanceof Int32Array);
    assert.equal(stats.length, STATS_LENGTH);
    assert.ok(allZero(stats));
    for (const kind of LAYER_KINDS) {
      const layer = city.coverage_layer(kind);
      assert.ok(layer instanceof Uint8Array);
      assert.equal(layer.length, WIDTH * HEIGHT);
      assert.ok(allZero(layer), `kind ${kind}`);
    }
    city.set_structure_rules(true);
    const funds = city.funds();
    assert.deepEqual(Array.from(city.structure_preview(SCHOOL, 20, 20)), [FAILED, 0]);
    assert.equal(city.place_structure(SCHOOL, 20, 20), FAILED);
    assert.equal(city.funds(), funds);
  });

  test("the services stay inert while the extended buildings are off", () => {
    const city = City.new_sized(WIDTH, HEIGHT, 7);
    city.set_service_rules(true);
    assert.equal(city.service_rules(), true);
    assert.ok(allZero(city.service_stats()));
    assert.ok(allZero(city.coverage_layer(0)));
    assert.equal(city.place_structure(SCHOOL, 20, 20), FAILED);
  });

  test("a powered school: stats shape, education layer in x * height + y order", () => {
    const { city, sx, sy } = poweredSchool();
    const stats = city.service_stats();
    assert.ok(stats instanceof Int32Array);
    assert.equal(stats.length, STATS_LENGTH);
    assert.ok(stats[3] > 0, `school places: ${Array.from(stats)}`);
    const layer = city.coverage_layer(0);
    assert.ok(layer instanceof Uint8Array);
    assert.equal(layer.length, WIDTH * HEIGHT);
    for (let dx = 0; dx < SCHOOL_SIZE; dx++) {
      for (let dy = 0; dy < SCHOOL_SIZE; dy++) {
        const x = sx + dx, y = sy + dy;
        assert.equal(layer[x * HEIGHT + y], FULL, `footprint ${x},${y}`);
        assert.equal(layer[y * WIDTH + x], 0, `transposed index of ${x},${y}`);
      }
    }
  });

  test("other kinds stay at zero: health and security, and kinds -1 and 3", () => {
    const { city } = poweredSchool();
    for (const kind of [1, 2, -1, 3]) {
      assert.ok(allZero(city.coverage_layer(kind)), `kind ${kind}`);
    }
  });

  test("set_service_rules(false) empties the buildings and zeroes the stats", () => {
    const { city } = poweredSchool();
    assert.ok(city.structures().length > 0);
    city.set_service_rules(false);
    assert.equal(city.service_rules(), false);
    assert.equal(city.structures().length, 0);
    assert.ok(allZero(city.service_stats()));
    assert.ok(allZero(city.coverage_layer(0)));
  });
});
