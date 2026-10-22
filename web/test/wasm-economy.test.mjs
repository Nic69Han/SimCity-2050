// Contract test of the REAL compiled wasm adapter for the economy (City.economy_rules, set_economy_rules,
// tax_rates, set_tax_rate, tax_income, bonds, bond_offer, issue_bond, repay_bond, goods_stats, wealth_layer).
// Run with scripts/test-wasm.sh: WASM_PKG_DIR must name a wasm-bindgen --target nodejs build. Without it the
// suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";
const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));

const CASES = 9, GOODS = 6, BOND_LEN = 3, MAX_BONDS = 10, BOND_AMOUNT = 10000, RATE_MAX = 20;
const TICKS_PER_YEAR = 1200;

describe("wasm economy", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  function haight() {
    const city = City.new_sized(120, 100, 1);
    city.load_cty(HAIGHT);
    city.set_tax(7);
    city.set_speed(3);
    return city;
  }

  function years(city, ticks) {
    for (let i = 0; i < ticks; i++) city.tick();
  }

  function assertInert(city) {
    for (const [name, len] of [["tax_income", CASES], ["goods_stats", GOODS], ["bond_offer", 2]]) {
      const v = city[name]();
      assert.ok(v instanceof Int32Array, name);
      assert.deepEqual(Array.from(v), new Array(len).fill(0), name);
    }
    assert.ok(city.bonds() instanceof Int32Array);
    assert.equal(city.bonds().length, 0);
    const layer = city.wealth_layer();
    assert.ok(layer instanceof Uint8Array);
    assert.equal(layer.length, city.width() * city.height());
    assert.ok(layer.every((v) => v === 0));
  }

  test("off by default: the rates are the single rate, the rest is empty, every call is refused", () => {
    const city = haight();
    assert.equal(city.economy_rules(), false);
    assert.ok(city.tax_rates() instanceof Int32Array);
    assert.deepEqual(Array.from(city.tax_rates()), new Array(CASES).fill(7));
    assertInert(city);
    assert.equal(city.set_tax_rate(1, 1, 5), false);
    assert.equal(city.issue_bond(), 0);
    assert.equal(city.repay_bond(0), 0);
  });

  test("the rule does not need the extended buildings", () => {
    const city = haight();
    city.set_economy_rules(true);
    assert.equal(city.economy_rules(), true);
    assert.equal(city.structure_rules(), false);
  });

  test("set_tax_rate: kind 1..3, wealth 1..3, rate 0..20; the others are refused", () => {
    const city = haight();
    city.set_economy_rules(true);
    assert.equal(city.set_tax_rate(2, 3, 15), true);
    assert.equal(city.tax_rates()[5], 15);
    assert.equal(city.set_tax_rate(1, 1, 0), true);
    assert.equal(city.tax_rates()[0], 0);
    assert.equal(city.set_tax_rate(3, 3, RATE_MAX), true);
    assert.equal(city.tax_rates()[8], RATE_MAX);
    for (const [k, w, r] of [[0, 1, 5], [4, 1, 5], [1, 0, 5], [1, 4, 5], [1, 1, -1], [1, 1, RATE_MAX + 1]]) {
      assert.equal(city.set_tax_rate(k, w, r), false, `${k} ${w} ${r}`);
    }
    assert.deepEqual(Array.from(city.tax_rates()), [0, 7, 7, 7, 7, 15, 7, 7, 20]);
  });

  test("bonds: offer, issue, funds, cap, repay, unknown index", () => {
    const city = haight();
    city.set_economy_rules(true);
    assert.deepEqual(Array.from(city.bond_offer()), [BOND_AMOUNT, 30]);
    const funds = city.funds();
    assert.equal(city.issue_bond(), 1);
    assert.equal(city.funds(), funds + BOND_AMOUNT);
    assert.deepEqual(Array.from(city.bond_offer()), [BOND_AMOUNT, 40]);
    assert.deepEqual(Array.from(city.bonds()), [BOND_AMOUNT, 30, 0]);
    assert.equal(city.repay_bond(3), -1);
    assert.equal(city.repay_bond(-1), -1);
    assert.equal(city.repay_bond(0), 1);
    assert.equal(city.funds(), funds);
    assert.equal(city.bonds().length, 0);
    for (let i = 0; i < MAX_BONDS; i++) assert.equal(city.issue_bond(), 1);
    assert.equal(city.issue_bond(), -1, "the cap");
    assert.equal(city.bonds().length, MAX_BONDS * BOND_LEN);
    assert.deepEqual(Array.from(city.bond_offer()), [0, 0]);
  });

  test("a year: income by case, goods conserved, bonds aged, wealth on the zones", () => {
    const city = haight();
    city.set_economy_rules(true);
    city.issue_bond();
    years(city, TICKS_PER_YEAR);
    const income = Array.from(city.tax_income());
    assert.equal(income.length, CASES);
    assert.ok(income.every((v) => v >= 0) && income.some((v) => v > 0));
    const [produced, consumed, exported, imported, net, shortage] = Array.from(city.goods_stats());
    assert.equal(produced + imported, consumed + exported);
    assert.equal(net, exported - 2 * imported);
    assert.ok(shortage === 0 || shortage === 1);
    assert.ok(city.bonds()[2] >= 1, "the bond got older");
    const layer = city.wealth_layer();
    assert.ok(layer.every((v) => v <= 3) && layer.some((v) => v > 0));
  });

  test("turning the rule off empties everything again", () => {
    const city = haight();
    city.set_economy_rules(true);
    city.set_tax_rate(1, 1, 3);
    city.issue_bond();
    years(city, TICKS_PER_YEAR);
    city.set_economy_rules(false);
    assert.equal(city.economy_rules(), false);
    assert.deepEqual(Array.from(city.tax_rates()), new Array(CASES).fill(7));
    assertInert(city);
  });
});
