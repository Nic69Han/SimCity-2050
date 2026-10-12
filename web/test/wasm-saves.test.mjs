// Contract test of the REAL compiled wasm adapter for city files (City.save_city, City.load_city,
// save_cty, load_cty), through its JavaScript API. Run with scripts/test-wasm.sh, which builds the
// package and sets WASM_PKG_DIR. Without WASM_PKG_DIR the suite is skipped.
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

// The error message of a call that must throw: its code is the text before ": ".
function codeOf(fn) {
  try {
    fn();
  } catch (e) {
    return String(e.message).split(": ")[0];
  }
  return "no error";
}

describe("wasm city files", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  test("a city of three sizes saves, loads and saves to the same bytes", () => {
    for (const [w, h] of [[97, 83], [120, 100], [300, 250]]) {
      const city = City.new_sized(w, h, 3);
      for (let i = 0; i < 30; i++) city.tick();
      const first = city.save_city();
      const back = new City(1);
      back.load_city(first);
      assert.equal(back.width(), w, `${w}x${h} width`);
      assert.equal(back.height(), h, `${w}x${h} height`);
      // The first load recomputes derived tile data; from then on the bytes are stable.
      const second = back.save_city();
      const again = new City(1);
      again.load_city(second);
      assert.deepEqual(Array.from(again.save_city()), Array.from(second), `${w}x${h} stable`);
      assert.deepEqual(again.tiles(), back.tiles(), `${w}x${h} tiles`);
    }
  });

  test("a 120x100 city file is the plain .cty, byte for byte", () => {
    const city = City.new_sized(120, 100, 2);
    assert.equal(city.save_city().length, CTY_SIZE);
    assert.deepEqual(Array.from(city.save_city()), Array.from(city.save_cty()));
  });

  test("an extended file starts with the MCTY header and has the size of its map", () => {
    const city = City.new_sized(160, 120, 2);
    const bytes = city.save_city();
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [77, 67, 84, 89]);
    assert.equal(bytes.length, 10 + 2 * (6 * 240 + 120 + 160 * 120));
  });

  test("the haight sample loads the same with load_city as with load_cty", () => {
    const a = new City(1);
    a.load_cty(HAIGHT);
    const b = new City(1);
    b.load_city(HAIGHT);
    assert.deepEqual(b.tiles(), a.tiles());
    assert.equal(b.funds(), a.funds());
  });

  test("save_cty refuses the sizes a .cty cannot describe", () => {
    const big = City.new_sized(300, 250, 1);
    assert.equal(codeOf(() => big.save_cty()), "size_not_saveable");
    assert.equal(big.is_saveable(), true);
  });

  test("refused files give the core's codes and leave the city unchanged", () => {
    const city = City.new_sized(97, 83, 1);
    const before = Array.from(city.save_city());
    const longer = Uint8Array.from([...city.save_city(), 0]);
    const badVersion = city.save_city();
    badVersion[5] = 9;
    const badSize = city.save_city();
    badSize[6] = 0;
    badSize[7] = 40;
    const cases = [
      [Uint8Array.from([1, 2, 3]), "cty_truncated"],
      [new Uint8Array(27121), "cty_bad_magic"],
      [longer, "cty_bad_size"],
      [badVersion, "cty_bad_version"],
      [badSize, "cty_size_out_of_range"],
    ];
    for (const [bytes, code] of cases) {
      assert.equal(codeOf(() => city.load_city(bytes)), code, code);
    }
    assert.deepEqual(Array.from(city.save_city()), before);
  });

  test("the error message is the code, a colon and the detail", () => {
    const city = new City(1);
    try {
      city.load_city(Uint8Array.from([1, 2, 3]));
      assert.fail("expected an error");
    } catch (e) {
      assert.match(e.message, /^cty_truncated: .+/);
    }
  });
});
