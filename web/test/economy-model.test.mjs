// Economy, presentation side (web/economy-model.js): the decoding of the engine arrays (clamps, caps, missing values),
// the French texts (per mille as a percent with a French comma, the money, the lines), the result codes, and the support check.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as M from "../economy-model.js";
import { MockCity } from "./mock-engine.mjs";
import { formatInt, formatMoney } from "../budget-text.js";

const NB = " "; // the no-break space the page writes before %
const money = (n) => formatMoney(n);

describe("supports and readRulesOn", () => {
  test("supports: every method of METHODS, else false", () => {
    assert.equal(M.supports(new MockCity(1, { economy: true })), true);
    assert.equal(M.supports(new MockCity(1)), false);
    const half = new MockCity(1, { economy: true });
    half.goods_stats = undefined;
    assert.equal(M.supports(half), false);
    assert.equal(M.supports(null), false);
  });

  test("readRulesOn: the engine flag with the API, false without", () => {
    const city = new MockCity(1, { economy: true });
    assert.equal(M.readRulesOn(city), false);
    city.set_economy_rules(true);
    assert.equal(M.readRulesOn(city), true);
    assert.equal(M.readRulesOn(new MockCity(1)), false);
  });
});

describe("cellIndex", () => {
  test("genre and richesse 1..3 map to 0..8 in the engine's order", () => {
    assert.equal(M.cellIndex(1, 1), 0);
    assert.equal(M.cellIndex(1, 3), 2);
    assert.equal(M.cellIndex(2, 1), 3);
    assert.equal(M.cellIndex(3, 3), 8);
  });
});

describe("decodeRates", () => {
  test("nine rates, clamped to 0..20; a missing or garbage value is 0", () => {
    assert.deepEqual(M.decodeRates([7, 0, 20, 25, -3, 9, 1.9, "x"]), [7, 0, 20, 20, 0, 9, 1, 0, 0]);
  });
  test("nothing gives nine zeros; extra values are ignored", () => {
    assert.deepEqual(M.decodeRates(null), Array(9).fill(0));
    assert.equal(M.decodeRates(Array(12).fill(5)).length, 9);
  });
});

describe("decodeIncome", () => {
  test("nine counts; negative and garbage read as 0", () => {
    assert.deepEqual(M.decodeIncome([1200, -5, 0, NaN, 7, 3, 2, 1, 9, 99]), [1200, 0, 0, 0, 7, 3, 2, 1, 9]);
    assert.deepEqual(M.decodeIncome(undefined), Array(9).fill(0));
  });
});

describe("parseRate", () => {
  test("a whole number from 0 to 20, spaces allowed", () => {
    assert.equal(M.parseRate("0"), 0);
    assert.equal(M.parseRate("20"), 20);
    assert.equal(M.parseRate(" 7 "), 7);
    assert.equal(M.parseRate("007"), 7);
  });
  test("refused (null): above 20, negative, decimal, empty, letters, not a string", () => {
    for (const bad of ["21", "-1", "2.5", "", "   ", "abc", "1e2", "99999999999999999999", undefined, null]) {
      assert.equal(M.parseRate(bad), null, JSON.stringify(bad));
    }
  });
});

describe("decodeBonds", () => {
  test("records of three: amount, permille, years", () => {
    assert.deepEqual(M.decodeBonds([10000, 30, 2, 10000, 40, 0]), [
      { amount: 10000, permille: 30, years: 2 },
      { amount: 10000, permille: 40, years: 0 },
    ]);
  });
  test("a truncated last record is ignored; garbage reads as 0", () => {
    assert.deepEqual(M.decodeBonds([10000, 30, 2, 5]), [{ amount: 10000, permille: 30, years: 2 }]);
    assert.deepEqual(M.decodeBonds([-1, "x", NaN]), [{ amount: 0, permille: 0, years: 0 }]);
    assert.deepEqual(M.decodeBonds(null), []);
  });
  test("at most MAX_BOND_RECORDS records, whatever the engine sends", () => {
    const flat = Array.from({ length: (M.MAX_BOND_RECORDS + 5) * M.BOND_FIELDS }, () => 1);
    assert.equal(M.decodeBonds(flat).length, M.MAX_BOND_RECORDS);
  });
});

describe("decodeOffer", () => {
  test("[amount, permille]; available only above 0", () => {
    assert.deepEqual(M.decodeOffer([10000, 40]), { amount: 10000, permille: 40, available: true });
    assert.deepEqual(M.decodeOffer([0, 0]), { amount: 0, permille: 0, available: false });
    assert.deepEqual(M.decodeOffer(undefined), { amount: 0, permille: 0, available: false });
  });
});

describe("decodeGoods", () => {
  test("six fields: counts, signed net revenue, shortage 0 or 1", () => {
    assert.deepEqual(M.decodeGoods([120, 90, 30, 0, -15, 1]), {
      produced: 120, consumed: 90, exported: 30, imported: 0, netRevenue: -15, shortage: 1,
    });
  });
  test("the shortage is 1 only for the value 1; missing values are 0", () => {
    assert.equal(M.decodeGoods([0, 0, 0, 0, 0, 2]).shortage, 0);
    assert.equal(M.decodeGoods([]).shortage, 0);
    assert.equal(M.decodeGoods([]).netRevenue, 0);
    assert.equal(M.decodeGoods([-4, -4, -4, -4]).produced, 0, "a negative count reads as 0");
  });
});

describe("percentText: per mille as a percent with one decimal and a French comma", () => {
  test("30 -> 3,0 %; 40 -> 4,0 %; 125 -> 12,5 %; 5 -> 0,5 %; 0 -> 0,0 %", () => {
    assert.equal(M.percentText(30), `3,0${NB}%`);
    assert.equal(M.percentText(40), `4,0${NB}%`);
    assert.equal(M.percentText(125), `12,5${NB}%`);
    assert.equal(M.percentText(5), `0,5${NB}%`);
    assert.equal(M.percentText(0), `0,0${NB}%`);
  });
  test("a negative or garbage value reads as 0; thousands are grouped", () => {
    assert.equal(M.percentText(-30), `0,0${NB}%`);
    assert.equal(M.percentText("x"), `0,0${NB}%`);
    assert.equal(M.percentText(12345), `${formatInt(1234)},5${NB}%`);
  });
});

describe("rateText and incomeText", () => {
  test("a rate in whole percent; an income in dollars per year", () => {
    assert.equal(M.rateText(7), `7${NB}%`);
    assert.equal(M.rateText(-2), `0${NB}%`);
    assert.equal(M.incomeText(1200), `${money(1200)} par an`);
    assert.equal(M.incomeText(0), `${money(0)} par an`);
  });
});

describe("bondLine and offerLabel", () => {
  test("the bond line with the years, singular for 0 and 1", () => {
    assert.equal(M.bondLine({ amount: 10000, permille: 30, years: 2 }), `Obligation de ${money(10000)} à 3,0${NB}%, depuis 2 ans`);
    assert.equal(M.bondLine({ amount: 10000, permille: 30, years: 1 }), `Obligation de ${money(10000)} à 3,0${NB}%, depuis 1 an`);
    assert.equal(M.bondLine({ amount: 10000, permille: 40, years: 0 }), `Obligation de ${money(10000)} à 4,0${NB}%, depuis 0 an`);
  });
  test("the issue label with the offer, the bare label when no bond can be issued", () => {
    assert.equal(M.offerLabel(M.decodeOffer([10000, 40])), `Émettre une obligation (${money(10000)} à 4,0${NB}%)`);
    assert.equal(M.offerLabel(M.decodeOffer([0, 0])), "Émettre une obligation");
  });
});

describe("goodsLines", () => {
  test("five lines in order; the shortage line only with the flag", () => {
    assert.deepEqual(M.goodsLines(M.decodeGoods([120, 90, 30, 0, 30, 0])), [
      "Marchandises produites : 120",
      "Marchandises consommées : 90",
      "Marchandises exportées : 30",
      "Marchandises importées : 0",
      `Recette nette du commerce : ${money(30)}`,
    ]);
  });
  test("the shortage line is the sixth one when the flag is 1", () => {
    const short = M.goodsLines(M.decodeGoods([120, 90, 30, 0, -4, 1]));
    assert.equal(short.length, 6);
    assert.equal(short[4], `Recette nette du commerce : ${money(-4)}`);
    assert.equal(short[5], "Pénurie de marchandises");
  });
});

describe("texts and result codes", () => {
  test("the rule note says what the switch does", () => {
    assert.match(M.ruleNote(false), /^Désactivé/);
    assert.match(M.ruleNote(true), /impôts selon sa richesse/);
  });
  test("issue: 1 done, 0 rule off, -1 cap; any other code is empty", () => {
    assert.match(M.issueMessage(1), /émise/);
    assert.match(M.issueMessage(0), /activez « Économie détaillée »/);
    assert.match(M.issueMessage(-1), /plafond/);
    assert.equal(M.issueMessage(7), "");
  });
  test("repay: 1 done, 0 rule off, -1 funds or index; any other code is empty", () => {
    assert.match(M.repayMessage(1), /remboursée/);
    assert.match(M.repayMessage(0), /activez/);
    assert.match(M.repayMessage(-1), /fonds insuffisants/);
    assert.equal(M.repayMessage(2), "");
  });
  test("tax: the engine's boolean answer", () => {
    assert.equal(M.taxMessage(true), "Taux enregistré.");
    assert.match(M.taxMessage(false), /^Taux refusé/);
  });
});

describe("readEconomy (the advisors' block, read from the engine's getters)", () => {
  test("off: no shortage, the start rates (kept by the engine), no bond", () => {
    const city = new MockCity(1, { economy: true });
    assert.deepEqual(M.readEconomy(city), { shortage: false, taxRates: Array(9).fill(7), bondCount: 0 });
  });
  test("on: the rates, the shortage flag and the bonds in force", () => {
    const city = new MockCity(1, { economy: true });
    city.set_economy_rules(true);
    city.set_mock_shortage(true);
    city.issue_bond();
    const e = M.readEconomy(city);
    assert.equal(e.shortage, true);
    assert.deepEqual(e.taxRates, Array(9).fill(7));
    assert.equal(e.bondCount, 1);
  });
});
