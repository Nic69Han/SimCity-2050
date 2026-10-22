// Economy advice (web/advisors-economy.js): a shortage of goods, a tax rate of 15 % or more and more than 5 bonds are each
// one attention finding; the numbers come from the economy block of the snapshot (read with the rule only).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as E from "../advisors-economy.js";
import * as M from "../advisors-model.js";
import { readSnapshot, cheapKey } from "../advisors.js";
import { MockCity } from "./mock-engine.mjs";

// A snapshot with the economy rule on and the given economy block.
const withEconomy = (economy, rules = { economy: true }) => ({ rules, economy });
const calm = { shortage: false, taxRates: [7, 7, 7, 7, 7, 7, 7, 7, 7], bondCount: 1 };

describe("thresholds and texts", () => {
  test("the severity, the thresholds and the actions", () => {
    assert.equal(E.ECONOMY_SEVERITY, "attention");
    assert.equal(E.TAX_LEAVE_RATE, 15);
    assert.equal(E.MANY_BONDS, 5);
    assert.match(E.SHORTAGE_ACTION, /Zonez de l'industrie ou baissez ses impôts/);
    assert.match(E.TAX_ACTION, /impôts/);
    assert.match(E.BONDS_ACTION, /Remboursez/);
  });
});

describe("economyOf", () => {
  test("shortage, the highest rate and the bond count with the rule on", () => {
    assert.deepEqual(E.economyOf(withEconomy({ shortage: true, taxRates: [3, 16, 9], bondCount: 2 })), {
      shortage: true, maxRate: 16, bonds: 2,
    });
  });
  test("null with the rule off, without a block, or with a block that is not an object", () => {
    assert.equal(E.economyOf(withEconomy(calm, { economy: false })), null);
    assert.equal(E.economyOf({ rules: {}, economy: calm }), null);
    assert.equal(E.economyOf({ rules: { economy: true } }), null);
    assert.equal(E.economyOf({ rules: { economy: true }, economy: 5 }), null);
    assert.equal(E.economyOf(null), null);
  });
  test("a missing, garbage or negative number reads as 0; the shortage is true only for true", () => {
    assert.deepEqual(E.economyOf(withEconomy({ shortage: 1, taxRates: "x", bondCount: -2 })), { shortage: false, maxRate: 0, bonds: 0 });
    assert.deepEqual(E.economyOf(withEconomy({ taxRates: [NaN, 4, "9", -1] })), { shortage: false, maxRate: 4, bonds: 0 }, "a string reads as 0");
  });
});

describe("the three findings", () => {
  test("shortage: attention when the flag is set, null otherwise", () => {
    const f = E.shortageFinding({ shortage: true, maxRate: 0, bonds: 0 });
    assert.deepEqual(f, { severity: "attention", diagnosis: E.SHORTAGE_DIAGNOSIS, action: E.SHORTAGE_ACTION });
    assert.equal(E.shortageFinding({ shortage: false, maxRate: 0, bonds: 0 }), null);
  });

  test("taxes: at 15 % or more, attention about the people leaving; below it, null", () => {
    assert.equal(E.taxFinding({ shortage: false, maxRate: 14, bonds: 0 }), null);
    const f = E.taxFinding({ shortage: false, maxRate: 15, bonds: 0 });
    assert.equal(f.severity, "attention");
    assert.match(f.diagnosis, /15 % : des habitants quittent ces zones/);
    assert.equal(f.action, E.TAX_ACTION);
    assert.match(E.taxFinding({ shortage: false, maxRate: 20, bonds: 0 }).diagnosis, /20 %/);
  });

  test("bonds: attention above 5 bonds, null at 5", () => {
    assert.equal(E.bondFinding({ shortage: false, maxRate: 0, bonds: 5 }), null);
    const f = E.bondFinding({ shortage: false, maxRate: 0, bonds: 6 });
    assert.equal(f.severity, "attention");
    assert.match(f.diagnosis, /^6 obligations en cours/);
    assert.equal(f.action, E.BONDS_ACTION);
  });
});

describe("economyFindings", () => {
  test("nothing when the rule is off, the block is missing, or all is well", () => {
    assert.deepEqual(E.economyFindings(withEconomy(calm, { economy: false })), []);
    assert.deepEqual(E.economyFindings({ rules: { economy: true } }), []);
    assert.deepEqual(E.economyFindings(withEconomy(calm)), []);
  });

  test("the findings in order: shortage, taxes, bonds", () => {
    const f = E.economyFindings(withEconomy({ shortage: true, taxRates: [15], bondCount: 6 }));
    assert.equal(f.length, 3);
    assert.equal(f[0].diagnosis, E.SHORTAGE_DIAGNOSIS);
    assert.match(f[1].diagnosis, /^Un impôt atteint 15 %/);
    assert.match(f[2].diagnosis, /^6 obligations en cours/);
  });

  test("the cap of the list: at most three findings, one per rule", () => {
    const f = E.economyFindings(withEconomy({ shortage: true, taxRates: Array(9).fill(20), bondCount: 99 }));
    assert.equal(f.length, 3);
  });

  test("the findings have the advisors' shape and severity names", () => {
    const [f] = E.economyFindings(withEconomy({ shortage: true, taxRates: [], bondCount: 0 }));
    assert.deepEqual(Object.keys(f).sort(), ["action", "diagnosis", "severity"]);
    assert.ok(Object.keys(M.SEVERITY_LABEL).includes(f.severity));
  });
});

// The wiring (advisors.js readSnapshot and cheapKey, advisors-model.js financesAdvice), on the mock engine.
const financesOf = (snapshot) => M.advise(snapshot).find((x) => x.id === "finances");
const economyCity = (rule = true) => {
  const city = new MockCity(1, { economy: true });
  if (rule) city.set_economy_rules(true);
  return city;
};

describe("readSnapshot reads the economy block with the rule only", () => {
  test("no block with the rule off, and none without the economy API", () => {
    assert.equal(readSnapshot(economyCity(false)).economy, undefined, "rule off");
    assert.equal(readSnapshot(new MockCity(1)).economy, undefined, "no economy API");
    assert.equal(readSnapshot(economyCity(false)).rules.economy, false);
  });

  test("the block with the rule on: no shortage, the nine rates, no bond", () => {
    assert.deepEqual(readSnapshot(economyCity()).economy, { shortage: false, taxRates: Array(9).fill(7), bondCount: 0 });
  });
});

describe("the Finances advisor takes the economy findings", () => {
  test("a goods shortage is an attention finding of Finances", () => {
    const city = economyCity();
    city.set_mock_shortage(true);
    const a = financesOf(readSnapshot(city));
    assert.equal(a.id, "finances");
    assert.equal(a.severity, "attention");
    assert.equal(a.diagnosis, E.SHORTAGE_DIAGNOSIS);
    assert.equal(a.action, E.SHORTAGE_ACTION);
  });

  test("a tax rate of 15 % is an attention finding of Finances", () => {
    const city = economyCity();
    city.set_tax_rate(2, 2, 14);
    assert.equal(financesOf(readSnapshot(city)).diagnosis.startsWith("Un impôt"), false, "14 %: nothing");
    city.set_tax_rate(2, 2, 15);
    const a = financesOf(readSnapshot(city));
    assert.equal(a.severity, "attention");
    assert.match(a.diagnosis, /^Un impôt atteint 15 %/);
  });

  test("six bonds are an attention finding of Finances; five are not", () => {
    const city = economyCity();
    for (let i = 0; i < 5; i++) city.issue_bond();
    assert.doesNotMatch(financesOf(readSnapshot(city))?.diagnosis ?? "", /obligations/, "5 bonds: nothing");
    city.issue_bond();
    const a = financesOf(readSnapshot(city));
    assert.equal(a.severity, "attention");
    assert.match(a.diagnosis, /^6 obligations en cours/);
  });

  test("economy findings alone make the advisor (no funds, cash flow or votes needed)", () => {
    const a = financesOf({ rules: { economy: true }, economy: { shortage: true, taxRates: [], bondCount: 0 } });
    assert.equal(a?.severity, "attention");
    assert.equal(a.diagnosis, E.SHORTAGE_DIAGNOSIS);
  });

  test("nothing from the economy with the rule off, even when the engine would report the numbers", () => {
    // a rule-off engine that still answers the getters: the snapshot must not read them
    const off = {
      economy_rules: () => false,
      goods_stats: () => Int32Array.from([0, 0, 0, 0, 0, 1]),
      tax_rates: () => Int32Array.from(Array(9).fill(18)),
      bonds: () => Int32Array.from({ length: 18 }, () => 1),
      tax_income: () => Int32Array.from(Array(9).fill(0)),
      bond_offer: () => Int32Array.of(0, 0),
    };
    assert.equal(readSnapshot(off).economy, undefined);
    assert.deepEqual(M.advise(readSnapshot(off)), []);
  });
});

describe("cheapKey follows the economy with the rule on", () => {
  test("a tax rate, a bond or the goods change the key; with the rule off they do not", () => {
    const off = economyCity(false);
    const k0 = cheapKey(off);
    off.issue_bond();
    off.set_tax_rate(1, 1, 9);
    assert.equal(cheapKey(off), k0, "rule off: the engine refuses, the key stays");
    const city = economyCity();
    const on = cheapKey(city);
    city.set_tax_rate(1, 1, 9);
    const rate = cheapKey(city);
    assert.notEqual(rate, on, "a tax rate");
    city.issue_bond();
    const bond = cheapKey(city);
    assert.notEqual(bond, rate, "a bond");
    city.set_mock_shortage(true);
    assert.notEqual(cheapKey(city), bond, "the goods");
  });
});
