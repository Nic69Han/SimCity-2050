// Zone status (query tool): contract array -> French lines (web/query.js), and the mock's query.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatZoneStatus, CATEGORY_LABELS, DENSITY_LABELS, LAND_VALUE_LABELS, CRIME_LABELS,
  POLLUTION_LABELS, GROWTH_LABELS,
} from "../query.js";
import { MockCity } from "./mock-engine.mjs";

describe("zone status -> French lines", () => {
  test("a full status: category first, then density, land value, crime, pollution, growth", () => {
    // residential; density 3 = élevée; land value 7 = classe moyenne; crime 9 = sûr;
    // pollution 13 = aucune; growth 19 = croissance lente
    assert.deepEqual(formatZoneStatus(Int32Array.of(11, 3, 7, 9, 13, 19)), [
      "Zone résidentielle",
      "Densité : élevée",
      "Valeur du terrain : classe moyenne",
      "Criminalité : sûr",
      "Pollution : aucune",
      "Croissance : croissance lente",
    ]);
  });

  test("a plain array works as well as an Int32Array", () => {
    assert.deepEqual(formatZoneStatus([2, 1, 5, 12, 16, 20]), [
      "Eau",
      "Densité : faible",
      "Valeur du terrain : taudis",
      "Criminalité : dangereux",
      "Pollution : très forte",
      "Croissance : croissance rapide",
    ]);
  });

  test("nothing to report (empty array, or no value at all) gives no lines", () => {
    assert.deepEqual(formatZoneStatus(Int32Array.of()), []);
    assert.deepEqual(formatZoneStatus([]), []);
    assert.deepEqual(formatZoneStatus(null), []);
    assert.deepEqual(formatZoneStatus(undefined), []);
    assert.deepEqual(formatZoneStatus(42), []);
    assert.deepEqual(formatZoneStatus({}), []);
  });

  test("a string (an older engine) is shown as it is, an empty one as nothing", () => {
    assert.deepEqual(formatZoneStatus("Tuile (1, 2) : eau"), ["Tuile (1, 2) : eau"]);
    assert.deepEqual(formatZoneStatus(""), []);
  });

  test("a short array shows the category and the fields it has", () => {
    assert.deepEqual(formatZoneStatus([8, 2]), ["Route", "Densité : moyenne"]);
    assert.deepEqual(formatZoneStatus([8]), ["Route"]);
  });

  test("unknown category degrades to 'Type inconnu' with its number", () => {
    assert.deepEqual(formatZoneStatus([99, 1, 5, 9, 13, 17]).slice(0, 1), ["Type inconnu (99)"]);
    assert.deepEqual(formatZoneStatus([-3, 1, 5, 9, 13, 17]).slice(0, 1), ["Type inconnu (-3)"]);
  });

  test("an unknown value in a field degrades to 'inconnu' with its number, the others stay", () => {
    assert.deepEqual(formatZoneStatus([11, 0, 7, 9, 13, 19]), [
      "Zone résidentielle",
      "Densité : inconnu (0)",
      "Valeur du terrain : classe moyenne",
      "Criminalité : sûr",
      "Pollution : aucune",
      "Croissance : croissance lente",
    ]);
    // a value valid for one field is unknown for another (crime index in the density slot)
    assert.match(formatZoneStatus([11, 9])[1], /^Densité : inconnu \(9\)$/u);
  });

  test("the dirt category (29, a known C++ quirk) reads as bare ground", () => {
    assert.deepEqual(formatZoneStatus([29, 1, 5, 9, 13, 17]).slice(0, 1), ["Terrain nu"]);
  });
});

describe("the category and field tables", () => {
  test("every field table is a 4-step scale, in the order of the STR202 indices", () => {
    assert.deepEqual(Object.keys(DENSITY_LABELS).map(Number), [1, 2, 3, 4]);
    assert.deepEqual(Object.keys(LAND_VALUE_LABELS).map(Number), [5, 6, 7, 8]);
    assert.deepEqual(Object.keys(CRIME_LABELS).map(Number), [9, 10, 11, 12]);
    assert.deepEqual(Object.keys(POLLUTION_LABELS).map(Number), [13, 14, 15, 16]);
    assert.deepEqual(Object.keys(GROWTH_LABELS).map(Number), [17, 18, 19, 20]);
  });

  test("the French labels asked for by the page spec", () => {
    assert.deepEqual(Object.values(DENSITY_LABELS), ["faible", "moyenne", "élevée", "très élevée"]);
    assert.deepEqual(Object.values(LAND_VALUE_LABELS), ["taudis", "classe populaire", "classe moyenne", "aisée"]);
    assert.deepEqual(Object.values(CRIME_LABELS), ["sûr", "léger", "modéré", "dangereux"]);
    assert.deepEqual(Object.values(POLLUTION_LABELS), ["aucune", "modérée", "forte", "très forte"]);
    assert.deepEqual(Object.values(GROWTH_LABELS), ["en déclin", "stable", "croissance lente", "croissance rapide"]);
  });

  test("the status indices are the STR202 constants of text.h plus one (the C++ adds 1)", () => {
    // text.h: POPULATIONDENSITY_LOW = 0 .. VERYHIGH = 3; LANDVALUE_SLUM = 4 .. HIGH = 7;
    // CRIME_NONE = 8 .. DANGEROUS = 11; POLLUTION_NONE = 12 .. VERY_HEAVY = 15;
    // GROWRATE_DECLINING = 16 .. FASTGROWTH = 19.
    const str202 = { densityLow: 0, landSlum: 4, crimeNone: 8, pollutionNone: 12, growDeclining: 16 };
    assert.equal(Math.min(...Object.keys(DENSITY_LABELS).map(Number)), str202.densityLow + 1);
    assert.equal(Math.min(...Object.keys(LAND_VALUE_LABELS).map(Number)), str202.landSlum + 1);
    assert.equal(Math.min(...Object.keys(CRIME_LABELS).map(Number)), str202.crimeNone + 1);
    assert.equal(Math.min(...Object.keys(POLLUTION_LABELS).map(Number)), str202.pollutionNone + 1);
    assert.equal(Math.min(...Object.keys(GROWTH_LABELS).map(Number)), str202.growDeclining + 1);
  });

  test("categories 1 to 29 are all labelled, and the labels are non-empty French text", () => {
    for (let v = 1; v <= 29; v++) {
      assert.ok(typeof CATEGORY_LABELS[v] === "string" && CATEGORY_LABELS[v].length > 0, `category ${v}`);
    }
    assert.equal(CATEGORY_LABELS[11], "Zone résidentielle");
    assert.equal(CATEGORY_LABELS[12], "Zone commerciale");
    assert.equal(CATEGORY_LABELS[13], "Zone industrielle");
    assert.equal(CATEGORY_LABELS[8], "Route");
    assert.equal(CATEGORY_LABELS[10], "Voie ferrée");
    assert.equal(CATEGORY_LABELS[9], "Ligne électrique");
    assert.equal(CATEGORY_LABELS[2], "Eau");
    assert.equal(CATEGORY_LABELS[3], "Arbres");
    assert.equal(CATEGORY_LABELS[4], "Décombres");
    assert.equal(CATEGORY_LABELS[7], "Incendie");
    assert.equal(CATEGORY_LABELS[5], "Inondation");
    assert.equal(CATEGORY_LABELS[6], "Déchets radioactifs");
  });
});

describe("mock engine query (the contract shape)", () => {
  test("off the map: an empty Int32Array", () => {
    const city = new MockCity(1);
    const q = city.query(-1, 0);
    assert.ok(q instanceof Int32Array);
    assert.equal(q.length, 0);
    assert.equal(city.query(city.width(), 0).length, 0);
  });

  test("on the map: six Int32 values, every one of them a known index of the page", () => {
    const city = new MockCity(1);
    for (let x = 0; x < city.width(); x += 3) {
      for (let y = 0; y < city.height(); y += 3) {
        const q = city.query(x, y);
        assert.ok(q instanceof Int32Array);
        assert.equal(q.length, 6);
        const lines = formatZoneStatus(q);
        assert.equal(lines.length, 6);
        for (const line of lines) assert.doesNotMatch(line, /inconnu/u, `${x},${y}: ${line}`);
      }
    }
  });

  test("the mock's status covers every index of every field (so every label is reachable)", () => {
    const city = new MockCity(1);
    const seen = [new Set(), new Set(), new Set(), new Set(), new Set()];
    for (let x = 0; x < city.width(); x++) {
      for (let y = 0; y < city.height(); y++) {
        const q = city.query(x, y);
        for (let i = 0; i < 5; i++) seen[i].add(q[i + 1]);
      }
    }
    assert.deepEqual([...seen[0]].sort((a, b) => a - b), [1, 2, 3, 4]);
    assert.deepEqual([...seen[1]].sort((a, b) => a - b), [5, 6, 7, 8]);
    assert.deepEqual([...seen[2]].sort((a, b) => a - b), [9, 10, 11, 12]);
    assert.deepEqual([...seen[3]].sort((a, b) => a - b), [13, 14, 15, 16]);
    assert.deepEqual([...seen[4]].sort((a, b) => a - b), [17, 18, 19, 20]);
  });

  test("the category follows the tile: water, dirt (29, as the C++), rubble", () => {
    const city = new MockCity(1, { rubble: 0 });
    assert.equal(city.query(4, 4)[0], 2, "the lake is water");
    assert.equal(city.query(20, 20)[0], 29, "bare dirt reports 29 like the C++");
    const rubbly = new MockCity(1, { rubble: 400 });
    const tiles = rubbly.tiles();
    const i = tiles.findIndex((t, k) => t === 44 && k % 30 > 9); // a rubble tile off the lake
    assert.ok(i >= 0);
    assert.equal(rubbly.query(Math.floor(i / 30), i % 30)[0], 4);
  });

  test("query never changes the city", () => {
    const city = new MockCity(1);
    const before = city.tiles();
    city.query(5, 5);
    city.query(-4, 99);
    assert.deepEqual(city.tiles(), before);
    assert.equal(city.log.length, 0);
  });
});
