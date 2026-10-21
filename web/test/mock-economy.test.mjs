// The economy of the mock engine (web/test/mock-economy.mjs, the `economy` option of mock-engine.mjs): the methods are
// hidden without the option; off, every change is refused; on, the rates, the income, the bonds (issue and repayment with
// the funds, the cap of MAX_BONDS, the rate per bond) and the goods behave as documented in the mock's header.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MockCity, START_FUNDS } from "./mock-engine.mjs";
import {
  ECONOMY_METHODS, MockEconomy, MAX_BONDS, BOND_AMOUNT, MOCK_TAX_START, MAX_TAX_RATE, MOCK_GOODS, offerPermille,
  TAX_INCOME_PER_POINT,
} from "./mock-economy.mjs";

const on = () => {
  const city = new MockCity(1, { economy: true });
  city.set_economy_rules(true);
  return city;
};

describe("the methods and the rule", () => {
  test("hidden without the option, present with it", () => {
    const off = new MockCity(1);
    for (const m of ECONOMY_METHODS) assert.equal(off[m], undefined, m);
    const yes = new MockCity(1, { economy: true });
    for (const m of ECONOMY_METHODS) assert.equal(typeof yes[m], "function", m);
  });

  test("off by default and after a new city or a load", () => {
    const city = on();
    assert.equal(city.economy_rules(), true);
    city.new_random_city(3);
    assert.equal(city.economy_rules(), false);
    city.set_economy_rules(true);
    city.load_cty(new Uint8Array(0));
    assert.equal(city.economy_rules(), false);
  });

  test("a new city and a load bring the rates back to the start and forget the bonds", () => {
    const city = on();
    city.set_tax_rate(2, 3, 15);
    city.issue_bond();
    city.new_random_city(3);
    city.set_economy_rules(true);
    assert.deepEqual([...city.tax_rates()], Array(9).fill(MOCK_TAX_START));
    assert.equal(city.bonds().length, 0);
  });
});

describe("off: every change is refused", () => {
  test("set_tax_rate is false and the rate stays; the offer is [0, 0]", () => {
    const city = new MockCity(1, { economy: true });
    assert.equal(city.set_tax_rate(1, 1, 12), false);
    assert.equal(city.tax_rates()[0], MOCK_TAX_START);
    assert.deepEqual([...city.bond_offer()], [0, 0]);
  });

  test("issue_bond and repay_bond return 0; no money moves; the income and the goods are zeros", () => {
    const city = new MockCity(1, { economy: true });
    assert.equal(city.issue_bond(), 0);
    assert.equal(city.funds(), START_FUNDS);
    assert.equal(city.repay_bond(0), 0);
    assert.deepEqual([...city.tax_income()], Array(9).fill(0));
    assert.deepEqual([...city.goods_stats()], Array(6).fill(0));
  });
});

describe("the tax rates", () => {
  test("nine cells, index (genre - 1) * 3 + (richesse - 1); the start rate", () => {
    assert.deepEqual([...on().tax_rates()], Array(9).fill(MOCK_TAX_START));
  });

  test("set_tax_rate stores a rate in 0..=20 and refuses the rest", () => {
    const city = on();
    assert.equal(city.set_tax_rate(2, 3, 15), true);
    assert.equal(city.tax_rates()[1 * 3 + 2], 15);
    assert.equal(city.set_tax_rate(1, 1, 0), true);
    assert.equal(city.set_tax_rate(1, 1, MAX_TAX_RATE), true);
    assert.equal(city.set_tax_rate(1, 1, MAX_TAX_RATE + 1), false);
    assert.equal(city.set_tax_rate(1, 1, -1), false);
    assert.equal(city.set_tax_rate(1, 1, 2.5), false);
    assert.equal(city.tax_rates()[0], MAX_TAX_RATE, "the last valid rate holds");
  });

  test("a genre or a richesse out of 1..3 is refused", () => {
    const city = on();
    for (const [g, r] of [[0, 1], [4, 1], [1, 0], [1, 4], [1.5, 1]]) {
      assert.equal(city.set_tax_rate(g, r, 5), false, `${g}/${r}`);
    }
    assert.equal(city.tax_rates().every((v) => v === MOCK_TAX_START), true);
  });

  test("the income of a case is its rate times TAX_INCOME_PER_POINT while on", () => {
    const city = on();
    city.set_tax_rate(1, 1, 10);
    assert.equal(city.tax_income()[0], 10 * TAX_INCOME_PER_POINT);
    assert.equal(city.tax_income()[1], MOCK_TAX_START * TAX_INCOME_PER_POINT);
  });
});

describe("the bonds", () => {
  test("the offer: 10 000 $ at 3,0 % with no bond, one more step per bond in force", () => {
    const city = on();
    assert.deepEqual([...city.bond_offer()], [BOND_AMOUNT, 30]);
    city.issue_bond();
    assert.deepEqual([...city.bond_offer()], [BOND_AMOUNT, 40]);
    assert.equal(offerPermille(2), 50);
  });

  test("issue_bond: 1, the funds rise by the amount, the bond is listed as [amount, permille, years]", () => {
    const city = on();
    assert.equal(city.issue_bond(), 1);
    assert.equal(city.funds(), START_FUNDS + BOND_AMOUNT);
    assert.deepEqual([...city.bonds()], [BOND_AMOUNT, 30, 0]);
  });

  test("the cap: MAX_BONDS bonds, then -1, the funds and the list do not move", () => {
    const city = on();
    for (let i = 0; i < MAX_BONDS; i++) assert.equal(city.issue_bond(), 1, `bond ${i}`);
    const funds = city.funds();
    assert.equal(city.issue_bond(), -1);
    assert.equal(city.funds(), funds);
    assert.equal(city.bonds().length, MAX_BONDS * 3);
    assert.deepEqual([...city.bond_offer()], [0, 0], "no offer at the cap");
  });

  test("repay_bond: 1 and the funds fall by the amount; the bond leaves the list", () => {
    const city = on();
    city.issue_bond();
    city.issue_bond();
    const funds = city.funds();
    assert.equal(city.repay_bond(0), 1);
    assert.equal(city.funds(), funds - BOND_AMOUNT);
    assert.deepEqual([...city.bonds()], [BOND_AMOUNT, 40, 0], "the second bond is now first");
  });

  test("repay_bond refuses an unknown index or missing funds (-1), with nothing moved", () => {
    const city = on();
    assert.equal(city.repay_bond(0), -1, "no bond");
    assert.equal(city.repay_bond(-1), -1);
    assert.equal(city.repay_bond(1.5), -1);
    city.issue_bond();
    const poor = new MockEconomy();
    poor.setRules(true);
    poor.issue();
    assert.equal(poor.repay(0, BOND_AMOUNT - 1).code, -1, "funds below the amount");
    assert.equal(poor.repay(0, BOND_AMOUNT).code, 1, "funds equal to the amount are enough");
  });

  test("the mock economy: issue and repay return the funds' change and the codes", () => {
    const e = new MockEconomy();
    assert.deepEqual(e.issue(), { code: 0, delta: 0 }, "off");
    e.setRules(true);
    assert.deepEqual(e.issue(), { code: 1, delta: BOND_AMOUNT });
    assert.deepEqual(e.repay(5, 0), { code: -1, delta: 0 }, "unknown index");
    assert.deepEqual(e.repay(0, BOND_AMOUNT), { code: 1, delta: -BOND_AMOUNT });
    e.setRules(false);
    assert.deepEqual(e.repay(0, BOND_AMOUNT), { code: 0, delta: 0 }, "off again");
  });
});

describe("the goods", () => {
  test("MOCK_GOODS while on, with the shortage flag at 0 by default", () => {
    const city = on();
    assert.deepEqual([...city.goods_stats()], [...MOCK_GOODS]);
    assert.equal(city.goods_stats()[5], 0);
  });

  test("conservation: produced + imported = consumed + exported", () => {
    const [produced, consumed, exported, imported] = on().goods_stats();
    assert.equal(produced + imported, consumed + exported);
  });

  test("the shortage flag set by the test hook shows in goods_stats while on", () => {
    const city = on();
    city.set_mock_shortage(true);
    assert.equal(city.goods_stats()[5], 1);
    city.set_mock_shortage(false);
    assert.equal(city.goods_stats()[5], 0);
    city.set_mock_shortage(true);
    city.set_economy_rules(false);
    assert.equal(city.goods_stats()[5], 0, "zeros while off");
  });
});
