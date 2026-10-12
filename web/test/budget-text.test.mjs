// Unit tests of the DOM-free budget formatting and chart math (web/budget-text.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as T from "../budget-text.js";

describe("formatting", () => {
  test("integers use French grouping with narrow no-break spaces", () => {
    assert.equal(T.formatInt(0), "0");
    assert.equal(T.formatInt(999), "999");
    assert.equal(T.formatInt(1234), "1 234");
    assert.equal(T.formatInt(1234567), "1 234 567");
    assert.equal(T.formatInt(-6979), "-6 979");
    assert.equal(T.formatInt(2.6), "3");
    assert.equal(T.formatInt(NaN), "0");
  });

  test("money, percent and signed values", () => {
    assert.equal(T.formatMoney(1500), "1 500 $");
    assert.equal(T.formatPercent(45), "45 %");
    assert.equal(T.formatSigned(5), "+5");
    assert.equal(T.formatSigned(-3), "-3");
    assert.equal(T.formatSigned(0), "0");
  });

  test("class and problem labels", () => {
    assert.equal(T.classLabel(0), "Village");
    assert.equal(T.classLabel(5), "Mégalopole");
    assert.equal(T.classLabel(9), "Inconnue");
    assert.equal(T.problemLabel(0), "Criminalité");
    assert.equal(T.problemLabel(6), "Incendies");
    assert.equal(T.problemLabel(7), "");
  });
});

describe("decoding the wasm layouts", () => {
  const budget = [7, 73757, 233, -3302, 21, 0, 2735, 400, 400, 2735, 400, 400, 100, 50, 0, 1, 2, 3];

  test("budget layout", () => {
    const b = T.decodeBudget(budget);
    assert.equal(b.taxRate, 7);
    assert.equal(b.funds, 73757);
    assert.equal(b.cashFlow, -3302);
    assert.equal(b.autoBudget, false);
    assert.deepEqual(b.fund, { road: 2735, fire: 400, police: 400 });
    assert.deepEqual(b.percent, { road: 100, fire: 50, police: 0 });
    assert.deepEqual(b.effect, { road: 1, fire: 2, police: 3 });
  });

  test("department line text", () => {
    const b = T.decodeBudget(budget);
    const line = T.departmentLine(b, T.DEPARTMENTS[1]);
    assert.equal(line.key, "fire");
    assert.equal(line.percent, 50);
    assert.equal(
      line.text,
      "Pompiers : 50 % financé, 400 $ sur 400 $ demandés",
    );
  });

  test("evaluation layout drops empty problem slots", () => {
    const e = T.decodeEvaluation([652, -91, 3, 209620, -4000, 12000000, 63, 0, 45, 3, 20, -1, 0, -1, 0]);
    assert.equal(e.score, 652);
    assert.equal(e.className, "Capitale");
    assert.equal(e.yesPercent, 63);
    assert.deepEqual(e.problems, [
      { kind: 0, label: "Criminalité", votes: 45 },
      { kind: 3, label: "Impôts", votes: 20 },
    ]);
    assert.equal(T.scoreText(e), "Score : 652 sur 1 000 (-91). Classe : Capitale.");
  });

  test("tax text gives the estimate, the value per point and the last collection", () => {
    assert.equal(
      T.taxText(9, 1800, 1500),
      "Taux 9 % : recettes estimées 1\u202f800\u00a0$ par collecte, soit environ 200\u00a0$ par point d'impôt. Dernière collecte : 1\u202f500\u00a0$.",
    );
    assert.match(T.taxText(0, 0, 0), /^Taux 0 % : recettes estimées 0\u00a0\$ par collecte\. /);
  });
});

describe("chart math", () => {
  test("bounds contain every value and never collapse", () => {
    assert.deepEqual(T.chartBounds([[1, 5], [-2, 3]]), { min: -2, max: 5 });
    assert.deepEqual(T.chartBounds([[4, 4, 4]]), { min: 3, max: 5 });
    assert.deepEqual(T.chartBounds([[]]), { min: 0, max: 1 });
  });

  test("axis ticks are round and cover the range", () => {
    assert.deepEqual(T.axisTicks(0, 100, 4), [0, 50, 100]);
    const t = T.axisTicks(-3, 97, 4);
    assert.ok(t[0] >= -3 && t[t.length - 1] <= 97);
    for (let i = 1; i < t.length; i++) assert.ok(Math.abs(t[i] - t[i - 1] - (t[1] - t[0])) < 1e-9);
    assert.ok(t.every((v) => Number.isInteger(v)));
    assert.deepEqual(T.axisTicks(0, 0.3, 3), [0, 0.1, 0.2, 0.3]);
  });

  test("line points map the first and last values to the box edges", () => {
    const box = { x: 10, y: 20, w: 100, h: 50 };
    const pts = T.linePoints([0, 5, 10], box, { min: 0, max: 10 });
    assert.deepEqual(pts[0], [10, 70]);
    assert.deepEqual(pts[1], [60, 45]);
    assert.deepEqual(pts[2], [110, 20]);
    assert.deepEqual(T.linePoints([3], box, { min: 0, max: 10 }), [[10, 70 - (3 / 10) * 50]]);
  });

  test("history summary", () => {
    assert.deepEqual(T.historySummary([3, 9, -1, 4]), { first: 3, last: 4, min: -1, max: 9 });
    assert.deepEqual(T.historySummary([]), { first: 0, last: 0, min: 0, max: 0 });
  });

  test("chart definitions cover the histories the page shows", () => {
    const kinds = T.CHARTS.flatMap((c) => c.series.map((s) => s.kind)).sort();
    assert.deepEqual(kinds, [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(T.HISTORY_SCALES.map((s) => s.id), [0, 1]);
  });
});
