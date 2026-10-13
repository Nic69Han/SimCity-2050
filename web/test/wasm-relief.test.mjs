// Contract test of the REAL compiled wasm adapter for the terrain relief (City.heights), through
// its JavaScript API. Run with scripts/test-wasm.sh: WASM_PKG_DIR must name a wasm-bindgen
// --target nodejs build. Without it the suite is skipped (the other tests need no build).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const SEA_LEVEL = 8;
const MAX_HEIGHT = 63;

describe("wasm terrain relief", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  test("heights has one value per tile, in the range 0..=63", () => {
    for (const [w, h, seed] of [[120, 100, 1], [97, 83, 2], [200, 150, 3]]) {
      const city = City.new_sized(w, h, seed);
      const heights = city.heights();
      assert.ok(heights instanceof Uint8Array, "heights is a byte array");
      assert.equal(heights.length, w * h, `${w}x${h} heights`);
      assert.equal(heights.length, city.tiles().length, `${w}x${h} same length as tiles`);
      for (const v of heights) {
        assert.ok(v >= 0 && v <= MAX_HEIGHT, `value ${v} out of range`);
      }
    }
  });

  test("water tiles are at sea level and some land is above it", () => {
    const city = City.new_sized(120, 100, 4);
    const heights = city.heights();
    const tiles = city.tiles();
    const WATER_LOW = 2;
    const WATER_HIGH = 20;
    for (let i = 0; i < tiles.length; i++) {
      const c = tiles[i] & 0x03ff;
      if (c >= WATER_LOW && c <= WATER_HIGH) {
        assert.equal(heights[i], SEA_LEVEL, `water tile ${i}`);
      }
    }
    assert.ok(heights.some((v) => v > SEA_LEVEL), "some land above sea level");
  });

  test("heights are deterministic per seed, and differ between seeds", () => {
    const a = City.new_sized(120, 100, 6).heights();
    const b = City.new_sized(120, 100, 6).heights();
    const c = City.new_sized(120, 100, 7).heights();
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  });

  test("a loaded city has heights of its own size", () => {
    const city = new City(1);
    const heights = city.heights();
    assert.equal(heights.length, city.width() * city.height());
  });
});
