// Contract test of the budget functions of the REAL compiled wasm adapter (tax, budget,
// evaluation, history). Run with scripts/test-wasm.sh, which sets WASM_PKG_DIR; without it
// the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: run scripts/test-wasm.sh";
const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));

describe("wasm budget contract", { skip: SKIP }, () => {
  let City;
  before(() => {
    City = createRequire(import.meta.url)(join(PKG_DIR, "micropolis_wasm.js")).City;
  });

  const load = () => {
    const city = new City(1);
    city.load_cty(HAIGHT);
    city.take_events();
    return city;
  };

  test("tax rate is stored in 0..20 only", () => {
    const city = load();
    assert.equal(city.set_tax(12), true);
    assert.equal(city.tax(), 12);
    assert.equal(city.set_tax(21), false);
    assert.equal(city.set_tax(-1), false);
    assert.equal(city.tax(), 12);
  });

  test("budget() has the documented 18-field layout and set_budget clamps percents", () => {
    const city = load();
    city.set_budget(30, 200, -5);
    const b = Array.from(city.budget());
    assert.equal(b.length, 18);
    assert.equal(b[0], city.tax());
    assert.deepEqual(b.slice(12, 15), [30, 100, 0]);
    assert.ok(b.slice(1, 12).every(Number.isInteger));
  });

  test("evaluation() has 15 fields and four problem slots", () => {
    const city = load();
    for (let i = 0; i < 5; i++) city.tick();
    const e = Array.from(city.evaluation());
    assert.equal(e.length, 15);
    assert.ok(e[0] >= 0 && e[0] <= 1000, `score ${e[0]}`);
    assert.ok(e[6] >= 0 && e[6] <= 100, `yes ${e[6]}`);
    for (let slot = 0; slot < 4; slot++) {
      const kind = e[7 + 2 * slot];
      assert.ok(kind >= -1 && kind < 7);
      if (kind === -1) assert.equal(e[8 + 2 * slot], 0);
    }
  });

  test("tax_fund_at() previews the collection at the current rate", () => {
    const city = load();
    for (let i = 0; i < 60; i++) city.tick();
    assert.equal(city.tax_fund_at(0), 0);
    const at10 = city.tax_fund_at(10);
    const at20 = city.tax_fund_at(20);
    assert.ok(at10 > 0 && at20 >= 2 * at10 - 1, `${at10} ${at20}`);
  });

  test("history() returns 120 values for valid kinds and scales, nothing otherwise", () => {
    const city = load();
    for (let i = 0; i < 3; i++) city.tick();
    for (let kind = 0; kind < 6; kind++) {
      for (const scale of [0, 1]) assert.equal(city.history(kind, scale).length, 120);
    }
    assert.equal(city.history(6, 0).length, 0);
    assert.equal(city.history(0, 2).length, 0);
  });
});
