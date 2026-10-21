// Economy advice (web/advisors-economy.js): a shortage of goods, a tax rate of 15 % or more and more than 5 bonds are each
// one attention finding; the numbers come from the economy block of the snapshot (read with the rule only).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as E from "../advisors-economy.js";
import * as M from "../advisors-model.js";

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
