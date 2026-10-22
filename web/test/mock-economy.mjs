// Economy of the mock engine (docs/game-design-v11.md), used by mock-engine.mjs when its `economy` option is on.
// A small in-memory state: the rule switch, the nine tax rates, the bonds and the goods shortage flag. The engine's real
// rules are the core's (crates/micropolis-core/src/economy.rs); the mock only keeps the numbers the page reads and
// writes, with the same limits as the contract (rates 0..=20, at most MAX_BONDS bonds, a repayment needs the funds).
// The rule is off by default and after a new city or a load; off, the rates are kept but refused to change.

// The methods of the economy API, hidden unless the constructor asks with `economy: true`.
export const ECONOMY_METHODS = Object.freeze([
  "economy_rules", "set_economy_rules", "tax_rates", "set_tax_rate", "tax_income", "bonds", "bond_offer",
  "issue_bond", "repay_bond", "goods_stats",
]);

// The tax rate of every case when the city starts (the mock has no city_tax: a fixed 7 %, the classic start).
export const MOCK_TAX_START = 7;
// Limits of the contract (docs/game-design-v11.md).
export const MAX_TAX_RATE = 20;
export const MAX_BONDS = 10;
export const BOND_AMOUNT = 10000;
export const BOND_BASE_PERMILLE = 30;
export const BOND_STEP_PERMILLE = 10;
// Result codes of issue_bond and repay_bond (contract: 1 done, 0 rule off, -1 refused).
export const DONE = 1;
export const RULE_OFF = 0;
export const REFUSED = -1;
// Mock income: dollars per tax-rate point and per case while the rule is on (no population is modelled).
export const TAX_INCOME_PER_POINT = 100;
// goods_stats while the rule is on: [produced, consumed, exported, imported, net revenue, shortage flag].
// Conservation holds: produced + imported = consumed + exported; net = exported - imported at 1 $ and 2 $ a unit
// (here 30 exported at 1 $ each, nothing imported).
export const MOCK_GOODS = Object.freeze([120, 90, 30, 0, 30, 0]);

/** The permille rate of the next bond after `count` bonds in force. */
export function offerPermille(count) {
  return BOND_BASE_PERMILLE + BOND_STEP_PERMILLE * count;
}

/** The mock's economy state; MockCity keeps the funds and calls these methods. */
export class MockEconomy {
  #rules = false;
  #rates = [];
  #bonds = []; // { amount, permille, years }, in issue order
  #shortage = 0; // test hook (set_mock_shortage): the shortage flag of goods_stats

  constructor() {
    this.reset();
  }

  /** A new city or a load: the rule off, the rates back to the start, no bond, zero goods. */
  reset() {
    this.#rules = false;
    this.#rates = Array.from({ length: 9 }, () => MOCK_TAX_START);
    this.#bonds = [];
    this.#shortage = 0;
  }

  rules() {
    return this.#rules;
  }
  setRules(on) {
    this.#rules = Boolean(on);
  }

  /** Nine rates, index (genre - 1) * 3 + (class - 1). */
  rates() {
    return Int32Array.from(this.#rates);
  }

  /** Stores the rate when the rule is on and the rate is in 0..=MAX_TAX_RATE; false otherwise. */
  setRate(index, rate) {
    if (!this.#rules || !Number.isInteger(rate) || rate < 0 || rate > MAX_TAX_RATE) return false;
    this.#rates[index] = rate;
    return true;
  }

  /** Income of the last year per case: the rate times TAX_INCOME_PER_POINT while the rule is on, else zeros. */
  income() {
    return Int32Array.from(this.#rates, (r) => (this.#rules ? r * TAX_INCOME_PER_POINT : 0));
  }

  /** Flat records [amount, permille, years] of the bonds in force. */
  bondsFlat() {
    return Int32Array.from(this.#bonds.flatMap((b) => [b.amount, b.permille, b.years]));
  }

  /** [amount, permille] of the next bond, [0, 0] when the rule is off or MAX_BONDS are in force. */
  offer() {
    if (!this.#rules || this.#bonds.length >= MAX_BONDS) return Int32Array.of(0, 0);
    return Int32Array.of(BOND_AMOUNT, offerPermille(this.#bonds.length));
  }

  /** issue_bond: the code and the change of the funds (BOND_AMOUNT in, on success). */
  issue() {
    if (!this.#rules) return { code: RULE_OFF, delta: 0 };
    if (this.#bonds.length >= MAX_BONDS) return { code: REFUSED, delta: 0 };
    this.#bonds.push({ amount: BOND_AMOUNT, permille: offerPermille(this.#bonds.length), years: 0 });
    return { code: DONE, delta: BOND_AMOUNT };
  }

  /** repay_bond(index): refused for an unknown index or without the funds; the change of the funds is -amount. */
  repay(index, funds) {
    if (!this.#rules) return { code: RULE_OFF, delta: 0 };
    const b = Number.isInteger(index) ? this.#bonds[index] : undefined;
    if (!b || b.amount > funds) return { code: REFUSED, delta: 0 };
    this.#bonds.splice(index, 1);
    return { code: DONE, delta: -b.amount };
  }

  /** Test hook: the shortage flag (0 or 1) that goods() reports while the rule is on. */
  setShortage(flag) {
    this.#shortage = flag ? 1 : 0;
  }

  /** goods_stats: MOCK_GOODS while the rule is on (its shortage flag set by setShortage), zeros otherwise. */
  goods() {
    if (!this.#rules) return new Int32Array(MOCK_GOODS.length);
    const out = Int32Array.from(MOCK_GOODS);
    out[5] = this.#shortage;
    return out;
  }
}
