// Unit tests of the advisors' pure model (web/advisors-model.js) and of the snapshot reader.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as M from "../advisors-model.js";
import { readSnapshot } from "../advisors.js";
import { MockCity } from "./mock-engine.mjs";

const calm = () => ({
  funds: 50000, cashFlow: 500, taxRate: 7,
  funding: { road: 100, fire: 100, police: 100 },
  problems: [], demand: { res: 100, com: 100, ind: 100 },
  population: 1000, populationDelta: 20,
  moneyHistory: [128, 128, 130], pollutionHistory: [10, 10, 10],
});
const get = (list, id) => list.find((a) => a.id === id);
const sev = (snap, id) => get(M.advise(snap), id).severity;

describe("shape", () => {
  test("a calm city: four advisors, all ok, French text, an action each", () => {
    const list = M.advise(calm());
    assert.deepEqual(list.map((a) => a.id), ["finances", "security", "planning", "environment"]);
    for (const a of list) {
      assert.equal(a.severity, "ok");
      assert.ok(a.title && a.diagnosis.endsWith(".") && a.action.endsWith("."), a.id);
    }
  });
  test("deterministic", () => {
    assert.deepEqual(M.advise(calm()), M.advise(calm()));
  });
  test("total: any input gives an array, nothing throws", () => {
    for (const bad of [undefined, null, 5, "x", [], {}, { funds: NaN, problems: "x", demand: 3, funding: null }]) {
      assert.ok(Array.isArray(M.advise(bad)));
    }
    assert.deepEqual(M.advise(null), []);
  });
});

describe("finances", () => {
  test("funds thresholds", () => {
    const s = calm();
    s.funds = M.FUNDS_URGENT; assert.equal(sev(s, "finances"), "urgent");
    s.funds = M.FUNDS_URGENT + 1; assert.equal(sev(s, "finances"), "attention");
    s.funds = M.FUNDS_LOW - 1; assert.equal(sev(s, "finances"), "attention");
    s.funds = M.FUNDS_LOW; assert.equal(sev(s, "finances"), "ok");
  });
  test("negative cash flow: attention, urgent when funds cannot cover the runway", () => {
    const s = calm();
    s.funds = 10000;
    s.cashFlow = -100; assert.equal(sev(s, "finances"), "attention");
    s.cashFlow = -s.funds / M.CASH_RUNWAY; // exactly covered
    assert.equal(sev(s, "finances"), "attention");
    s.cashFlow = -s.funds / M.CASH_RUNWAY - 1; // one dollar short
    assert.equal(sev(s, "finances"), "urgent");
  });
  test("a falling money history is attention", () => {
    const s = calm();
    s.moneyHistory = [140, 139, 138, 132];
    assert.equal(sev(s, "finances"), "attention");
    s.moneyHistory = [140, 139, 138, 133]; // drop of 7 < MONEY_DROP
    assert.equal(sev(s, "finances"), "ok");
  });
  test("the money trend only looks at the last window", () => {
    const old = Array.from({ length: 30 }, (_, i) => 200 - i * 3);
    assert.equal(M.trend([...old, ...new Array(M.MONEY_WINDOW).fill(100)]), 0);
    assert.equal(M.trend([1]), null);
  });
  test("tax complaints; the action raises the tax when it is low", () => {
    const s = calm();
    s.problems = [{ kind: M.PROBLEM.TAXES, votes: M.VOTES_ATTENTION }];
    assert.equal(sev(s, "finances"), "attention");
    s.problems = [{ kind: M.PROBLEM.TAXES, votes: M.VOTES_URGENT }];
    assert.equal(sev(s, "finances"), "urgent");
    const t = calm(); t.cashFlow = -10; t.taxRate = 7;
    assert.match(get(M.advise(t), "finances").action, /Relevez les impôts à 9 %/);
    t.taxRate = 19; assert.doesNotMatch(get(M.advise(t), "finances").action, /Relevez/);
  });
  test("hidden without funds, cash flow or problem list", () => {
    assert.equal(get(M.advise({ demand: { res: 0, com: 0, ind: 0 } }), "finances"), undefined);
  });
});

describe("security", () => {
  test("police and fire funding thresholds", () => {
    for (const key of ["police", "fire"]) {
      const s = calm();
      s.funding[key] = M.FUNDING_LOW; assert.equal(sev(s, "security"), "ok");
      s.funding[key] = M.FUNDING_LOW - 1; assert.equal(sev(s, "security"), "attention");
      s.funding[key] = M.FUNDING_VERY_LOW; assert.equal(sev(s, "security"), "attention");
      s.funding[key] = M.FUNDING_VERY_LOW - 1; assert.equal(sev(s, "security"), "urgent");
    }
  });
  test("crime and fire problems by votes", () => {
    for (const kind of [M.PROBLEM.CRIME, M.PROBLEM.FIRE]) {
      const s = calm();
      s.problems = [{ kind, votes: M.VOTES_ATTENTION - 1 }]; assert.equal(sev(s, "security"), "ok");
      s.problems = [{ kind, votes: M.VOTES_ATTENTION }]; assert.equal(sev(s, "security"), "attention");
      s.problems = [{ kind, votes: M.VOTES_URGENT }]; assert.equal(sev(s, "security"), "urgent");
    }
  });
  test("the worst finding sets the severity", () => {
    const s = calm();
    s.funding.police = 10; s.problems = [{ kind: M.PROBLEM.FIRE, votes: 20 }];
    const a = get(M.advise(s), "security");
    assert.equal(a.severity, "urgent");
    assert.match(a.diagnosis, /Police/);
  });
  test("hidden with neither funding nor problems", () => {
    assert.equal(get(M.advise({ funds: 10 }), "security"), undefined);
  });
});

describe("planning", () => {
  test("tax rate thresholds", () => {
    const s = calm();
    s.taxRate = M.TAX_HIGH - 1; assert.equal(sev(s, "planning"), "ok");
    s.taxRate = M.TAX_HIGH; assert.equal(sev(s, "planning"), "attention");
    s.taxRate = M.TAX_VERY_HIGH - 1; assert.equal(sev(s, "planning"), "attention");
    s.taxRate = M.TAX_VERY_HIGH; assert.equal(sev(s, "planning"), "urgent");
    assert.match(get(M.advise(s), "planning").diagnosis, /16 %/);
  });
  test("housing, traffic and unemployment problems", () => {
    for (const kind of [M.PROBLEM.HOUSING, M.PROBLEM.TRAFFIC, M.PROBLEM.UNEMPLOYMENT]) {
      const s = calm();
      s.problems = [{ kind, votes: M.VOTES_ATTENTION }]; assert.equal(sev(s, "planning"), "attention");
      s.problems = [{ kind, votes: M.VOTES_URGENT }]; assert.equal(sev(s, "planning"), "urgent");
    }
  });
  test("road funding", () => {
    const s = calm();
    s.funding.road = 10;
    assert.equal(sev(s, "planning"), "urgent");
  });
  test("population falling beyond POP_FALL_RATIO", () => {
    const s = calm();
    s.populationDelta = -Math.floor(M.POP_FALL_RATIO * s.population); // not below the limit
    assert.equal(sev(s, "planning"), "ok");
    s.populationDelta = -Math.ceil(M.POP_FALL_RATIO * s.population) - 1;
    assert.equal(sev(s, "planning"), "attention");
    s.population = 0; s.populationDelta = -5;
    assert.equal(sev(s, "planning"), "ok");
  });
  test("demand: all stalled is attention, strong demand is named", () => {
    const s = calm();
    s.demand = { res: M.DEMAND_LOW, com: M.DEMAND_LOW, ind: M.DEMAND_LOW };
    assert.equal(sev(s, "planning"), "attention");
    s.demand = { res: M.DEMAND_LOW, com: M.DEMAND_LOW + 1, ind: M.DEMAND_LOW };
    assert.equal(sev(s, "planning"), "ok");
    s.demand = { res: M.DEMAND_HIGH, com: 0, ind: M.DEMAND_HIGH };
    const a = get(M.advise(s), "planning");
    assert.match(a.diagnosis, /résidentiel, industriel/);
    assert.match(a.action, /résidentiel/);
    s.demand = { res: M.DEMAND_HIGH - 1, com: 0, ind: 0 };
    assert.match(get(M.advise(s), "planning").diagnosis, /suit son cours/);
  });
});

describe("environment", () => {
  test("pollution votes", () => {
    const s = calm();
    s.problems = [{ kind: M.PROBLEM.POLLUTION, votes: M.VOTES_ATTENTION - 1 }]; assert.equal(sev(s, "environment"), "ok");
    s.problems = [{ kind: M.PROBLEM.POLLUTION, votes: M.VOTES_ATTENTION }]; assert.equal(sev(s, "environment"), "attention");
    s.problems = [{ kind: M.PROBLEM.POLLUTION, votes: M.VOTES_URGENT }]; assert.equal(sev(s, "environment"), "urgent");
  });
  test("pollution history rising", () => {
    const s = calm();
    s.pollutionHistory = [10, 12, 10 + M.POLLUTION_RISE - 1]; assert.equal(sev(s, "environment"), "ok");
    s.pollutionHistory = [10, 12, 10 + M.POLLUTION_RISE]; assert.equal(sev(s, "environment"), "attention");
  });
  test("hidden without problems list or history", () => {
    assert.equal(get(M.advise({ funds: 1 }), "environment"), undefined);
  });
});

describe("ordering", () => {
  test("urgent first, then attention, then ok; ties keep the fixed order", () => {
    const s = calm();
    s.taxRate = 18; // planning urgent
    s.funding.police = 40; // security attention
    const list = M.advise(s);
    assert.deepEqual(list.map((a) => a.id), ["planning", "security", "finances", "environment"]);
    s.funds = 10; // finances urgent too: finances before planning
    assert.deepEqual(M.advise(s).slice(0, 2).map((a) => a.id), ["finances", "planning"]);
  });
});

describe("snapshot reader on engines with missing methods", () => {
  test("the mock engine (no budget, evaluation or history) gives a partial, safe snapshot", () => {
    const snap = readSnapshot(new MockCity(1));
    assert.ok(typeof snap.funds === "number");
    assert.deepEqual(snap.demand, { res: 0, com: 0, ind: 0 });
    assert.equal(snap.funding, undefined);
    const ids = M.advise(snap).map((a) => a.id);
    assert.deepEqual(ids.sort(), ["finances", "planning"]);
  });
  test("an object with nothing, or throwing-free nulls", () => {
    assert.deepEqual(readSnapshot({}), {});
    assert.deepEqual(readSnapshot(null), {});
  });
  test("decodes the wasm layouts", () => {
    const city = {
      budget: () => [7, 73757, 233, -3302, 21, 0, 2735, 400, 400, 2735, 400, 400, 100, 50, 0, 1, 2, 3],
      evaluation: () => [500, 10, 2, 5000, -300, 1000, 40, 0, 30, 3, 12, -1, 0, -1, 0],
      demand: () => [600, -20, 5],
      history: (kind) => (kind === 3 ? [130, 120] : [5, 5]),
    };
    const s = readSnapshot(city);
    assert.equal(s.taxRate, 7);
    assert.equal(s.cashFlow, -3302);
    assert.deepEqual(s.funding, { road: 100, fire: 50, police: 0 });
    assert.deepEqual(s.problems.map((p) => [p.kind, p.votes]), [[0, 30], [3, 12]]);
    assert.equal(s.populationDelta, -300);
    assert.deepEqual(s.moneyHistory, [130, 120]);
    const list = M.advise(s);
    assert.equal(get(list, "security").severity, "urgent"); // police 0 %
    assert.equal(get(list, "planning").severity, "attention"); // population -300 < -2 % of 5000
  });
});
