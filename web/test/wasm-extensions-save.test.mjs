// Contract test of the REAL compiled wasm adapter for the extensions block of city files (MCTY
// version 3): a hand-built version-3 file loads, a bad block is cty_bad_extension and leaves the
// city untouched, and every city the page can make still saves as before (no extensions
// from JavaScript yet, so a saved city is never version 3). Run with scripts/test-wasm.sh;
// without WASM_PKG_DIR the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const CTY_SIZE = 27120;

function codeOf(fn) {
  try {
    fn();
  } catch (e) {
    return String(e.message).split(": ")[0];
  }
  return "no error";
}

function fnv32(bytes) {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}

const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

// The version-1 file `v1` of a w x h city turned into version 3: a relief block (rules off, not
// edited, the altitudes `heights`), then the extensions block made of `chunks` (bytes).
function version3(v1, heights, chunks) {
  const relief = [0, ...be32(heights.length), ...heights];
  const out = [...v1];
  out[4] = 0;
  out[5] = 3;
  return Uint8Array.from([...out, ...relief, ...be32(fnv32(relief)), ...be32(chunks.length), ...chunks]);
}

describe("wasm extensions block in city files", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  test("a city saved by the page is never version 3 while the rules are off", () => {
    assert.equal(City.new_sized(120, 100, 4).save_city().length, CTY_SIZE);
    const v1 = City.new_sized(97, 83, 2).save_city();
    assert.equal((v1[4] << 8) | v1[5], 1);
  });

  test("a version-3 file with an empty block loads, and one with a water chunk too", () => {
    const base = City.new_sized(97, 83, 2).save_city();
    const n = 97 * 83;
    const heights = Array.from(City.new_sized(97, 83, 2).heights());
    const city = new City(1);
    city.load_city(version3(base, heights, []));
    assert.equal(city.width(), 97);
    const water = [3, ...be32(n), ...Array.from({ length: n }, (_, i) => (i === 5 ? 1 : 0))];
    city.load_city(version3(base, heights, water));
    assert.equal(city.width(), 97);
    // The water network is saved again: the city now needs a version-3 file.
    const again = city.save_city();
    assert.equal((again[4] << 8) | again[5], 3);
  });

  test("a bad block is cty_bad_extension and leaves the city untouched", () => {
    const base = City.new_sized(97, 83, 2).save_city();
    const heights = Array.from(City.new_sized(97, 83, 2).heights());
    const city = City.new_sized(97, 83, 5);
    const before = Array.from(city.save_city());
    const bad = [
      [9, ...be32(0)], // unknown tag
      [1, ...be32(1), 0b10_0000], // unknown rules flag
      [3, ...be32(2), 1, 2], // water chunk of the wrong size
      [1, ...be32(1), 1, 1, ...be32(1), 1], // repeated tag
      [1, 0, 0], // header cut short
    ];
    for (const chunks of bad) {
      assert.equal(codeOf(() => city.load_city(version3(base, heights, chunks))), "cty_bad_extension", String(chunks));
      assert.deepEqual(Array.from(city.save_city()), before);
    }
  });
});
