// Contract test of the REAL compiled wasm adapter for the rewards and special deals (City.reward_rules,
// set_reward_rules, rewards, special_offers, answer_offer, reward_stats, and place_structure for the genres
// 50-54 and 60-63). Run with scripts/test-wasm.sh: WASM_PKG_DIR must name a wasm-bindgen --target nodejs
// build. Without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";
const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));

const OK = 1, FAILED = 0, NEED_BULLDOZE = -1;
const REWARD_LEN = 5, OFFER_LEN = 4, STATS = 4, BULLDOZER = 7;
const REWARDS = [50, 51, 52, 53, 54], DEALS = [60, 61, 62, 63];
const NONE = 0, PROPOSED = 1, ACCEPTED = 2, REFUSED = 3;
const TICKS_PER_YEAR = 1200;

describe("wasm rewards and special deals", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  // Haight is big enough (more than 40 000 inhabitants) for every offer.
  function haight() {
    const city = City.new_sized(120, 100, 1);
    city.load_cty(HAIGHT);
    city.set_tax(7);
    city.set_speed(3);
    return city;
  }

  function ready() {
    const city = haight();
    city.set_structure_rules(true);
    city.set_reward_rules(true);
    return city;
  }

  function ticks(city, n) {
    for (let i = 0; i < n; i++) city.tick();
  }

  function rewardsOf(city) {
    const flat = Array.from(city.rewards());
    assert.equal(flat.length % REWARD_LEN, 0);
    const out = [];
    for (let i = 0; i < flat.length; i += REWARD_LEN) {
      const [genre, unlocked, placed, population, satisfaction] = flat.slice(i, i + REWARD_LEN);
      out.push({ genre, unlocked, placed, population, satisfaction });
    }
    return out;
  }

  function offersOf(city) {
    const flat = Array.from(city.special_offers());
    assert.equal(flat.length % OFFER_LEN, 0);
    const out = [];
    for (let i = 0; i < flat.length; i += OFFER_LEN) {
      const [genre, income, state, population] = flat.slice(i, i + OFFER_LEN);
      out.push({ genre, income, state, population });
    }
    return out;
  }

  // Clears a 3 x 3 patch (rubble needs a second and third pass) and returns whether `genre` fits.
  function clear(city, genre, x, y) {
    for (let pass = 0; pass < 3; pass++) {
      for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) city.tool_down(BULLDOZER, x + dx, y + dy);
    }
    return city.structure_preview(genre, x, y)[0] === OK;
  }

  // The first 3 x 3 patch (scanned from column `from`) that can be cleared for `genre`.
  function clearedSpot(city, genre, from) {
    for (let x = from; x < 100; x += 3) {
      for (let y = 20; y < 80; y += 3) {
        if (clear(city, genre, x, y)) return [x, y];
      }
    }
    throw new Error("no clearable spot");
  }

  // A fresh city with the deal `genre` accepted and built on a spot where it is powered.
  function poweredDeal(genre) {
    for (let x = 20; x < 100; x += 3) {
      for (let y = 20; y < 80; y += 3) {
        const city = ready();
        assert.equal(city.answer_offer(genre, true), 1);
        if (!clear(city, genre, x, y)) continue;
        assert.equal(city.place_structure(genre, x, y), OK);
        ticks(city, 60);
        const list = Array.from(city.structures());
        if (list.length === 6 && (list[5] & 1) === 1) return { city, x, y };
      }
    }
    throw new Error("no powered spot");
  }

  test("off by default: empty lists, zero stats, every call refused", () => {
    const city = haight();
    assert.equal(city.reward_rules(), false);
    assert.ok(city.rewards() instanceof Int32Array);
    assert.ok(city.special_offers() instanceof Int32Array);
    assert.ok(city.reward_stats() instanceof Int32Array);
    assert.equal(city.rewards().length, 0);
    assert.equal(city.special_offers().length, 0);
    assert.deepEqual(Array.from(city.reward_stats()), new Array(STATS).fill(0));
    assert.equal(city.answer_offer(60, true), 0);
    city.set_structure_rules(true);
    for (const genre of [...REWARDS, ...DEALS]) {
      assert.equal(city.place_structure(genre, 20, 20), FAILED, `genre ${genre}`);
    }
  });

  test("the rules need the extended buildings: without them nothing is unlocked or proposed", () => {
    const city = haight();
    city.set_reward_rules(true);
    assert.equal(city.reward_rules(), true);
    assert.equal(city.structure_rules(), false);
    assert.ok(rewardsOf(city).every((r) => r.unlocked === 0));
    assert.ok(offersOf(city).every((o) => o.state === NONE));
    ticks(city, TICKS_PER_YEAR + 10);
    assert.ok(rewardsOf(city).every((r) => r.unlocked === 0));
  });

  test("the lists: five rewards and four offers with the thresholds of the contract", () => {
    const city = ready();
    assert.deepEqual(rewardsOf(city).map((r) => [r.genre, r.population, r.satisfaction]), [
      [50, 2000, 0], [51, 10000, 0], [52, 5000, 70], [53, 20000, 0], [54, 50000, 80],
    ]);
    assert.deepEqual(offersOf(city).map((o) => [o.genre, o.income, o.population]), [
      [60, 3000, 8000], [61, 5000, 15000], [62, 8000, 25000], [63, 10000, 40000],
    ]);
    assert.ok(rewardsOf(city).every((r) => r.placed === 0));
  });

  test("turning the rule on checks the thresholds at once; a year does the rest, for good", () => {
    const city = ready();
    const first = rewardsOf(city);
    for (const g of [50, 51, 53]) assert.equal(first.find((r) => r.genre === g).unlocked, 1, `genre ${g}`);
    for (const g of [52, 54]) assert.equal(first.find((r) => r.genre === g).unlocked, 0, `genre ${g}`);
    assert.ok(offersOf(city).every((o) => o.state === PROPOSED), "Haight has the population of every offer");
    ticks(city, TICKS_PER_YEAR);
    assert.ok(rewardsOf(city).every((r) => r.unlocked === 1), "the satisfaction came with the year");
    const stats = Array.from(city.reward_stats());
    assert.equal(stats.length, STATS);
    assert.ok(stats[0] >= 0 && stats[0] <= 100);
    assert.equal(stats[2], 5);
    assert.equal(stats[3], 0);
  });

  test("answer_offer: 1 done, -1 for an unknown or already answered offer, 0 with the rule off", () => {
    const city = ready();
    for (const g of [50, 64, 0, -5, 1000]) assert.equal(city.answer_offer(g, true), -1, `genre ${g}`);
    assert.equal(city.answer_offer(60, true), 1);
    assert.equal(offersOf(city)[0].state, ACCEPTED);
    assert.equal(city.answer_offer(60, false), -1);
    assert.equal(city.answer_offer(61, false), 1);
    assert.equal(offersOf(city)[1].state, REFUSED);
    assert.equal(city.answer_offer(61, true), -1);
    assert.equal(city.reward_stats()[3], 1);
    city.set_reward_rules(false);
    assert.equal(city.answer_offer(62, true), 0);
  });

  test("the gate: a reward needs its unlock and stands once; a deal needs its acceptance and stands once", () => {
    const city = ready();
    assert.equal(city.place_structure(52, 30, 30), FAILED, "locked");
    assert.equal(city.place_structure(60, 30, 30), FAILED, "not accepted");
    assert.equal(city.place_structure(50, 30, 30), NEED_BULLDOZE, "unlocked: the gate is open, the land is not");
    assert.equal(city.answer_offer(61, false), 1);
    assert.equal(city.place_structure(61, 30, 30), FAILED, "refused for good");
    assert.equal(city.answer_offer(60, true), 1);
    assert.equal(city.place_structure(60, 30, 30), NEED_BULLDOZE, "accepted: the gate is open");

    const [x, y] = clearedSpot(city, 50, 20);
    assert.deepEqual(Array.from(city.structure_preview(50, x, y)), [OK, 0]);
    const funds = city.funds();
    assert.equal(city.place_structure(50, x, y), OK);
    assert.equal(city.funds(), funds, "free");
    assert.equal(rewardsOf(city)[0].placed, 1);
    assert.equal(city.structures_upkeep(), 0);
    // a second one is refused on any (cleared) land: the park is the same size
    const [x2, y2] = clearedSpot(city, 1, x + 6);
    assert.equal(city.place_structure(50, x2, y2), FAILED);
    assert.equal(city.remove_structure(x, y), OK);
    assert.equal(rewardsOf(city)[0].placed, 0);
    assert.equal(city.place_structure(50, x2, y2), OK);
  });

  test("a powered deal pays its income every year and nothing once it is pulled down", () => {
    const { city, x, y } = poweredDeal(60);
    const before = city.funds();
    ticks(city, TICKS_PER_YEAR);
    assert.equal(city.reward_stats()[1], 3000);
    assert.ok(city.funds() !== before);
    assert.equal(city.remove_structure(x, y), OK);
    ticks(city, TICKS_PER_YEAR);
    assert.equal(city.reward_stats()[1], 0);
  });

  test("an accepted deal that is not built pays nothing", () => {
    const city = ready();
    assert.equal(city.answer_offer(63, true), 1);
    ticks(city, TICKS_PER_YEAR);
    assert.equal(city.reward_stats()[1], 0);
    assert.equal(city.reward_stats()[3], 1);
  });

  test("turning the rule off pulls the buildings down and forgets the unlocks and the answers", () => {
    const city = ready();
    assert.equal(city.answer_offer(60, true), 1);
    const [x, y] = clearedSpot(city, 50, 20);
    assert.equal(city.place_structure(50, x, y), OK);
    const funds = city.funds();
    city.set_reward_rules(false);
    assert.equal(city.reward_rules(), false);
    assert.equal(city.structures().length, 0);
    assert.equal(city.funds(), funds, "no refund");
    assert.equal(city.rewards().length, 0);
    assert.equal(city.special_offers().length, 0);
    assert.deepEqual(Array.from(city.reward_stats()), new Array(STATS).fill(0));
    city.set_reward_rules(true);
    assert.equal(offersOf(city)[0].state, PROPOSED, "the answer is forgotten");
  });

  test("the state survives a save and a load", () => {
    const city = ready();
    city.answer_offer(60, true);
    city.answer_offer(61, false);
    const file = city.save_city();
    const back = City.new_sized(120, 100, 1);
    back.load_city(file);
    assert.equal(back.reward_rules(), true);
    assert.deepEqual(rewardsOf(back), rewardsOf(city));
    assert.deepEqual(offersOf(back).map((o) => o.state), [ACCEPTED, REFUSED, PROPOSED, PROPOSED]);
  });
});
