// The environment advisor and the waste rule (web/advisors.js reader, cheapKey; advisors-model.js findings):
// the rule off reads nothing, the findings reach the environment advisor, and the mock feeds them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as M from "../advisors-model.js";
import { WASTE_URGENT } from "../waste-model.js";
import { readSnapshot, cheapKey } from "../advisors.js";
import { MockCity } from "./mock-engine.mjs";

const plain = (t) => t.replace(/[\s  ]/g, " ");
const calm = () => ({
  funds: 50000, cashFlow: 500, taxRate: 7,
  funding: { road: 100, fire: 100, police: 100 },
  problems: [], demand: { res: 100, com: 100, ind: 100 },
  population: 1000, populationDelta: 20, moneyHistory: [128, 128, 130], pollutionHistory: [10, 10, 10],
});
const env = (s) => {
  const a = M.advise(s).find((x) => x.id === "environment");
  return a && { ...a, diagnosis: plain(a.diagnosis), action: plain(a.action) };
};
const wasteOn = (accumulated, landfillLeft = 100, landfills = 0) => ({
  ...calm(), rules: { waste: true }, waste: { accumulated, landfillLeft, landfills },
});

/** A fake engine for the reader: the waste rule, the waste_stats answer and the placed buildings. */
function wasteCity({ rule = true, stats = [0, 0, 0, 0, 0, 0, 0], records = [], withStats = true } = {}) {
  const calls = [];
  const city = {
    rule,
    waste_rules: () => (calls.push("waste_rules"), city.rule),
    waste_stats: () => (calls.push("waste_stats"), Int32Array.from(stats)),
    structures: () => (calls.push("structures"), Int32Array.from(records)),
  };
  if (!withStats) delete city.waste_stats;
  return { city, calls };
}

describe("environment advice from the waste", () => {
  test("garbage on the map: attention, urgent from 500, the remedy named", () => {
    const low = env(wasteOn(10));
    assert.equal(low.severity, "attention");
    assert.match(low.diagnosis, /^Les ordures non ramassées s'accumulent : 10 sur la carte\./);
    assert.equal(low.action, "Construisez une décharge, un incinérateur ou un centre de recyclage.");
    assert.equal(env(wasteOn(WASTE_URGENT - 1)).severity, "attention");
    assert.equal(env(wasteOn(WASTE_URGENT)).severity, "urgent");
  });

  test("full landfills are attention with the words of the page", () => {
    const a = env(wasteOn(0, 0, 1));
    assert.equal(a.severity, "attention");
    assert.match(a.diagnosis, /^Les décharges sont pleines\./);
  });

  test("no landfill built: a full landfill room is not news", () => {
    assert.equal(env(wasteOn(0, 0, 0)).severity, "ok");
  });

  test("the rule off: the environment ignores the waste even with garbage in the snapshot", () => {
    const s = { ...calm(), rules: { waste: false }, waste: { accumulated: 900, landfillLeft: 0, landfills: 2 } };
    assert.equal(env(s).severity, "ok");
    assert.equal(env({ ...calm(), waste: { accumulated: 900 } }).severity, "ok");
  });

  test("the waste is worse than a calm pollution: the urgent one leads the environment advisor", () => {
    const s = { ...wasteOn(600), problems: [{ kind: 1, votes: 5 }] };
    assert.equal(env(s).severity, "urgent");
  });

  test("with the waste findings and no pollution data, the environment advisor still speaks", () => {
    const s = { funds: 1, rules: { waste: true }, waste: { accumulated: 5, landfillLeft: 0, landfills: 0 } };
    assert.equal(env(s).severity, "attention");
  });

  test("with no pollution data and no waste the environment advisor is absent", () => {
    assert.equal(env({ funds: 1 }), undefined);
  });
});

describe("snapshot reader for the waste", () => {
  test("rule on: waste_stats and the buildings are read, the block is decoded", () => {
    const { city, calls } = wasteCity({ stats: [1, 2, 3, 4, 250, 60, 7], records: [20, 1, 1, 3, 3, 0, 21, 5, 5, 2, 2, 0] });
    const s = readSnapshot(city);
    assert.deepEqual(s.waste, { accumulated: 250, landfillLeft: 60, landfills: 1 });
    assert.ok(calls.includes("waste_stats"));
    assert.ok(calls.includes("structures"));
  });

  test("rule off: waste_stats and structures are never called, and no block", () => {
    const { city, calls } = wasteCity({ rule: false });
    assert.equal(readSnapshot(city).waste, undefined);
    cheapKey(city);
    assert.equal(calls.includes("waste_stats"), false);
  });

  test("no waste_stats method: no block", () => {
    const { city } = wasteCity({ withStats: false });
    assert.equal(readSnapshot(city).waste, undefined);
  });

  test("the rule is an entry of the snapshot's rules, read like the others", () => {
    const { city } = wasteCity();
    assert.equal(readSnapshot(city).rules.waste, true);
  });
});

describe("cheap key for the waste", () => {
  test("changes with the garbage on the map (index 4), the landfill room (index 5) and the landfills", () => {
    const base = cheapKey(wasteCity({ stats: [0, 0, 0, 0, 10, 0, 0] }).city);
    assert.notEqual(base, cheapKey(wasteCity({ stats: [0, 0, 0, 0, 11, 0, 0] }).city));
    assert.notEqual(base, cheapKey(wasteCity({ stats: [0, 0, 0, 0, 10, 1, 0] }).city));
    assert.notEqual(base, cheapKey(wasteCity({ stats: [0, 0, 0, 0, 10, 0, 0], records: [20, 0, 0, 3, 3, 0] }).city));
    assert.equal(base, cheapKey(wasteCity({ stats: [0, 0, 0, 0, 10, 0, 0] }).city), "stable when nothing changes");
  });

  test("the flow numbers (indexes 0-3 and 6) do not move the key", () => {
    const base = cheapKey(wasteCity({ stats: [0, 0, 0, 0, 10, 0, 0] }).city);
    assert.equal(cheapKey(wasteCity({ stats: [9, 9, 9, 9, 10, 0, 9] }).city), base);
  });

  test("with the rule off the waste is ignored", () => {
    const a = cheapKey(wasteCity({ rule: false, stats: [0, 0, 0, 0, 1, 0, 0] }).city);
    const b = cheapKey(wasteCity({ rule: false, stats: [0, 0, 0, 0, 9, 0, 0] }).city);
    assert.equal(a, b);
  });
});

describe("the mock engine feeds the waste rows and the advisor", () => {
  test("a landfill placed with the waste rule on, and garbage left: the advice is read from the mock", () => {
    const city = new MockCity(1, { structures: true, waste: true, rubble: 0 });
    city.set_waste_rules(true);
    city.set_structure_rules(true);
    city.set_mock_waste([100, 40, 0, 0, 800, 0, 0]);
    assert.equal(city.place_structure(20, 20, 20), 1);
    const s = readSnapshot(city);
    assert.deepEqual(s.waste, { accumulated: 800, landfillLeft: 0, landfills: 1 });
    const a = M.advise(s).find((x) => x.id === "environment");
    assert.equal(a.severity, "urgent");
    assert.match(plain(a.diagnosis), /800 sur la carte/);
  });

  test("the mock with the rule off: no block, no finding", () => {
    const city = new MockCity(1, { structures: true, waste: true, rubble: 0 });
    city.set_mock_waste([0, 0, 0, 0, 900, 0, 0]);
    assert.equal(readSnapshot(city).waste, undefined);
    assert.equal(M.advise(readSnapshot(city)).find((x) => x.id === "environment")?.severity ?? "ok", "ok");
  });
});
