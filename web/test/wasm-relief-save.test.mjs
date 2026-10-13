// Contract test of the REAL compiled wasm adapter for the relief in city files (City.save_city,
// City.load_city, save_cty, City.heights, City.set_relief_rules), through its JavaScript API. Run
// with scripts/test-wasm.sh, which builds the package and sets WASM_PKG_DIR. Without WASM_PKG_DIR
// the suite is skipped.
//
// An edited relief cannot be made from JavaScript yet (the terraform tools come later), so the
// version-2 files below are built by hand: the version-1 file of a city, then the relief block
// (flags, count, altitudes, FNV-1a checksum) appended, as docs/roadmap.md and fileio.rs describe.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const CTY_SIZE = 27120;
const HEADER = 10;
const FLAG_RULES = 0b01;
const FLAG_EDITED = 0b10;

// The error message of a call that must throw: its code is the text before ": ".
function codeOf(fn) {
  try {
    fn();
  } catch (e) {
    return String(e.message).split(": ")[0];
  }
  return "no error";
}

// FNV-1a over bytes, 32 bits: the relief checksum.
function fnv32(bytes) {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}

const be32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

// The version-1 extended file `v1` turned into version 2, with the relief block appended.
function withBlock(v1, flags, count, heights) {
  const block = [flags, ...be32(count), ...heights];
  const out = [...v1];
  out[4] = 0;
  out[5] = 2;
  return Uint8Array.from([...out, ...block, ...be32(fnv32(block))]);
}

describe("wasm relief in city files", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  test("an unedited 120x100 city without the rules is the plain .cty", () => {
    const city = City.new_sized(120, 100, 4);
    assert.equal(city.save_city().length, CTY_SIZE);
    assert.deepEqual(Array.from(city.save_city()), Array.from(city.save_cty()));
  });

  test("the rules on make a 120x100 city an MCTY version 2 file with the relief, and it loads back", () => {
    const city = City.new_sized(120, 100, 4);
    city.set_relief_rules(true);
    const bytes = city.save_city();
    const n = 120 * 100;
    assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), "MCTY");
    assert.equal(bytes.length, HEADER + CTY_SIZE + 9 + n);
    assert.equal(bytes[HEADER + CTY_SIZE], FLAG_RULES, "flags: rules only");
    const back = new City(1);
    back.load_city(bytes);
    assert.equal(back.relief_rules(), true);
    assert.deepEqual(Array.from(back.heights()), Array.from(city.heights()));
    assert.deepEqual(Array.from(back.save_city()), Array.from(bytes), "saved again, same bytes");
  });

  test("a hand-built version-2 file loads its relief, the edited flag and the rules", () => {
    const base = City.new_sized(97, 83, 2).save_city(); // unedited, no rules: version 1
    assert.equal(base[5], 1);
    const n = 97 * 83;
    const heights = Array.from({ length: n }, (_, i) => (i * 7) % 60);
    const bytes = withBlock(base, FLAG_EDITED | FLAG_RULES, n, heights);

    const city = new City(1);
    city.load_city(bytes);
    assert.equal(city.width(), 97);
    assert.equal(city.height(), 83);
    assert.deepEqual(Array.from(city.heights()), heights, "the altitudes are the file's");
    assert.equal(city.relief_rules(), true);

    const saved = city.save_city();
    assert.equal(saved[5], 2, "saved as version 2");
    assert.equal(saved[saved.length - 9 - n], FLAG_EDITED | FLAG_RULES, "the flags are kept");
    const again = new City(1);
    again.load_city(saved);
    assert.deepEqual(Array.from(again.save_city()), Array.from(saved), "stable after a load");
  });

  test("a corrupt relief block is cty_bad_relief and leaves the city untouched", () => {
    const base = City.new_sized(97, 83, 2).save_city();
    const n = 97 * 83;
    const heights = Array.from({ length: n }, () => 12);
    const good = withBlock(base, FLAG_EDITED, n, heights);
    const city = City.new_sized(97, 83, 5);
    const before = Array.from(city.save_city());

    const flipped = Uint8Array.from(good);
    flipped[flipped.length - 5] ^= 1; // an altitude, the checksum not updated
    assert.equal(codeOf(() => city.load_city(flipped)), "cty_bad_relief");
    assert.deepEqual(Array.from(city.save_city()), before);

    const badFlags = withBlock(base, 0b100, n, heights);
    assert.equal(codeOf(() => city.load_city(badFlags)), "cty_bad_relief");
    const badCount = withBlock(base, FLAG_EDITED, n - 1, heights);
    assert.equal(codeOf(() => city.load_city(badCount)), "cty_bad_relief");
    const high = heights.slice();
    high[3] = 64;
    assert.equal(codeOf(() => city.load_city(withBlock(base, FLAG_EDITED, n, high))), "cty_bad_relief");
    assert.deepEqual(Array.from(city.save_city()), before);
  });

  test("a truncated relief block is cty_truncated", () => {
    const base = City.new_sized(97, 83, 2).save_city();
    const n = 97 * 83;
    const good = withBlock(base, FLAG_EDITED, n, Array.from({ length: n }, () => 9));
    const city = new City(1);
    assert.equal(codeOf(() => city.load_city(good.subarray(0, good.length - 1))), "cty_truncated");
    assert.equal(codeOf(() => city.load_city(good.subarray(0, good.length - 9 - n))), "cty_truncated");
  });

  test("save_cty refuses a city its format cannot hold: an edited or rules-on relief", () => {
    const city = City.new_sized(120, 100, 4);
    assert.equal(city.save_cty().length, CTY_SIZE);
    city.set_relief_rules(true);
    assert.equal(codeOf(() => city.save_cty()), "relief_not_saveable");
    assert.equal(codeOf(() => City.new_sized(97, 83, 4).save_cty()), "size_not_saveable");
  });
});
