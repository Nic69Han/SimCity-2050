// The public services presentation model (web/services-model.js) and the genre names 30-36 of
// web/structures-model.js. Pure: the engine is the mock, or a plain object.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as M from "../services-model.js";
import { nameOf } from "../structures-model.js";
import { MockCity, SERVICES_FIXED } from "./mock-engine.mjs";

const plain = (t) => t.replace(/[\s  ]/g, " ");

describe("the API and the feature detection", () => {
  test("the methods of the public services and the stat count", () => {
    assert.deepEqual([...M.METHODS], ["service_rules", "set_service_rules", "service_stats"]);
    assert.equal(M.STAT_COUNT, 10);
    assert.equal(M.MAX_PERCENT, 100);
  });

  test("supports: true only with all three methods as functions", () => {
    assert.equal(M.supports(new MockCity(1, { services: true })), true);
    assert.equal(M.supports(new MockCity(1)), false, "hidden without the option");
    assert.equal(M.supports({}), false);
    assert.equal(M.supports(null), false);
    const two = { service_rules() {}, set_service_rules() {} };
    assert.equal(M.supports(two), false, "service_stats missing");
    assert.equal(M.supports({ ...two, service_stats: 3 }), false, "not a function");
  });

  test("readRulesOn: the engine's flag, false without the API", () => {
    const city = new MockCity(1, { services: true });
    assert.equal(M.readRulesOn(city), false);
    city.set_service_rules(true);
    assert.equal(M.readRulesOn(city), true);
    assert.equal(M.readRulesOn(new MockCity(1)), false);
    assert.equal(M.readRulesOn({ service_rules: () => 1, set_service_rules() {} }), false, "no service_stats: no API");
    assert.equal(M.readRulesOn({ service_rules: () => 1, set_service_rules() {}, service_stats() {} }), true, "truthy flag");
  });
});

describe("decodeStats", () => {
  test("reads the ten numbers in order into the named record", () => {
    const s = M.decodeStats(SERVICES_FIXED);
    assert.deepEqual(s, {
      eq: 85, life: 72, students: 340, schoolPlaces: 400, patients: 120, carePlaces: 150,
      inmates: 30, prisonPlaces: 40, educationPct: 60, healthPct: 45,
    });
  });

  test("a missing value, a negative, a fraction or a garbage value counts as 0", () => {
    const s = M.decodeStats([-5, 7.9, "x", NaN]);
    assert.equal(s.eq, 0);
    assert.equal(s.life, 7);
    assert.equal(s.students, 0);
    assert.equal(s.schoolPlaces, 0);
    assert.equal(s.patients, 0, "missing");
    assert.equal(s.educationPct, 0);
  });

  test("a percentage is capped at MAX_PERCENT, a count is not", () => {
    const s = M.decodeStats([0, 0, 0, 0, 0, 0, 0, 0, 250, 100]);
    assert.equal(s.educationPct, 100);
    assert.equal(s.healthPct, 100);
    assert.equal(M.decodeStats([0, 0, 0, 0, 0, 0, 0, 0, -3, 0]).educationPct, 0);
    assert.equal(M.decodeStats([150]).eq, 150);
  });

  test("only the first STAT_COUNT values are read", () => {
    const many = Array.from({ length: 25 }, (_, i) => i);
    assert.equal(M.decodeStats(many).healthPct, 9);
    assert.equal(M.decodeStats(many).eq, 0);
  });

  test("null or undefined gives all zeros", () => {
    const zero = M.decodeStats([]);
    assert.equal(M.decodeStats(null).eq, 0);
    assert.equal(M.decodeStats(undefined).healthPct, 0);
    assert.deepEqual(M.decodeStats(null), zero);
    assert.equal(Object.keys(zero).length, M.FIELDS.length);
  });
});

describe("texts", () => {
  test("statsLines: the French lines, in order, with the numbers", () => {
    const lines = M.statsLines(M.decodeStats(SERVICES_FIXED)).map(plain);
    assert.deepEqual(lines, [
      "Niveau d'éducation (EQ) : 85",
      "Espérance de vie : 72 ans",
      "Écoles : 340 / 400 élèves",
      "Hôpitaux et cliniques : 120 / 150 patients",
      "Prison : 30 / 40 détenus",
      "Couverture éducation : 60 %",
      "Couverture santé : 45 %",
    ]);
  });

  test("statsLines of zeros is still seven lines", () => {
    assert.equal(M.statsLines(M.decodeStats([])).length, 7);
  });

  test("noteText says what the switch does, on and off", () => {
    assert.equal(M.noteText(true), M.RULE_ON_NOTE);
    assert.equal(M.noteText(false), M.RULE_OFF_NOTE);
    assert.match(M.noteText(false), /^Désactivé/);
    assert.notEqual(M.RULE_ON_NOTE, M.RULE_OFF_NOTE);
  });

  test("the coverage views: «Aucune» then Éducation, Santé, Sécurité", () => {
    assert.deepEqual(M.VIEWS.map((v) => v.label), ["Aucune", "Éducation", "Santé", "Sécurité"]);
  });
});

describe("viewKind", () => {
  test("a view key gives the numeric kind of the engine contract: 0 education, 1 health, 2 security", () => {
    assert.equal(M.viewKind("education"), 0);
    assert.equal(M.viewKind("health"), 1);
    assert.equal(M.viewKind("security"), 2);
  });

  test("«Aucune» and unknown or missing keys give null", () => {
    assert.equal(M.viewKind(""), null);
    assert.equal(M.viewKind("zoning"), null);
    assert.equal(M.viewKind("Education"), null, "keys are exact");
    assert.equal(M.viewKind(undefined), null);
  });

  test("every view kind is null or a valid coverage kind (0..2), as setCoverageView takes", () => {
    for (const v of M.VIEWS) {
      assert.ok(v.kind === null || [0, 1, 2].includes(v.kind), `view "${v.key}"`);
    }
    assert.deepEqual(M.VIEWS.map((v) => v.kind), [null, 0, 1, 2]);
  });
});

describe("the genre names 30-36 (structures-model.js)", () => {
  test("École, Collège, Bibliothèque, Musée, Clinique, Hôpital, Prison", () => {
    assert.deepEqual([30, 31, 32, 33, 34, 35, 36].map(nameOf),
      ["École", "Collège", "Bibliothèque", "Musée", "Clinique", "Hôpital", "Prison"]);
  });

  test("the earlier names are unchanged, and 37 is still unnamed", () => {
    assert.equal(nameOf(13), "Gare");
    assert.equal(nameOf(37), "Bâtiment n° 37");
  });
});

describe("the mock engine's services API", () => {
  test("ten zeros while the rule is off, the fixed numbers once it is on", () => {
    const city = new MockCity(1, { services: true });
    assert.deepEqual([...city.service_stats()], new Array(10).fill(0));
    city.set_service_rules(true);
    assert.deepEqual([...city.service_stats()], [...SERVICES_FIXED]);
    assert.equal(city.service_rules(), true);
  });

  test("the rule is off after a new city and after a load", () => {
    const city = new MockCity(1, { services: true });
    city.set_service_rules(true);
    city.new_random_city(2);
    assert.equal(city.service_rules(), false);
    city.set_service_rules(true);
    city.load_cty();
    assert.equal(city.service_rules(), false);
  });

  test("the methods are hidden without the option", () => {
    const city = new MockCity(1);
    assert.equal(city.service_rules, undefined);
    assert.equal(city.service_stats, undefined);
  });
});
