// Contract test of the deals API of the REAL compiled wasm adapter (deals_rules, set_deals_rules,
// deal_offers, active_deals, accept_deal, cancel_deal, surplus): record layouts, codes, bounds,
// income at the tax collection, the save, and "rule off = the engine without deals". Run with
// scripts/test-wasm.sh, which sets WASM_PKG_DIR; without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: run scripts/test-wasm.sh";
const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));
const CODE = { DONE: 1, INVALID: 0, RULES_OFF: -1, ALREADY: -2, NO_SURPLUS: -3 };

describe("wasm deals contract", { skip: SKIP }, () => {
  let City;
  before(() => {
    City = createRequire(import.meta.url)(join(PKG_DIR, "micropolis_wasm.js")).City;
  });

  const load = () => {
    const city = new City(1);
    city.load_cty(HAIGHT);
    city.take_events();
    city.set_speed(3);
    city.enable_disasters(false);
    return city;
  };
  const offers = (city) => Array.from(city.deal_offers());
  const deals = (city) => Array.from(city.active_deals());

  test("off by default: nothing on the table and every call refused", () => {
    const city = load();
    assert.equal(city.deals_rules(), false);
    assert.equal(city.deal_offers().length, 0);
    assert.equal(city.active_deals().length, 0);
    assert.deepEqual(Array.from(city.surplus()), [0, 0]);
    assert.equal(city.accept_deal(0), CODE.RULES_OFF);
    assert.equal(city.cancel_deal(0), CODE.RULES_OFF);
  });

  test("eight offers of six numbers: four neighbours, two resources, income = amount x price", () => {
    const city = load();
    city.set_deals_rules(true);
    assert.equal(city.deals_rules(), true);
    const flat = offers(city);
    assert.equal(flat.length, 8 * 6);
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
      const [neighbour, resource, amount, price, income, status] = flat.slice(i * 6, i * 6 + 6);
      assert.ok(neighbour >= 0 && neighbour < 4 && resource >= 0 && resource < 2);
      assert.equal(neighbour * 2 + resource, i, "the position is the offer index");
      assert.ok(amount > 0 && price > 0);
      assert.equal(income, amount * price);
      assert.ok([1, -2, -3, -4].includes(status), `status ${status}`);
      seen.add(`${neighbour}:${resource}`);
    }
    assert.equal(seen.size, 8);
    assert.deepEqual(flat, offers(city), "the table is deterministic");
  });

  test("a city with power signs an electricity deal; invalid indices change nothing", () => {
    const city = load();
    city.set_deals_rules(true);
    const surplus = Array.from(city.surplus());
    assert.ok(surplus[0] > 0, `haight has power to spare: ${surplus}`);
    assert.equal(surplus[1], 0, "no pump");
    for (const bad of [-1, 8, 99, 2 ** 31 - 1, -(2 ** 31)]) {
      assert.equal(city.accept_deal(bad), CODE.INVALID, `accept ${bad}`);
      assert.equal(city.cancel_deal(bad), CODE.INVALID, `cancel ${bad}`);
    }
    const [, , amount, price, income] = offers(city).slice(0, 6);
    assert.equal(offers(city)[5], CODE.DONE);
    assert.equal(city.accept_deal(0), CODE.DONE);
    assert.equal(city.accept_deal(0), CODE.ALREADY);
    assert.deepEqual(deals(city), [0, 0, amount, price, income, 1, income / 2]);
    assert.equal(city.surplus()[0], surplus[0] - amount);
    assert.equal(city.accept_deal(1), CODE.NO_SURPLUS, "water has no pump");
    assert.equal(deals(city).length, 7);
  });

  test("the funds grow by whole years of the income, and cancelling charges the penalty", () => {
    const plain = load();
    const dealer = load();
    dealer.set_deals_rules(true);
    dealer.accept_deal(0);
    const income = deals(dealer)[4];
    for (let t = 0; t < 400; t++) {
      plain.tick();
      dealer.tick();
    }
    assert.equal(plain.year(), dealer.year());
    const gain = dealer.funds() - plain.funds();
    assert.ok(gain >= income, `${gain} >= ${income}`);
    assert.equal(gain % income, 0, "a whole number of yearly incomes");
    const before = dealer.funds();
    assert.equal(dealer.cancel_deal(0), CODE.DONE);
    assert.equal(dealer.funds(), before - income / 2);
    assert.equal(deals(dealer).length, 0);
  });

  test("turning the rule off drops the deals for free", () => {
    const city = load();
    city.set_deals_rules(true);
    city.accept_deal(0);
    const funds = city.funds();
    city.set_deals_rules(false);
    assert.equal(deals(city).length, 0);
    assert.equal(city.funds(), funds);
  });

  test("the deals are saved with the city and loaded back; no deal, no change to the file", () => {
    const plain = load();
    const city = load();
    assert.deepEqual(Array.from(city.save_city()), Array.from(plain.save_city()));
    city.set_deals_rules(true);
    city.accept_deal(0);
    city.accept_deal(2);
    const bytes = city.save_city();
    assert.equal((bytes[4] << 8) | bytes[5], 3);
    const back = new City(1);
    back.load_city(bytes);
    assert.equal(back.deals_rules(), true);
    assert.deepEqual(deals(back), deals(city));
    // A city loaded from a file without deals has none.
    back.load_city(plain.save_city());
    assert.equal(deals(back).length, 0);
  });

  test("with the rule off the engine plays exactly as before", () => {
    const a = load();
    const b = load();
    b.set_deals_rules(true);
    b.set_deals_rules(false);
    for (let t = 0; t < 300; t++) {
      a.tick();
      b.tick();
    }
    assert.equal(a.funds(), b.funds());
    assert.deepEqual(Array.from(a.tiles()), Array.from(b.tiles()));
    assert.deepEqual(Array.from(a.save_city()), Array.from(b.save_city()));
  });
});
