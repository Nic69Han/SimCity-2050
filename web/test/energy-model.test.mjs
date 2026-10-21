// The energy presentation model (web/energy-model.js) and the genre names 40-46 of web/structures-model.js.
// Pure: the engine is the mock (energy: true), or a plain object.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as M from "../energy-model.js";
import { nameOf, ENERGY_NAMES } from "../structures-model.js";
import { MockCity } from "./mock-engine.mjs";
import { ENERGY_FIXED, MOCK_PLANTS } from "./mock-energy.mjs";

const plain = (t) => t.replace(/[\s  ]/g, " ");

describe("the API, the caps and the feature detection", () => {
  test("the methods, the counts and the caps", () => {
    assert.deepEqual([...M.METHODS], ["energy_rules", "set_energy_rules", "energy_stats", "power_plants"]);
    assert.equal(M.STAT_COUNT, 6);
    assert.equal(M.PLANT_LENGTH, 6);
    assert.equal(M.MAX_PLANTS, 256);
    assert.equal(M.MONTHS_PER_YEAR, 12);
    assert.equal(M.MAX_PERCENT, undefined, "the power is in tiles, not percentages: no cap");
  });

  test("supports: true only with all four methods as functions", () => {
    assert.equal(M.supports(new MockCity(1, { energy: true })), true);
    assert.equal(M.supports(new MockCity(1)), false, "hidden without the option");
    assert.equal(M.supports({}), false);
    assert.equal(M.supports(null), false);
    const three = { energy_rules() {}, set_energy_rules() {}, energy_stats() {} };
    assert.equal(M.supports(three), false, "power_plants missing");
    assert.equal(M.supports({ ...three, power_plants: 3 }), false, "not a function");
  });

  test("readRulesOn: the engine's flag, false without the API", () => {
    const city = new MockCity(1, { energy: true });
    assert.equal(M.readRulesOn(city), false);
    city.set_energy_rules(true);
    assert.equal(M.readRulesOn(city), true);
    assert.equal(M.readRulesOn(new MockCity(1)), false);
    const plainCity = { energy_rules: () => 1, set_energy_rules() {}, energy_stats() {}, power_plants() {} };
    assert.equal(M.readRulesOn(plainCity), true, "a truthy flag is on");
  });
});

describe("decodeStats", () => {
  test("reads the six numbers in order into the named record", () => {
    assert.deepEqual(M.decodeStats(Int32Array.from(ENERGY_FIXED)), {
      production: 1200, consumption: 900, bought: 50, plants: 3, endOfLife: 1, pollution: 40,
    });
  });

  test("a missing, non-numeric or negative value counts as 0; extra values are ignored", () => {
    assert.deepEqual(M.decodeStats([5, -3, "x", 2]), {
      production: 5, consumption: 0, bought: 0, plants: 2, endOfLife: 0, pollution: 0,
    });
    assert.equal(M.decodeStats([1, 2, 3, 4, 5, 6, 99]).pollution, 6);
    assert.deepEqual(M.decodeStats(undefined), {
      production: 0, consumption: 0, bought: 0, plants: 0, endOfLife: 0, pollution: 0,
    });
  });
});

describe("decodePlants", () => {
  test("reads records of six numbers; a truncated last record is ignored", () => {
    const flat = Int32Array.from([40, 10, 10, 36, 480, 400, 42, 4, 4, 200, 240, 26, 0, 1]);
    assert.deepEqual(M.decodePlants(flat), [
      { genre: 40, x: 10, y: 10, ageMonths: 36, lifetimeMonths: 480, power: 400 },
      { genre: 42, x: 4, y: 4, ageMonths: 200, lifetimeMonths: 240, power: 26 },
    ]);
  });

  test("the power is a count of powered tiles: no cap, a negative or non-numeric one is 0", () => {
    const [a, b, c] = M.decodePlants([40, 0, 0, 0, 480, 397, 40, 0, 0, 0, 480, -7, 40, 0, 0, 0, 480, "x"]);
    assert.equal(a.power, 397, "a worn gas plant shows its own tiles");
    assert.equal(b.power, 0);
    assert.equal(c.power, 0);
  });

  test("a plant above 100 tiles keeps its value: a new fusion plant gives 3 000 tiles", () => {
    const [fusion] = M.decodePlants([46, 0, 0, 0, 960, 3000]);
    assert.equal(fusion.power, 3000);
    assert.equal(M.decodePlants([0, 0, 0, 0, 600, 700])[0].power, 700, "a coal plant gives COAL_POWER_STRENGTH");
  });

  test("the plants are at most MAX_PLANTS, whatever the engine sends", () => {
    const flat = new Int32Array((M.MAX_PLANTS + 10) * M.PLANT_LENGTH);
    assert.equal(M.decodePlants(flat).length, M.MAX_PLANTS);
  });

  test("no data, no plant", () => {
    assert.deepEqual(M.decodePlants(undefined), []);
    assert.deepEqual(M.decodePlants(new Int32Array(0)), []);
    assert.deepEqual(M.decodePlants([1, 2]), []);
  });

  test("the mock's plants decode to three records", () => {
    const list = M.decodePlants(Int32Array.from(MOCK_PLANTS.flat()));
    assert.equal(list.length, 3);
    assert.equal(list[1].genre, 42);
  });
});

describe("ages, names and lines", () => {
  test("ageYears: whole years from months, never negative", () => {
    assert.equal(M.ageYears(0), 0);
    assert.equal(M.ageYears(11), 0);
    assert.equal(M.ageYears(12), 1);
    assert.equal(M.ageYears(36), 3);
    assert.equal(M.ageYears(479), 39);
    assert.equal(M.ageYears(-4), 0);
  });

  test("plantName: the classic plants, then the catalog names 40-46", () => {
    assert.equal(M.plantName(0), "Centrale à charbon");
    assert.equal(M.plantName(1), "Centrale nucléaire");
    assert.equal(M.plantName(40), "Centrale au gaz");
    assert.equal(M.plantName(41), "Centrale au pétrole");
    assert.equal(M.plantName(42), "Éolienne");
    assert.equal(M.plantName(43), "Centrale solaire");
    assert.equal(M.plantName(44), "Centrale hydroélectrique");
    assert.equal(M.plantName(45), "Centrale à micro-ondes");
    assert.equal(M.plantName(46), "Centrale à fusion");
    assert.equal(M.plantName(99), "Bâtiment n° 99");
  });

  test("powerText: the tiles, singular for one tile or none", () => {
    assert.equal(M.powerText(0), "0 tuile");
    assert.equal(M.powerText(1), "1 tuile");
    assert.equal(M.powerText(30), "30 tuiles");
    assert.equal(plain(M.powerText(3000)), "3 000 tuiles");
    assert.equal(M.powerText(-5), "0 tuile", "a negative count reads as 0");
  });

  test("plantLine: name, age in years, power in tiles, never a percent", () => {
    const line = M.plantLine({ genre: 40, ageMonths: 36, power: 400 });
    assert.equal(plain(line), "Centrale au gaz : âge 3 ans, puissance 400 tuiles");
    assert.doesNotMatch(line, /%/);
  });

  test("a new wind turbine reads 30 tiles, a worn gas plant its tiles, a fusion plant 3 000 tiles", () => {
    assert.equal(plain(M.plantLine({ genre: 42, ageMonths: 0, power: 30 })), "Éolienne : âge 0 ans, puissance 30 tuiles");
    assert.equal(plain(M.plantLine({ genre: 40, ageMonths: 420, power: 397 })), "Centrale au gaz : âge 35 ans, puissance 397 tuiles");
    assert.equal(plain(M.plantLine({ genre: 46, ageMonths: 0, power: 3000 })), "Centrale à fusion : âge 0 ans, puissance 3 000 tuiles");
  });

  test("an age of one year reads in the singular", () => {
    assert.equal(plain(M.plantLine({ genre: 42, ageMonths: 12, power: 30 })), "Éolienne : âge 1 an, puissance 30 tuiles");
  });

  test("plantsLines: one line per plant, or the sentence for none", () => {
    assert.deepEqual(M.plantsLines([]), [M.NO_PLANTS_TEXT]);
    assert.equal(M.NO_PLANTS_TEXT, "Aucune centrale posée.");
    const lines = M.plantsLines(M.decodePlants(Int32Array.from(MOCK_PLANTS.flat())));
    assert.equal(lines.length, 3);
    assert.equal(plain(lines[2]), "Centrale à charbon : âge 10 ans, puissance 700 tuiles");
  });

  test("statsLines: six lines in French, in a fixed order", () => {
    assert.deepEqual(M.statsLines(M.decodeStats(Int32Array.from(ENERGY_FIXED))).map(plain), [
      "Production : 1 200",
      "Consommation : 900",
      "Achetée aux voisins : 50",
      "Centrales : 3",
      "Centrales en fin de vie : 1",
      "Pollution de l'air produite : 40",
    ]);
  });

  test("noteText: the rule on or off", () => {
    assert.equal(M.noteText(true), M.RULE_ON_NOTE);
    assert.equal(M.noteText(false), M.RULE_OFF_NOTE);
    assert.match(M.RULE_OFF_NOTE, /^Désactivé/);
  });
});

describe("the genre names 40-46 (structures-model.js)", () => {
  test("nameOf gives the French names of the energy genres", () => {
    assert.equal(nameOf(40), "Centrale au gaz");
    assert.equal(nameOf(46), "Centrale à fusion");
    assert.equal(Object.keys(ENERGY_NAMES).length, 7);
  });

  test("the older names are unchanged", () => {
    assert.equal(nameOf(1), "Parc urbain");
    assert.equal(nameOf(30), "École");
    assert.equal(nameOf(47), "Bâtiment n° 47");
  });
});
