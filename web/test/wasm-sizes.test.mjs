// Contract test of the REAL compiled wasm adapter for map sizes (City.new_sized, size_limits,
// is_saveable, save_checked, adopt), through its JavaScript API. Run with scripts/test-wasm.sh
// style: WASM_PKG_DIR must name a wasm-bindgen --target nodejs build. Without it the suite is
// skipped (the other tests need no build).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));
const CTY_SIZE = 27120;

describe("wasm map sizes", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  test("the limits are the engine's", () => {
    assert.deepEqual(Array.from(City.size_limits()), [80, 67, 512, 512]);
  });

  test("new_sized builds a city of the requested size", () => {
    for (const [w, h] of [[80, 67], [97, 83], [200, 150], [300, 250], [90, 300]]) {
      const city = City.new_sized(w, h, 1);
      assert.equal(city.width(), w);
      assert.equal(city.height(), h);
      assert.equal(city.tiles().length, w * h, `${w}x${h} tiles`);
      assert.equal(city.speed(), 3);
      assert.equal(city.is_saveable(), true); // every size is saveable (wave 6)
    }
  });

  test("new_sized is deterministic per seed and size", () => {
    const a = City.new_sized(200, 150, 4);
    const b = City.new_sized(200, 150, 4);
    const c = City.new_sized(200, 150, 5);
    assert.deepEqual(a.tiles(), b.tiles());
    assert.notDeepEqual(a.tiles(), c.tiles());
  });

  test("out-of-range sizes throw the stable code size_out_of_range", () => {
    for (const [w, h] of [[79, 100], [120, 66], [513, 100], [100, 600], [0, 0], [-1, 100]]) {
      assert.throws(() => City.new_sized(w, h, 1), (e) => e.message === "size_out_of_range", `${w}x${h}`);
    }
  });

  test("every size can be saved; save_cty still refuses all but 120x100 (size_not_saveable)", () => {
    const big = City.new_sized(300, 250, 1);
    assert.equal(big.is_saveable(), true);
    assert.throws(() => big.save_cty(), (e) => e.message === "size_not_saveable");
    const bytes = big.save_checked();
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [77, 67, 84, 89]);

    const original = City.new_sized(120, 100, 1);
    assert.equal(original.is_saveable(), true);
    assert.equal(original.save_checked().length, CTY_SIZE);
    assert.equal(original.save_cty().length, CTY_SIZE);
  });

  test("a saved original city loads back into a city of the same map", () => {
    const city = City.new_sized(120, 100, 2);
    const saved = city.save_checked();
    const back = new City(1);
    back.load_cty(saved);
    assert.deepEqual(back.tiles(), city.tiles());
  });

  test("a sample loads into a sized engine and gives back the original size", () => {
    const big = City.new_sized(300, 250, 1);
    big.load_cty(HAIGHT);
    assert.equal(big.width(), 120);
    assert.equal(big.height(), 100);
    assert.equal(big.is_saveable(), true);
  });

  test("adopt makes the object another city, in place", () => {
    const city = new City(1);
    city.adopt(City.new_sized(160, 120, 3));
    assert.equal(city.width(), 160);
    assert.equal(city.height(), 120);
    assert.equal(city.tool_preview(9, 159, 119).length, 2);
  });

  test("a big city ticks and answers queries at its far corner", () => {
    const city = City.new_sized(300, 250, 3);
    for (let i = 0; i < 50; i++) city.tick();
    assert.equal(city.width() * city.height(), city.tiles().length);
    assert.ok(Array.isArray(Array.from(city.query(299, 249))));
  });
});
