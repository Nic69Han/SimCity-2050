// Contract test of the REAL compiled wasm adapter for the energy (City.energy_rules, set_energy_rules,
// energy_stats, power_plants, the electricity offers 12..15 of the deals). Run with scripts/test-wasm.sh:
// WASM_PKG_DIR must name a wasm-bindgen --target nodejs build. Without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const OK = 1;
const WIND = 42;
const STATS = 6, PLANT_LEN = 6, OFFER_LEN = 6, WASTE_OFFER = 8, ENERGY_OFFER = 12;

describe("wasm energy", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  function spot(city, genre) {
    for (let x = 2; x < 110; x++) {
      for (let y = 2; y < 90; y++) {
        if (city.structure_preview(genre, x, y)[0] === OK) return [x, y];
      }
    }
    throw new Error("no free spot");
  }

  function offer(city, index) {
    return Array.from(city.deal_offers().slice(index * OFFER_LEN, (index + 1) * OFFER_LEN));
  }

  function assertInert(city) {
    const stats = city.energy_stats();
    assert.ok(stats instanceof Int32Array);
    assert.deepEqual(Array.from(stats), new Array(STATS).fill(0));
    assert.ok(city.power_plants() instanceof Int32Array);
    assert.equal(city.power_plants().length, 0);
    assert.equal(city.deal_offers().length, 8 * OFFER_LEN);
  }

  test("off by default: zero statistics, no plants, eight offers", () => {
    const city = City.new_sized(120, 100, 1);
    city.set_deals_rules(true);
    assert.equal(city.energy_rules(), false);
    assertInert(city);
  });

  test("the rule on but the buildings off: still inert", () => {
    const city = City.new_sized(120, 100, 1);
    city.set_deals_rules(true);
    city.set_energy_rules(true);
    assert.equal(city.energy_rules(), true);
    assertInert(city);
  });

  test("both on: a turbine is listed with its stride and counted", () => {
    const city = City.new_sized(120, 100, 42);
    city.set_energy_rules(true);
    city.set_structure_rules(true);
    const [x, y] = spot(city, WIND);
    assert.equal(city.place_structure(WIND, x, y), OK);
    const plants = city.power_plants();
    assert.ok(plants instanceof Int32Array);
    assert.equal(plants.length, PLANT_LEN);
    assert.deepEqual(Array.from(plants), [WIND, x, y, 0, 240, 30]);
    const stats = city.energy_stats();
    assert.equal(stats.length, STATS);
    assert.equal(stats[0], 30, "production");
  });

  test("electricity offers 12..15: a cost shown negative; garbage offers off; accept_deal(12)", () => {
    const city = City.new_sized(120, 100, 42);
    city.set_deals_rules(true);
    city.set_energy_rules(true);
    city.set_structure_rules(true);
    assert.equal(city.deal_offers().length, 16 * OFFER_LEN);
    assert.deepEqual(offer(city, ENERGY_OFFER), [0, 3, 100, -2, -200, 1]);
    for (let i = ENERGY_OFFER; i < 16; i++) {
      const [, resource, amount, price, income] = offer(city, i);
      assert.equal(resource, 3);
      assert.ok(amount > 0 && price < 0 && income === amount * price, `offer ${i}`);
    }
    for (let i = WASTE_OFFER; i < ENERGY_OFFER; i++) {
      assert.equal(offer(city, i)[5], -1, `garbage offer ${i}: waste rules off`);
    }
    assert.equal(city.accept_deal(ENERGY_OFFER), 1);
    assert.equal(city.energy_stats()[2], 100, "bought");
  });

  test("turning the rule off empties everything again", () => {
    const city = City.new_sized(120, 100, 42);
    city.set_deals_rules(true);
    city.set_energy_rules(true);
    city.set_structure_rules(true);
    const [x, y] = spot(city, WIND);
    assert.equal(city.place_structure(WIND, x, y), OK);
    assert.equal(city.accept_deal(ENERGY_OFFER), 1);
    city.set_energy_rules(false);
    assertInert(city);
    assert.equal(city.active_deals().length, 0);
  });
});
