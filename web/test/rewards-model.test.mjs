// The rewards presentation model (web/rewards-model.js) and the genre names 50-54 and 60-63 of web/structures-model.js:
// the decoding of the engine's records (bounded), the statuses and the texts of the rewards and the offers.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as M from "../rewards-model.js";
import { nameOf, REWARD_NAMES, SPECIAL_NAMES } from "../structures-model.js";
import { MockCity } from "./mock-engine.mjs";
import { MOCK_REWARDS, MOCK_OFFERS, STATE } from "./mock-rewards.mjs";

// Narrow no-break spaces (the thousands separator and before $ or %) read as plain spaces in the expected texts.
const norm = (s) => s.replace(/[  ]/g, " ");
const reward = (over = {}) => ({ genre: 50, unlocked: false, placed: false, population: 2000, satisfaction: 0, ...over });
const offer = (over = {}) => ({ genre: 60, income: 3000, state: 0, population: 8000, ...over });

describe("the engine methods", () => {
  test("supports: every method of METHODS, else false", () => {
    assert.equal(M.supports(new MockCity(1, { rewards: true })), true);
    assert.equal(M.supports(new MockCity(1)), false);
    const half = new MockCity(1, { rewards: true });
    half.answer_offer = undefined;
    assert.equal(M.supports(half), false);
  });

  test("readRulesOn: the engine's flag, false without the API", () => {
    const city = new MockCity(1, { rewards: true });
    assert.equal(M.readRulesOn(city), false);
    city.set_reward_rules(true);
    assert.equal(M.readRulesOn(city), true);
    assert.equal(M.readRulesOn(new MockCity(1)), false);
  });
});

describe("decoding the engine's records", () => {
  test("rewards: records of five integers, flags as booleans", () => {
    const out = M.decodeRewards(Int32Array.from([50, 1, 0, 2000, 0, 52, 0, 1, 5000, 70]));
    assert.deepEqual(out, [
      { genre: 50, unlocked: true, placed: false, population: 2000, satisfaction: 0 },
      { genre: 52, unlocked: false, placed: true, population: 5000, satisfaction: 70 },
    ]);
  });

  test("rewards: a truncated last record is ignored; negative or missing counts are 0; nothing for no data", () => {
    assert.equal(M.decodeRewards(Int32Array.from([50, 1, 0, 2000, 0, 51, 1])).length, 1);
    assert.deepEqual(M.decodeRewards([53, 0, 0, -4, "x"]).map((r) => [r.population, r.satisfaction]), [[0, 0]]);
    assert.deepEqual(M.decodeRewards(undefined), []);
    assert.deepEqual(M.decodeRewards(new Int32Array(0)), []);
  });

  test("rewards: at most MAX_RECORDS records, whatever the engine sends", () => {
    const flat = new Int32Array((M.MAX_RECORDS + 10) * M.REWARD_LENGTH).fill(1);
    assert.equal(M.decodeRewards(flat).length, M.MAX_RECORDS);
  });

  test("offers: records of four integers; an unknown state counts as none; at most MAX_RECORDS", () => {
    const out = M.decodeOffers(Int32Array.from([60, 3000, 1, 8000, 61, 5000, 9, 15000]));
    assert.deepEqual(out.map((o) => [o.genre, o.income, o.state, o.population]), [[60, 3000, 1, 8000], [61, 5000, 0, 15000]]);
    const flat = new Int32Array((M.MAX_RECORDS + 5) * M.OFFER_LENGTH).fill(0);
    assert.equal(M.decodeOffers(flat).length, M.MAX_RECORDS);
    assert.deepEqual(M.decodeOffers(undefined), []);
  });

  test("reward stats: four values, missing or negative ones are 0", () => {
    assert.deepEqual(M.decodeRewardStats(Int32Array.from([72, 3000, 2, 1])), {
      satisfaction: 72, specialIncome: 3000, unlocked: 2, accepted: 1,
    });
    assert.deepEqual(M.decodeRewardStats([-1, 5]), { satisfaction: 0, specialIncome: 5, unlocked: 0, accepted: 0 });
    assert.deepEqual(M.decodeRewardStats(undefined), { satisfaction: 0, specialIncome: 0, unlocked: 0, accepted: 0 });
  });

  test("reward stats: only the first STAT_COUNT values are read", () => {
    assert.equal(M.STAT_COUNT, 4);
    assert.deepEqual(M.decodeRewardStats([1, 2, 3, 4, 99, 99]), { satisfaction: 1, specialIncome: 2, unlocked: 3, accepted: 4 });
  });
});

describe("the reward texts", () => {
  test("the status: posée, débloquée à poser, verrouillée with the population", () => {
    assert.equal(M.rewardStatus(reward({ unlocked: true, placed: true })), "Posée");
    assert.equal(M.rewardStatus(reward({ unlocked: true })), "Débloquée — à poser");
    assert.equal(norm(M.rewardStatus(reward({ population: 2000 }))), "Verrouillée : 2 000 habitants");
  });

  test("the status adds the satisfaction when one is required", () => {
    const r = reward({ genre: 52, population: 5000, satisfaction: 70 });
    assert.equal(norm(M.rewardStatus(r)), "Verrouillée : 5 000 habitants, 70 % de satisfaction");
    assert.equal(M.rewardStatus(reward({ unlocked: true, satisfaction: 70 })), "Débloquée — à poser", "unlocked: no lock text");
  });

  test("the line: the name, then the status in brackets", () => {
    assert.equal(M.rewardLine(reward({ genre: 51, unlocked: true })), "Hôtel de ville (Débloquée — à poser)");
    assert.equal(norm(M.rewardLine(reward({ genre: 54, population: 50000, satisfaction: 80 }))),
      "Arc de triomphe (Verrouillée : 50 000 habitants, 80 % de satisfaction)");
  });

  test("the offer text: the income while proposed, the answer once given, the threshold before", () => {
    assert.equal(norm(M.offerText(offer({ state: STATE.PROPOSED }))), "Casino rapporte 3 000 $ par an");
    assert.equal(M.offerText(offer({ state: STATE.ACCEPTED })), "Casino : Accepté");
    assert.equal(M.offerText(offer({ state: STATE.REFUSED })), "Casino : Refusé");
    assert.equal(norm(M.offerText(offer({ genre: 61, population: 15000 }))), "Prison d'État : Pas encore proposé (15 000 habitants)");
  });

  test("only a proposed offer shows the answer buttons", () => {
    assert.deepEqual([0, 1, 2, 3].map((state) => M.offerAnswerable(offer({ state }))), [false, true, false, false]);
  });

  test("the statistics lines, in a fixed order", () => {
    assert.deepEqual(M.statsLines({ satisfaction: 72, specialIncome: 3000 }).map(norm), [
      "Satisfaction : 72 %", "Recette des accords l'an dernier : 3 000 $",
    ]);
  });

  test("the note says what the rule does, on or off", () => {
    assert.equal(M.noteText(false), M.RULE_OFF_NOTE);
    assert.equal(M.noteText(true), M.RULE_ON_NOTE);
    assert.notEqual(M.RULE_OFF_NOTE, M.RULE_ON_NOTE);
  });
});

describe("the names of the genres 50-54 and 60-63 (structures-model.js)", () => {
  test("the French names of the rewards and the special offers", () => {
    assert.deepEqual(MOCK_REWARDS.map((r) => nameOf(r.genre)), [
      "Résidence du maire", "Hôtel de ville", "Statue du maire", "Palais de justice", "Arc de triomphe",
    ]);
    assert.deepEqual(MOCK_OFFERS.map((o) => nameOf(o.genre)), ["Casino", "Prison d'État", "Décharge toxique", "Base de missiles"]);
  });

  test("the name tables hold exactly the genres of the milestone, and an unknown genre keeps its number", () => {
    assert.deepEqual(Object.keys(REWARD_NAMES).map(Number), [50, 51, 52, 53, 54]);
    assert.deepEqual(Object.keys(SPECIAL_NAMES).map(Number), [60, 61, 62, 63]);
    assert.equal(nameOf(64), "Bâtiment n° 64");
  });
});
