// Tests of the pure challenges model (web/challenges-model.js): the table, the snapshot reader on engines with and
// without the optional methods, the verdict of every challenge (won, lost, running), the deadlines, the once-a-month
// rule, the best results (parse, rank, record) and the French texts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CHALLENGES, RESULTS, MAX_CHALLENGES, MAX_CONDITIONS, STORAGE_KEY, POLLUTION_MAX, METRICS,
  readSnapshot, readMonthIndex, isAvailable, conditionMet, conditionsMet, elapsedMonths, deadlineMonths, evaluate, isDue,
  parseBest, serializeBest, isBetter, recordResult, durationText, goalText, progressLines, remainingText, resultText,
  bestText,
} from "../challenges-model.js";
import { MockCity } from "./mock-engine.mjs";

const byId = (id) => CHALLENGES.find((c) => c.id === id);

// A snapshot that meets every condition of the challenge (just on the right side of each target).
function meeting(c, monthIndex) {
  const s = { monthIndex };
  for (const k of c.conditions) s[k.metric] = k.op.startsWith(">") ? k.target + 1 : k.target - 1;
  return s;
}

// A snapshot that breaks the first condition of the challenge.
function breaking(c, monthIndex) {
  const s = meeting(c, monthIndex);
  const k = c.conditions[0];
  s[k.metric] = k.op.startsWith(">") ? k.target - 1 : k.target + 1;
  return s;
}

describe("the table", () => {
  test("has at least six challenges, frozen, with unique ids, a start, a kind and a deadline", () => {
    assert.ok(CHALLENGES.length >= 6);
    assert.ok(CHALLENGES.length <= MAX_CHALLENGES);
    assert.ok(Object.isFrozen(CHALLENGES));
    assert.equal(new Set(CHALLENGES.map((c) => c.id)).size, CHALLENGES.length);
    for (const c of CHALLENGES) {
      assert.ok(Object.isFrozen(c) && Object.isFrozen(c.conditions), c.id);
      assert.ok(c.title.length > 0);
      assert.ok(("sample" in c.start) !== ("seed" in c.start), `${c.id}: a sample or a seed`);
      assert.ok(["reach", "hold"].includes(c.kind));
      assert.ok(Number.isInteger(c.deadline) && c.deadline > 0);
      assert.ok(c.conditions.length >= 1 && c.conditions.length <= MAX_CONDITIONS);
      for (const k of c.conditions) assert.ok(k.metric in METRICS, `${c.id}: ${k.metric}`);
    }
  });
});

describe("the snapshot", () => {
  test("reads the base methods of an engine", () => {
    const s = readSnapshot(new MockCity(1));
    assert.equal(s.population, 0);
    assert.equal(s.funds, 20000);
    assert.equal(s.monthIndex, 1900 * 12);
    assert.equal(s.approval, null); // the mock has no evaluation()
    assert.equal(s.pollution, null);
    assert.equal(s.rewards, null);
    assert.equal(s.powerBalance, null);
  });

  test("reads the extended rules when the engine has them", () => {
    const s = readSnapshot(new MockCity(1, { energy: true, rewards: true }));
    assert.equal(typeof s.rewards, "number");
    assert.equal(s.powerBalance, 0); // energy rules off: six zeros
  });

  test("reads evaluation, score and pollution history", () => {
    const city = {
      year: () => 1950, month: () => 3, population: () => 10, funds: () => 5, score: () => 400,
      evaluation: () => [700, 0, 1, 10, 0, 0, 65],
      history: (kind, scale) => (kind === 5 && scale === 0 ? [1, 2, 3, 999] : []),
      reward_stats: () => [72, 0, 4, 1],
      energy_stats: () => [100, 120, 0, 1, 0, 0],
    };
    const s = readSnapshot(city);
    assert.deepEqual(
      [s.monthIndex, s.score, s.approval, s.pollution, s.rewards, s.powerBalance],
      [1950 * 12 + 3, 700, 65, POLLUTION_MAX, 4, -20],
    );
  });

  test("uses score() when evaluation() is missing, and survives a bare object", () => {
    assert.equal(readSnapshot({ score: () => 321 }).score, 321);
    const bare = readSnapshot({});
    assert.equal(bare.monthIndex, null);
    assert.equal(bare.population, null);
    assert.equal(readMonthIndex({}), null);
    assert.equal(readMonthIndex({ year: () => 2000 }), 24000);
  });

  test("a NaN reading counts as missing", () => {
    assert.equal(readSnapshot({ population: () => NaN }).population, null);
  });

  test("isAvailable needs the methods of requires", () => {
    assert.equal(isAvailable(byId("all-rewards"), new MockCity(1)), false);
    assert.equal(isAvailable(byId("all-rewards"), new MockCity(1, { rewards: true })), true);
    assert.equal(isAvailable(byId("first-year"), {}), true);
  });
});

describe("conditions", () => {
  test("operators and missing metrics", () => {
    assert.equal(conditionMet({ metric: "funds", op: ">", target: 0 }, { funds: 1 }), true);
    assert.equal(conditionMet({ metric: "funds", op: ">", target: 0 }, { funds: 0 }), false);
    assert.equal(conditionMet({ metric: "funds", op: ">=", target: 0 }, { funds: 0 }), true);
    assert.equal(conditionMet({ metric: "pollution", op: "<=", target: 30 }, { pollution: 30 }), true);
    assert.equal(conditionMet({ metric: "pollution", op: "<", target: 30 }, { pollution: 30 }), false);
    assert.equal(conditionMet({ metric: "pollution", op: "<=", target: 30 }, { pollution: null }), false);
    assert.equal(conditionMet({ metric: "pollution", op: "<=", target: 30 }, undefined), false);
  });

  test("all conditions must hold", () => {
    const c = byId("clean-air");
    assert.equal(conditionsMet(c, { pollution: 10, population: 70000 }), true);
    assert.equal(conditionsMet(c, { pollution: 10, population: 100 }), false);
    assert.equal(conditionsMet(c, { pollution: 40, population: 70000 }), false);
  });
});

describe("elapsed time and the deadline", () => {
  test("elapsedMonths", () => {
    assert.equal(elapsedMonths({ monthIndex: 100 }, { monthIndex: 112 }), 12);
    assert.equal(elapsedMonths({ monthIndex: 100 }, { monthIndex: 90 }), 0);
    assert.equal(elapsedMonths({ monthIndex: null }, { monthIndex: 90 }), 0);
    assert.equal(elapsedMonths(undefined, undefined), 0);
  });

  test("deadlineMonths is the deadline in years times twelve", () => {
    assert.equal(deadlineMonths(byId("first-year")), 12);
    assert.equal(deadlineMonths(byId("treasury-20")), 240);
  });
});

describe("every challenge: won, lost, running", () => {
  for (const c of CHALLENGES) {
    const start = { monthIndex: 24000 };
    const last = start.monthIndex + deadlineMonths(c);
    const early = start.monthIndex + 1;

    test(`${c.id}: running before the deadline`, () => {
      const snap = c.kind === "hold" ? meeting(c, early) : breaking(c, early);
      assert.equal(evaluate(c, start, snap), RESULTS.RUNNING);
    });

    if (c.kind === "reach") {
      test(`${c.id}: won as soon as the conditions hold`, () => {
        assert.equal(evaluate(c, start, meeting(c, early)), RESULTS.WON);
        assert.equal(evaluate(c, start, meeting(c, last)), RESULTS.WON, "also at the deadline");
      });
      test(`${c.id}: lost at the deadline without the conditions, running one month before`, () => {
        assert.equal(evaluate(c, start, breaking(c, last)), RESULTS.LOST);
        assert.equal(evaluate(c, start, breaking(c, last - 1)), RESULTS.RUNNING);
      });
    } else {
      test(`${c.id}: lost as soon as a condition breaks`, () => {
        assert.equal(evaluate(c, start, breaking(c, early)), RESULTS.LOST);
        assert.equal(evaluate(c, start, breaking(c, last)), RESULTS.LOST);
      });
      test(`${c.id}: won at the deadline with the conditions still true`, () => {
        assert.equal(evaluate(c, start, meeting(c, last)), RESULTS.WON);
        assert.equal(evaluate(c, start, meeting(c, last - 1)), RESULTS.RUNNING);
      });
    }

    test(`${c.id}: a missing metric never wins`, () => {
      const snap = { monthIndex: early };
      assert.notEqual(evaluate(c, start, snap), RESULTS.WON);
    });
  }
});

describe("once a month", () => {
  test("isDue", () => {
    assert.equal(isDue(null, { monthIndex: 5 }), true);
    assert.equal(isDue(undefined, { monthIndex: 5 }), true);
    assert.equal(isDue(5, { monthIndex: 5 }), false);
    assert.equal(isDue(5, { monthIndex: 6 }), true);
    assert.equal(isDue(5, { monthIndex: null }), false);
    assert.equal(isDue(5, undefined), false);
  });
});

describe("best results", () => {
  test("parseBest keeps good entries of known ids only", () => {
    const text = JSON.stringify({
      "first-year": { result: "won", months: 12 },
      "pop-50000": { result: "lost", months: 3 },
      unknown: { result: "won", months: 1 },
      "clean-air": { result: "won", months: -1 },
      "new-town": { result: "maybe", months: 1 },
      "treasury-20": "won",
    });
    assert.deepEqual(parseBest(text), {
      "first-year": { result: "won", months: 12 },
      "pop-50000": { result: "lost", months: 3 },
    });
  });

  test("parseBest survives bad text", () => {
    for (const bad of ["", "{", "null", "[]", "12", '"x"', undefined]) assert.deepEqual(parseBest(bad), {});
  });

  test("parseBest keeps at most MAX_CHALLENGES entries", () => {
    const raw = {};
    for (let i = 0; i < 100; i++) raw[`x${i}`] = { result: "won", months: 1 };
    assert.deepEqual(parseBest(JSON.stringify(raw)), {}); // unknown ids, bounded read
  });

  test("serialize then parse is the identity", () => {
    const best = { "first-year": { result: "won", months: 12 } };
    assert.deepEqual(parseBest(serializeBest(best)), best);
    assert.equal(typeof STORAGE_KEY, "string");
  });

  test("isBetter: a win beats a loss, a faster win beats a slower, a longer loss beats a shorter", () => {
    const w = (m) => ({ result: "won", months: m });
    const l = (m) => ({ result: "lost", months: m });
    assert.equal(isBetter(w(50), undefined), true);
    assert.equal(isBetter(w(50), l(10)), true);
    assert.equal(isBetter(l(10), w(50)), false);
    assert.equal(isBetter(w(10), w(20)), true);
    assert.equal(isBetter(w(20), w(10)), false);
    assert.equal(isBetter(w(10), w(10)), false);
    assert.equal(isBetter(l(20), l(10)), true);
    assert.equal(isBetter(l(10), l(20)), false);
  });

  test("recordResult adds, improves, keeps, ignores running, and never mutates", () => {
    const empty = {};
    const a = recordResult(empty, "first-year", "lost", 4);
    assert.deepEqual(empty, {});
    assert.deepEqual(a, { "first-year": { result: "lost", months: 4 } });
    const b = recordResult(a, "first-year", "won", 12.7);
    assert.deepEqual(b, { "first-year": { result: "won", months: 12 } });
    assert.equal(recordResult(b, "first-year", "lost", 99), b);
    assert.equal(recordResult(b, "first-year", "running", 1), b);
    assert.equal(recordResult(b, "first-year", "won", 20), b);
    assert.deepEqual(recordResult(b, "first-year", "won", 6)["first-year"].months, 6);
  });
});

describe("French texts", () => {
  test("durationText", () => {
    assert.equal(durationText(0), "0 mois");
    assert.equal(durationText(1), "1 mois");
    assert.equal(durationText(12), "1 an");
    assert.equal(durationText(25), "2 ans et 1 mois");
    assert.equal(durationText(-5), "0 mois");
  });

  test("goal, progress, remaining time, results, best", () => {
    const c = byId("clean-air");
    assert.match(goalText(c), /Pollution moyenne : au plus 30 ; Population : au moins 60\s?000, en 15 ans au plus/u);
    assert.match(goalText(byId("first-year")), /pendant 1 an$/u);
    assert.deepEqual(progressLines(c, { pollution: 41, population: null }), [
      "Pollution moyenne : 41", "Population : inconnu",
    ]);
    assert.equal(remainingText(byId("first-year"), { monthIndex: 0 }, { monthIndex: 5 }), "Il reste 7 mois.");
    assert.match(resultText(c, RESULTS.WON, 30), /^Défi gagné : « Pollution moyenne sous 30 » en 2 ans et 6 mois\.$/u);
    assert.match(resultText(c, RESULTS.LOST, 180), /délai est dépassé/u);
    assert.match(resultText(byId("first-year"), RESULTS.LOST, 3), /n'a pas tenu/u);
    assert.equal(bestText(undefined), "Pas encore tenté");
    assert.equal(bestText({ result: "won", months: 12 }), "Meilleur : gagné en 1 an");
    assert.equal(bestText({ result: "lost", months: 2 }), "Déjà tenté : perdu");
  });
});
