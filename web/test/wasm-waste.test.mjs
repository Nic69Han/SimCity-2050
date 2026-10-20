// Contract test of the REAL compiled wasm adapter for the waste (City.waste_rules, set_waste_rules,
// waste_stats, waste_layer, the garbage offers of the deals). Run with scripts/test-wasm.sh:
// WASM_PKG_DIR must name a wasm-bindgen --target nodejs build. Without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const OK = 1;
const LANDFILL = 20, INCINERATOR = 21, RECYCLING = 22, WASTE_TO_ENERGY = 23;
const STATS = 7, OFFER_LEN = 6, WASTE_OFFER = 8, LANDFILL_CAPACITY = 20000;

describe("wasm waste", { skip: SKIP }, () => {
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

  test("off by default: empty statistics, an all-zero layer, no waste offers", () => {
    const city = City.new_sized(120, 100, 1);
    assert.equal(city.waste_rules(), false);
    assert.deepEqual(Array.from(city.waste_stats()), new Array(STATS).fill(0));
    const layer = city.waste_layer();
    assert.ok(layer instanceof Uint8Array);
    assert.equal(layer.length, 120 * 100);
    assert.ok(layer.every((v) => v === 0));
    city.set_deals_rules(true);
    assert.equal(city.deal_offers().length, 8 * OFFER_LEN);
  });

  test("the four buildings are placed once both rules are on; a landfill has room", () => {
    const city = City.new_sized(120, 100, 42);
    city.set_waste_rules(true);
    assert.equal(city.waste_rules(), true);
    city.set_structure_rules(true);
    for (const genre of [LANDFILL, INCINERATOR, RECYCLING, WASTE_TO_ENERGY]) {
      const [x, y] = spot(city, genre);
      assert.equal(city.place_structure(genre, x, y), OK, `genre ${genre}`);
    }
    const stats = Array.from(city.waste_stats());
    assert.equal(stats.length, STATS);
    assert.equal(stats[5], LANDFILL_CAPACITY, "room left");
    assert.equal(stats[6], 400, "power of the waste-to-energy plant");
    city.set_waste_rules(false);
    assert.deepEqual(Array.from(city.waste_stats()), new Array(STATS).fill(0));
  });

  test("garbage offers: four more records, a cost shown negative, signed like the others", () => {
    const city = City.new_sized(120, 100, 42);
    city.set_deals_rules(true);
    city.set_waste_rules(true);
    const offers = Array.from(city.deal_offers());
    assert.equal(offers.length, 12 * OFFER_LEN);
    const [neighbour, resource, amount, price, income, status] = offers.slice(
      WASTE_OFFER * OFFER_LEN,
      (WASTE_OFFER + 1) * OFFER_LEN,
    );
    assert.deepEqual([neighbour, resource], [0, 2]);
    assert.ok(amount > 0 && price < 0 && income === amount * price);
    assert.equal(status, 1);
    assert.equal(city.accept_deal(WASTE_OFFER), 1);
    assert.equal(city.accept_deal(WASTE_OFFER), -2, "already");
    const deals = Array.from(city.active_deals());
    assert.deepEqual(deals.slice(0, 5), [neighbour, 2, amount, price, income]);
    assert.ok(deals[6] > 0, "the penalty is a positive number of dollars");
    city.set_waste_rules(false);
    assert.equal(city.active_deals().length, 0);
    assert.equal(city.deal_offers().length, 8 * OFFER_LEN);
  });
});
