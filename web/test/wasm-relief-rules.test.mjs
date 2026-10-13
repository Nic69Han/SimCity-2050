// Contract test of the REAL compiled wasm adapter for the relief rules (City.terraform,
// City.terraform_preview, and the levelling / slope prices of the building and road tools),
// through its JavaScript API. Run with scripts/test-wasm.sh: WASM_PKG_DIR must name a wasm-bindgen
// --target nodejs build. Without it the suite is skipped (the other tests need no build).
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const SEA_LEVEL = 8;
const MAX_SLOPE = 3;
const TOOL_RESIDENTIAL = 0;
const TERRAFORM_STEP_COST = 10;
const RESULT_OK = 1;
const RESULT_FAILED = 0;

/// Small deterministic generator for the test (not the simulation's random numbers).
function lcg(seed) {
  let s = BigInt(seed);
  return (n) => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return Number((s >> 33n) % BigInt(n));
  };
}

function assertSlopeBound(city) {
  const w = city.width();
  const h = city.height();
  const heights = city.heights();
  const at = (x, y) => heights[x * h + y];
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          assert.ok(
            Math.abs(at(x, y) - at(nx, ny)) <= MAX_SLOPE,
            `(${x},${y})=${at(x, y)} vs (${nx},${ny})=${at(nx, ny)}`,
          );
        }
      }
    }
  }
}

describe("wasm relief rules", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  test("with the rules off, terraform is refused and previews to [0, 0]", () => {
    const city = City.new_sized(120, 100, 1);
    const before = city.heights();
    assert.equal(city.relief_rules(), false);
    assert.equal(city.terraform(10, 10, 1), RESULT_FAILED);
    assert.deepEqual(Array.from(city.terraform_preview(10, 10, 1)), [RESULT_FAILED, 0]);
    assert.deepEqual(city.heights(), before);
  });

  test("with the rules on, terraform changes one tile and charges the previewed cost", () => {
    const city = City.new_sized(120, 100, 2);
    city.set_relief_rules(true);
    const h = city.height();
    const heights = city.heights();
    // Find a land tile that can be raised without touching anything built.
    let found = null;
    for (let x = 2; x < city.width() - 2 && !found; x++) {
      for (let y = 2; y < h - 2 && !found; y++) {
        const [result, cost] = city.terraform_preview(x, y, 1);
        if (result === RESULT_OK) found = { x, y, cost };
      }
    }
    assert.ok(found, "a raisable land tile exists");
    assert.ok(found.cost >= TERRAFORM_STEP_COST, `cost ${found.cost}`);

    const funds = city.funds();
    const index = found.x * h + found.y;
    assert.equal(city.terraform(found.x, found.y, 1), RESULT_OK);
    assert.equal(city.heights()[index], heights[index] + 1, "the tile rose one step");
    assert.equal(funds - city.funds(), found.cost, "funds drop by the previewed cost");
    assertSlopeBound(city);
  });

  test("water is refused, and the slope bound holds after many random terraforms", () => {
    const city = City.new_sized(120, 100, 3);
    city.set_relief_rules(true);
    const w = city.width();
    const h = city.height();
    const tiles = city.tiles();
    const heights = city.heights();
    for (let i = 0; i < tiles.length; i++) {
      const c = tiles[i] & 0x03ff;
      if (c >= 2 && c <= 20) {
        assert.equal(city.terraform(Math.floor(i / h), i % h, 1), RESULT_FAILED, `water ${i}`);
        assert.equal(heights[i], SEA_LEVEL);
        break;
      }
    }

    const next = lcg(77);
    let applied = 0;
    for (let step = 0; step < 400; step++) {
      const x = next(w);
      const y = next(h);
      const delta = next(2) === 0 ? 1 : -1;
      const [result, cost] = city.terraform_preview(x, y, delta);
      const funds = city.funds();
      const got = city.terraform(x, y, delta);
      assert.equal(got, result, `step ${step}`);
      if (got === RESULT_OK) {
        applied++;
        assert.equal(funds - city.funds(), cost, `step ${step} cost`);
      } else {
        assert.equal(city.funds(), funds, `step ${step} funds untouched`);
      }
    }
    assert.ok(applied > 20, `only ${applied} terraforms applied`);
    assertSlopeBound(city);
  });

  test("a building preview includes the levelling and equals the charge of tool_down", () => {
    const city = City.new_sized(120, 100, 4);
    city.set_relief_rules(true);
    const built = [];
    for (let x = 3; x < city.width() - 3 && built.length < 3; x += 7) {
      for (let y = 3; y < city.height() - 3 && built.length < 3; y += 7) {
        const [result, cost] = city.tool_preview(TOOL_RESIDENTIAL, x, y);
        if (result !== RESULT_OK) continue;
        assert.ok(cost >= 100, `residential costs at least 100, got ${cost}`);
        const funds = city.funds();
        assert.equal(city.tool_down(TOOL_RESIDENTIAL, x, y), RESULT_OK);
        assert.equal(funds - city.funds(), cost, `charge at (${x},${y})`);
        built.push([x, y]);
      }
    }
    assert.ok(built.length > 0, "at least one residential zone was built");
    assertSlopeBound(city);
  });

  test("the same actions give the same relief, per seed", () => {
    const run = () => {
      const city = City.new_sized(120, 100, 5);
      city.set_relief_rules(true);
      const next = lcg(9);
      for (let step = 0; step < 150; step++) {
        const x = next(120);
        const y = next(100);
        city.terraform(x, y, next(2) === 0 ? 1 : -1);
      }
      return city.heights();
    };
    assert.deepEqual(run(), run());
  });
});
