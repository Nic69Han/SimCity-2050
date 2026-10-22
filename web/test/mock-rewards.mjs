// Rewards of the mock engine (docs/game-design-v12.md), used by mock-engine.mjs when its `rewards` option is on.
// A small in-memory state: the rule switch, the unlocked rewards, the placed rewards and the answers to the offers.
// The engine's real rules are the core's (crates/micropolis-core/src/rewards.rs); the mock never unlocks anything by
// itself (no population is modelled): the test hooks of mock-engine.mjs unlock, propose and place.
// Off by default and after a new city or a load; switching the rule off forgets the unlocks and the answers.

// The methods of the rewards API, hidden unless the constructor asks with `rewards: true`.
export const REWARD_METHODS = Object.freeze([
  "reward_rules", "set_reward_rules", "rewards", "special_offers", "answer_offer", "reward_stats",
]);

// The genres of the rewards (50-54) and of the special offers (60-63), with the thresholds of the contract.
export const MOCK_REWARDS = Object.freeze([
  Object.freeze({ genre: 50, population: 2000, satisfaction: 0 }),
  Object.freeze({ genre: 51, population: 10000, satisfaction: 0 }),
  Object.freeze({ genre: 52, population: 5000, satisfaction: 70 }),
  Object.freeze({ genre: 53, population: 20000, satisfaction: 0 }),
  Object.freeze({ genre: 54, population: 50000, satisfaction: 80 }),
]);
export const MOCK_OFFERS = Object.freeze([
  Object.freeze({ genre: 60, income: 3000, population: 8000 }),
  Object.freeze({ genre: 61, income: 5000, population: 15000 }),
  Object.freeze({ genre: 62, income: 8000, population: 25000 }),
  Object.freeze({ genre: 63, income: 10000, population: 40000 }),
]);

// Offer states (contract: 0 none, 1 proposed, 2 accepted, 3 refused) and the codes of answer_offer.
export const STATE = Object.freeze({ NONE: 0, PROPOSED: 1, ACCEPTED: 2, REFUSED: 3 });
export const ANSWER = Object.freeze({ DONE: 1, RULE_OFF: 0, REFUSED: -1 });

// Satisfaction of the mock city, in percent, while the rule is on (a fixed number: no evaluation is modelled).
export const MOCK_SATISFACTION = 72;

export class MockRewards {
  #on = false;
  #unlocked = new Set(); // genres of the rewards unlocked
  #placed = new Set(); // genres of the rewards placed
  #answers = new Map(); // offer genre -> state (absent = none)

  /** Back to the start: rule off, nothing unlocked, placed or answered. */
  reset() {
    this.#on = false;
    this.#unlocked.clear();
    this.#placed.clear();
    this.#answers.clear();
  }

  rule() {
    return this.#on;
  }

  /** Switching the rule off forgets the unlocks, the placements and the answers (as the contract says). */
  setRule(on) {
    if (!on) this.reset();
    this.#on = Boolean(on);
  }

  /** Flat records of REWARD fields [genre, unlocked, placed, population, satisfaction]; nothing while off. */
  rewards() {
    if (!this.#on) return new Int32Array(0);
    return Int32Array.from(MOCK_REWARDS.flatMap((r) => [
      r.genre, flag(this.#unlocked.has(r.genre)), flag(this.#placed.has(r.genre)), r.population, r.satisfaction,
    ]));
  }

  /** Flat records of OFFER fields [genre, income, state, population]; nothing while off. */
  offers() {
    if (!this.#on) return new Int32Array(0);
    return Int32Array.from(MOCK_OFFERS.flatMap((o) => [o.genre, o.income, this.#state(o.genre), o.population]));
  }

  /** answer_offer: DONE for a proposed offer, RULE_OFF while the rule is off, REFUSED for any other genre or state. */
  answer(genre, accept) {
    if (!this.#on) return ANSWER.RULE_OFF;
    if (!isOffer(genre) || this.#state(genre) !== STATE.PROPOSED) return ANSWER.REFUSED;
    this.#answers.set(genre, accept ? STATE.ACCEPTED : STATE.REFUSED);
    return ANSWER.DONE;
  }

  /** reward_stats: [satisfaction, income of the accepted offers, rewards unlocked, offers accepted]; zeros while off. */
  stats() {
    if (!this.#on) return new Int32Array(4);
    const accepted = MOCK_OFFERS.filter((o) => this.#state(o.genre) === STATE.ACCEPTED);
    const income = accepted.reduce((sum, o) => sum + o.income, 0);
    return Int32Array.from([MOCK_SATISFACTION, income, this.#unlocked.size, accepted.length]);
  }

  // Test hooks (not in the engine contract): move the state without a rule of the engine.
  unlock(genre) {
    if (MOCK_REWARDS.some((r) => r.genre === genre)) this.#unlocked.add(genre);
  }
  place(genre) {
    if (this.#unlocked.has(genre)) this.#placed.add(genre);
  }
  propose(genre) {
    if (isOffer(genre) && this.#state(genre) === STATE.NONE) this.#answers.set(genre, STATE.PROPOSED);
  }

  #state(genre) {
    return this.#answers.get(genre) ?? STATE.NONE;
  }
}

function flag(on) {
  return on ? 1 : 0;
}

function isOffer(genre) {
  return MOCK_OFFERS.some((o) => o.genre === genre);
}
