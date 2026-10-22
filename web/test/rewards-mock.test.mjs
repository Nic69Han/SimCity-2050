// The rewards of the mock engine (web/test/mock-rewards.mjs, the `rewards` option of mock-engine.mjs): the methods are hidden
// without the option, everything is empty or zero while the rule is off, an answer needs a proposed offer, and the
// rule, a new city and a load forget the state.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MockCity } from "./mock-engine.mjs";
import { REWARD_METHODS, MOCK_REWARDS, MOCK_OFFERS, MOCK_SATISFACTION, ANSWER, STATE } from "./mock-rewards.mjs";

describe("the mock's rewards", () => {
  test("the methods are hidden without the option, present with it", () => {
    const off = new MockCity(1);
    for (const m of REWARD_METHODS) assert.equal(off[m], undefined, m);
    const on = new MockCity(1, { rewards: true });
    for (const m of REWARD_METHODS) assert.equal(typeof on[m], "function", m);
  });

  test("off: the rule is off, the lists are empty, answers are refused with 0, the stats are zeros", () => {
    const city = new MockCity(1, { rewards: true });
    assert.equal(city.reward_rules(), false);
    assert.equal(city.rewards().length, 0);
    assert.equal(city.special_offers().length, 0);
    assert.equal(city.answer_offer(60, true), ANSWER.RULE_OFF);
    assert.deepEqual([...city.reward_stats()], [0, 0, 0, 0]);
  });

  test("on: five locked rewards with their thresholds, four offers in state none", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    const rewards = [...city.rewards()];
    assert.equal(rewards.length, MOCK_REWARDS.length * 5);
    assert.deepEqual(rewards.slice(0, 5), [50, 0, 0, 2000, 0]);
    assert.deepEqual(rewards.slice(10, 15), [52, 0, 0, 5000, 70]);
    const offers = [...city.special_offers()];
    assert.equal(offers.length, MOCK_OFFERS.length * 4);
    assert.deepEqual(offers.slice(0, 4), [60, 3000, STATE.NONE, 8000]);
    assert.deepEqual([...city.reward_stats()], [MOCK_SATISFACTION, 0, 0, 0]);
  });

  test("the test hooks unlock and place a reward, and propose an offer", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    city.mock_place_reward(50);
    assert.equal(city.rewards()[2], 0, "a locked reward cannot be placed");
    city.mock_unlock_reward(50);
    city.mock_place_reward(50);
    assert.deepEqual([...city.rewards()].slice(0, 3), [50, 1, 1]);
    city.mock_unlock_reward(99);
    assert.equal(city.reward_stats()[2], 1, "an unknown genre is not unlocked");
    city.mock_propose_offer(61);
    assert.equal(city.special_offers()[4 + 2], STATE.PROPOSED);
    city.mock_propose_offer(61);
    city.mock_propose_offer(99);
    assert.equal(city.answer_offer(99, true), ANSWER.REFUSED, "an unknown offer is not proposed");
  });

  test("answer_offer: accepts or refuses a proposed offer once; anything else is refused with -1", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    assert.equal(city.answer_offer(60, true), ANSWER.REFUSED, "not proposed");
    city.mock_propose_offer(60);
    assert.equal(city.answer_offer(60, true), ANSWER.DONE);
    assert.equal(city.special_offers()[2], STATE.ACCEPTED);
    assert.equal(city.answer_offer(60, false), ANSWER.REFUSED, "already answered");
    city.mock_propose_offer(62);
    assert.equal(city.answer_offer(62, false), ANSWER.DONE);
    assert.equal(city.special_offers()[8 + 2], STATE.REFUSED);
  });

  test("the stats: the income of the accepted offers, the unlocked rewards and the accepted offers", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    city.mock_unlock_reward(50);
    city.mock_unlock_reward(51);
    city.mock_propose_offer(60);
    city.mock_propose_offer(63);
    city.answer_offer(60, true);
    city.answer_offer(63, true);
    assert.deepEqual([...city.reward_stats()], [MOCK_SATISFACTION, 3000 + 10000, 2, 2]);
  });

  test("switching the rule off forgets the unlocks and the answers; a new city and a load switch it off too", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    city.mock_unlock_reward(50);
    city.mock_propose_offer(60);
    city.answer_offer(60, true);
    city.set_reward_rules(false);
    city.set_reward_rules(true);
    assert.equal(city.rewards()[1], 0);
    assert.equal(city.special_offers()[2], STATE.NONE);
    city.mock_unlock_reward(50);
    city.new_random_city(7);
    assert.equal(city.reward_rules(), false);
    city.set_reward_rules(true);
    assert.equal(city.rewards()[1], 0, "a new city forgets the unlocks");
    city.mock_unlock_reward(51);
    city.load_cty(new Uint8Array(0));
    assert.equal(city.reward_rules(), false);
    city.set_reward_rules(true);
    assert.equal(city.rewards()[6], 0, "a load forgets the unlocks");
  });
});
