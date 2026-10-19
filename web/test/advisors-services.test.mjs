// Public services advice (web/advisors-services.js): the thresholds, the wording, the rule switch, the snapshot
// reader and the cheap key of web/advisors.js, and the planning advisor that carries the findings.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as S from "../advisors-services.js";
import * as M from "../advisors-model.js";
import { readSnapshot, cheapKey } from "../advisors.js";
import { MockCity, SERVICES_FIXED } from "./mock-engine.mjs";

// A calm city (no complaint anywhere) with the services rule on and the given services block.
const withServices = (services, rules = { services: true }) => ({
  funds: 50000, cashFlow: 500, taxRate: 7, funding: { road: 100, fire: 100, police: 100 },
  problems: [], demand: { res: 100, com: 100, ind: 100 }, population: 1000, populationDelta: 20,
  moneyHistory: [128, 128, 130], pollutionHistory: [10, 10, 10],
  rules, services,
});
// A services block: every number fine unless overridden.
const fine = (over = {}) => ({
  eq: 85, life: 72, students: 340, schoolPlaces: 400, patients: 120, carePlaces: 150, ...over,
});
const findings = (s) => S.servicesFindings(withServices(s));
const planning = (s) => M.advise(withServices(s)).find((a) => a.id === "planning");

describe("thresholds and texts", () => {
  test("the constants: EQ and life below 60 are worth a word", () => {
    assert.equal(S.SERVICES_EQ_LOW, 60);
    assert.equal(S.SERVICES_LIFE_LOW, 60);
    assert.equal(S.SERVICES_SEVERITY, "attention");
  });

  test("the French actions of the advice", () => {
    assert.equal(S.EDUCATION_LOW.action, "Construisez des écoles et une bibliothèque.");
    assert.equal(S.LIFE_LOW.action, "Construisez une clinique ou un hôpital.");
    assert.equal(S.FULL_DIAGNOSIS, "Les écoles (ou les hôpitaux) sont pleins.");
  });
});

describe("education (EQ)", () => {
  test("EQ 59 is attention with the school action; EQ 60 is no finding", () => {
    const [f] = findings(fine({ eq: 59 }));
    assert.equal(f.severity, "attention");
    assert.equal(f.action, "Construisez des écoles et une bibliothèque.");
    assert.equal(f.diagnosis, "Le niveau d'éducation est bas (EQ 59).");
    assert.deepEqual(findings(fine({ eq: 60 })), []);
  });

  test("EQ 0 is still a finding (the lowest value)", () => {
    assert.equal(findings(fine({ eq: 0 })).length, 1);
  });
});

describe("life expectancy", () => {
  test("59 years is attention with the clinic action; 60 years is no finding", () => {
    const [f] = findings(fine({ life: 59 }));
    assert.equal(f.severity, "attention");
    assert.equal(f.action, "Construisez une clinique ou un hôpital.");
    assert.equal(f.diagnosis, "L'espérance de vie est basse (59 ans).");
    assert.deepEqual(findings(fine({ life: 60 })), []);
  });
});

describe("full places", () => {
  test("more students than school places: the full finding, with the school action", () => {
    const [f] = findings(fine({ students: 401, schoolPlaces: 400 }));
    assert.equal(f.severity, "attention");
    assert.equal(f.diagnosis, "Les écoles (ou les hôpitaux) sont pleins.");
    assert.equal(f.action, "Construisez une école ou un collège de plus.");
  });

  test("students equal to the places are not full", () => {
    assert.deepEqual(findings(fine({ students: 400, schoolPlaces: 400 })), []);
  });

  test("more patients than care places: the full finding, with the hospital action", () => {
    const [f] = findings(fine({ patients: 151, carePlaces: 150 }));
    assert.equal(f.diagnosis, "Les écoles (ou les hôpitaux) sont pleins.");
    assert.equal(f.action, "Construisez un hôpital de plus.");
  });

  test("both full: one finding whose action names both", () => {
    const list = findings(fine({ students: 5, schoolPlaces: 4, patients: 3, carePlaces: 2 }));
    assert.equal(list.length, 1);
    assert.equal(list[0].action, "Construisez une école ou un collège de plus. Construisez un hôpital de plus.");
  });

  test("no places at all with students is full; no students and no places is not", () => {
    assert.equal(findings(fine({ students: 1, schoolPlaces: 0 })).length, 1);
    assert.deepEqual(findings(fine({ students: 0, schoolPlaces: 0, patients: 0, carePlaces: 0 })), []);
  });
});

describe("the order and the count of the findings", () => {
  test("education, then life, then full places; each at most once", () => {
    const list = findings({ eq: 10, life: 10, students: 9, schoolPlaces: 1, patients: 0, carePlaces: 0 });
    assert.deepEqual(list.map((f) => f.action), [
      "Construisez des écoles et une bibliothèque.",
      "Construisez une clinique ou un hôpital.",
      "Construisez une école ou un collège de plus.",
    ]);
  });

  test("all fine: no finding; a city bad on every count gets one finding per kind", () => {
    assert.deepEqual(findings(fine()), []);
    assert.equal(findings({ eq: 0, life: 0, students: 9, schoolPlaces: 0, patients: 9, carePlaces: 0 }).length, 3);
  });
});

describe("the rule switch and missing data", () => {
  test("rule off: no finding, even with the bad numbers", () => {
    assert.deepEqual(S.servicesFindings(withServices(fine({ eq: 0 }), { services: false })), []);
    assert.deepEqual(S.servicesFindings(withServices(fine({ eq: 0 }), {})), []);
  });

  test("no services block: no finding", () => {
    assert.deepEqual(S.servicesFindings(withServices(undefined)), []);
    assert.deepEqual(S.servicesFindings(withServices(null)), []);
    assert.deepEqual(S.servicesFindings(withServices(3)), []);
  });

  test("missing or non-numeric numbers leave their finding out", () => {
    const list = findings({ life: 10 }); // no EQ, no place counts: only the life finding
    assert.equal(list.length, 1);
    assert.equal(list[0].action, "Construisez une clinique ou un hôpital.");
    assert.deepEqual(findings({ eq: "x", life: NaN, students: 5 }), []);
  });

  test("total: null and garbage give an empty list", () => {
    assert.deepEqual(S.servicesFindings(null), []);
    assert.deepEqual(S.servicesFindings(undefined), []);
    assert.deepEqual(S.servicesFindings({ rules: { services: true }, services: "x" }), []);
  });
});

describe("the planning advisor carries the findings", () => {
  test("low EQ: Urbanisme is attention with the school action", () => {
    const a = planning(fine({ eq: 40 }));
    assert.equal(a.severity, "attention");
    assert.equal(a.action, "Construisez des écoles et une bibliothèque.");
  });

  test("the services alone keep Urbanisme visible, and the fine city stays ok", () => {
    assert.equal(planning(fine({ life: 30 })).severity, "attention");
    assert.equal(planning(fine()).severity, "ok");
  });

  test("rule off: Urbanisme does not change with the services numbers", () => {
    const s = withServices(fine({ eq: 0 }), { services: false });
    assert.equal(M.advise(s).find((a) => a.id === "planning").severity, "ok");
  });
});

describe("readSnapshot and cheapKey on the mock engine", () => {
  test("no services API: no services block, and no services rule in the rules", () => {
    const snap = readSnapshot(new MockCity(1));
    assert.equal(snap.services, undefined);
    assert.equal(snap.rules?.services, undefined);
  });

  test("the rule off: the rule is read as false, the statistics are not", () => {
    const city = new MockCity(1, { services: true });
    const snap = readSnapshot(city);
    assert.equal(snap.rules.services, false);
    assert.equal(snap.services, undefined);
  });

  test("the rule on: the statistics are decoded into the services block", () => {
    const city = new MockCity(1, { services: true });
    city.set_service_rules(true);
    const snap = readSnapshot(city);
    assert.equal(snap.rules.services, true);
    assert.equal(snap.services.eq, SERVICES_FIXED[0]);
    assert.equal(snap.services.life, SERVICES_FIXED[1]);
    assert.equal(snap.services.students, 340);
    assert.equal(snap.services.patients, 120);
    assert.deepEqual(findings(snap.services), [], "the mock's numbers are fine");
  });

  test("the cheap key changes with EQ, life and the full places, not with the rest", () => {
    const city = new MockCity(1, { services: true });
    city.set_service_rules(true);
    const base = cheapKey(city);
    city.service_stats = () => Int32Array.from([50, 72, 340, 400, 120, 150, 30, 40, 60, 45]);
    assert.notEqual(cheapKey(city), base, "EQ");
    city.service_stats = () => Int32Array.from([85, 55, 340, 400, 120, 150, 30, 40, 60, 45]);
    assert.notEqual(cheapKey(city), base, "life");
    city.service_stats = () => Int32Array.from([85, 72, 401, 400, 120, 150, 30, 40, 60, 45]);
    assert.notEqual(cheapKey(city), base, "students over the places");
    city.service_stats = () => Int32Array.from([85, 72, 340, 400, 120, 150, 30, 40, 99, 99]);
    assert.equal(cheapKey(city), base, "the percentages are not in the key");
  });

  test("the cheap key ignores the statistics while the rule is off", () => {
    const city = new MockCity(1, { services: true });
    const base = cheapKey(city);
    city.service_stats = () => Int32Array.from([0, 0, 9, 0, 9, 0, 0, 0, 0, 0]);
    assert.equal(cheapKey(city), base);
  });
});
