// Energy advice (web/advisors-energy.js): the deficit is urgent, the plants past 80 % of their life are attention, the
// numbers come from the energy block of the snapshot (read with the rule only), and the cheap key follows the statistics.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as E from "../advisors-energy.js";
import * as M from "../advisors-model.js";
import { readSnapshot, cheapKey } from "../advisors.js";
import { MockCity } from "./mock-engine.mjs";

// A calm city (no complaint anywhere) with the energy rule on and the given energy block.
const withEnergy = (energy, rules = { energy: true }) => ({
  funds: 50000, cashFlow: 500, taxRate: 7, funding: { road: 100, fire: 100, police: 100 },
  problems: [], demand: { res: 100, com: 100, ind: 100 }, population: 1000, populationDelta: 20,
  moneyHistory: [128, 128, 130], pollutionHistory: [10, 10, 10],
  rules, energy,
});
const calmEnergy = { production: 1000, consumption: 900, endOfLife: 0 };

describe("thresholds and texts", () => {
  test("the severities and the actions", () => {
    assert.equal(E.ENERGY_DEFICIT_SEVERITY, "urgent");
    assert.equal(E.ENERGY_AGING_SEVERITY, "attention");
    assert.match(E.DEFICIT_ACTION, /centrale ou achetez de l'électricité/);
    assert.match(E.AGING_ACTION, /fin de vie/);
  });
});

describe("energyOf", () => {
  test("the numbers with the rule on; null with the rule off, without a block, or with a bad block", () => {
    assert.deepEqual(E.energyOf(withEnergy({ production: 5, consumption: 3, endOfLife: 1 })), { production: 5, consumption: 3, endOfLife: 1 });
    assert.equal(E.energyOf(withEnergy(calmEnergy, { energy: false })), null);
    assert.equal(E.energyOf(withEnergy(calmEnergy, {})), null);
    assert.equal(E.energyOf({ rules: { energy: true } }), null, "no block");
    assert.equal(E.energyOf(withEnergy(3)), null, "not an object");
  });

  test("a missing or garbage number reads as 0", () => {
    assert.deepEqual(E.energyOf(withEnergy({ production: "x", consumption: -4, endOfLife: null })), { production: 0, consumption: 0, endOfLife: 0 });
  });
});

describe("the deficit", () => {
  test("consumption above production is urgent, with both numbers in the diagnosis", () => {
    const f = E.deficitFinding({ production: 900, consumption: 1200, endOfLife: 0 });
    assert.equal(f.severity, "urgent");
    assert.match(f.diagnosis, /^Il manque de l'électricité : consommation 1[\s  ]200, production 900\.$/);
    assert.equal(f.action, E.DEFICIT_ACTION);
  });

  test("production equal to or above consumption is no deficit", () => {
    assert.equal(E.deficitFinding({ production: 900, consumption: 900, endOfLife: 0 }), null);
    assert.equal(E.deficitFinding({ production: 1000, consumption: 900, endOfLife: 0 }), null);
  });
});

describe("the plants at the end of their life", () => {
  test("none is no finding; one is a singular sentence; several are plural", () => {
    assert.equal(E.agingFinding({ production: 0, consumption: 0, endOfLife: 0 }), null);
    const one = E.agingFinding({ production: 0, consumption: 0, endOfLife: 1 });
    assert.equal(one.severity, "attention");
    assert.equal(one.diagnosis, "Une centrale approche de la fin de sa vie.");
    assert.equal(one.action, E.AGING_ACTION);
    assert.equal(E.agingFinding({ production: 0, consumption: 0, endOfLife: 3 }).diagnosis, "3 centrales approchent de la fin de leur vie.");
  });
});

describe("energyFindings", () => {
  test("empty with the rule off, with a calm city, or with a bad snapshot", () => {
    assert.deepEqual(E.energyFindings(withEnergy({ production: 1, consumption: 9, endOfLife: 1 }, { energy: false })), []);
    assert.deepEqual(E.energyFindings(withEnergy(calmEnergy)), []);
    assert.deepEqual(E.energyFindings(null), []);
    assert.deepEqual(E.energyFindings(undefined), []);
  });

  test("the deficit first, then the ageing", () => {
    const list = E.energyFindings(withEnergy({ production: 100, consumption: 900, endOfLife: 2 }));
    assert.deepEqual(list.map((f) => f.severity), ["urgent", "attention"]);
    assert.equal(list[1].diagnosis, "2 centrales approchent de la fin de leur vie.");
  });
});

describe("the planning advisor carries the findings", () => {
  test("a deficit makes the planning advice urgent", () => {
    const list = M.advise(withEnergy({ production: 100, consumption: 900, endOfLife: 0 }));
    const planning = list.find((a) => a.id === "planning");
    assert.equal(planning.severity, "urgent");
    assert.match(planning.diagnosis, /Il manque de l'électricité/);
  });

  test("the plants at the end of their life give an attention word", () => {
    const planning = M.advise(withEnergy({ production: 900, consumption: 900, endOfLife: 1 })).find((a) => a.id === "planning");
    assert.equal(planning.severity, "attention");
    assert.equal(planning.diagnosis, "Une centrale approche de la fin de sa vie.");
  });

  test("with the rule on and all well, the planning advice is the usual one", () => {
    const planning = M.advise(withEnergy(calmEnergy)).find((a) => a.id === "planning");
    assert.equal(planning.severity, "ok");
    assert.doesNotMatch(planning.diagnosis, /électricité|centrale/);
  });
});

describe("the snapshot and the cheap key (advisors.js)", () => {
  test("readSnapshot reads the energy block only with the rule on", () => {
    const city = new MockCity(1, { energy: true });
    assert.equal(readSnapshot(city).energy, undefined, "rule off");
    city.set_energy_rules(true);
    assert.deepEqual(readSnapshot(city).energy, {
      production: 1200, consumption: 900, bought: 50, plants: 3, endOfLife: 1, pollution: 40,
    });
  });

  test("cheapKey changes when the energy numbers change, and ignores them while the rule is off", () => {
    const city = (stats, on) => ({
      energy_rules: () => on, energy_stats: () => Int32Array.from(stats),
      set_energy_rules() {}, power_plants() { return new Int32Array(0); },
    });
    const base = cheapKey(city([1, 2, 3, 4, 5, 6], true));
    assert.notEqual(base, cheapKey(city([9, 2, 3, 4, 5, 6], true)));
    assert.equal(cheapKey(city([1, 2, 3, 4, 5, 6], false)), cheapKey(city([9, 9, 9, 9, 9, 9], false)));
  });
});
