// The zoning by density model (web/zoning-model.js): feature detection, names and ids, the statistics
// decoding and texts, and the reason the zoning tools are blocked.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as model from "../zoning-model.js";
import { MockCity } from "./mock-engine.mjs";

const withZones = (seed = 1) => new MockCity(seed, { densities: true });

describe("feature detection and the rule flag", () => {
  test("the zoning needs all six engine methods", () => {
    assert.equal(model.supportsZoning(withZones(1)), true);
    assert.equal(model.supportsZoning(new MockCity(1)), false, "an engine without the zoning");
    assert.equal(model.supportsZoning({}), false);
    assert.equal(model.supportsZoning(null), false);
    assert.deepEqual([...model.METHODS].sort(), [
      "density_layer", "density_rules", "density_stats", "place_zone", "set_density_rules", "zone_preview",
    ]);
    for (const m of model.METHODS) {
      const city = withZones(1);
      city[m] = undefined;
      assert.equal(model.supportsZoning(city), false, `without ${m}`);
    }
  });

  test("the flag is read from the engine, off by default, false without the zoning", () => {
    const city = withZones(1);
    assert.equal(model.readRulesOn(city), false);
    city.set_density_rules(true);
    assert.equal(model.readRulesOn(city), true);
    assert.equal(model.readRulesOn(new MockCity(1)), false);
    assert.equal(model.readRulesOn({}), false);
  });
});

describe("names, keys and ids", () => {
  test("nine zones: the genre letter and the density key in keys and ids", () => {
    const keys = [];
    for (const g of model.GENRES) for (const d of model.DENSITIES) keys.push(model.zoneKey(g.genre, d.density));
    assert.deepEqual(keys, [
      "zone_r_leger", "zone_r_moyen", "zone_r_dense",
      "zone_c_leger", "zone_c_moyen", "zone_c_dense",
      "zone_i_leger", "zone_i_moyen", "zone_i_dense",
    ]);
    assert.equal(model.zoneId(1, 2), "zoning:r:moyen");
    assert.equal(model.zoneId(3, 3), "zoning:i:dense");
  });

  test("French labels: the adjective agrees with the masculine genre", () => {
    assert.equal(model.zoneLabel(1, 1), "Résidentiel léger");
    assert.equal(model.zoneLabel(1, 2), "Résidentiel moyen");
    assert.equal(model.zoneLabel(2, 3), "Commercial dense");
    assert.equal(model.zoneLabel(3, 1), "Industriel léger");
    assert.equal(model.zoneLabel(3, 3), "Industriel dense");
  });

  test("the genre and density records", () => {
    assert.deepEqual(model.genreInfo(2), { genre: 2, letter: "c", name: "Commercial" });
    assert.deepEqual(model.densityInfo(1), { density: 1, key: "leger", adjective: "léger" });
    assert.equal(model.genreInfo(9), undefined);
    assert.equal(model.densityInfo(0), undefined);
  });
});

describe("the statistics", () => {
  test("five numbers in the order of the contract", () => {
    assert.deepEqual(model.decodeStats(Int32Array.of(4, 3, 2, 1, 7)), {
      light: 4, medium: 3, dense: 2, farms: 1, farmJobs: 7,
    });
  });

  test("a missing value is 0, and so is a negative or non-numeric one", () => {
    assert.deepEqual(model.decodeStats(Int32Array.of(5)), { light: 5, medium: 0, dense: 0, farms: 0, farmJobs: 0 });
    assert.deepEqual(model.decodeStats([-3, "x", undefined, 2.9, 1]), {
      light: 0, medium: 0, dense: 0, farms: 2, farmJobs: 1,
    });
    assert.deepEqual(model.decodeStats(undefined), { light: 0, medium: 0, dense: 0, farms: 0, farmJobs: 0 });
    assert.deepEqual(model.decodeStats(null), { light: 0, medium: 0, dense: 0, farms: 0, farmJobs: 0 });
  });

  test("only the first five values are read", () => {
    const s = model.decodeStats(Int32Array.of(1, 2, 3, 4, 5, 6, 7));
    assert.deepEqual(Object.values(s), [1, 2, 3, 4, 5]);
  });

  test("the statistics line, with the farm jobs in brackets", () => {
    const text = model.statsText({ light: 4, medium: 3, dense: 2, farms: 1, farmJobs: 7 });
    assert.equal(text, "Zones légères : 4 · moyennes : 3 · denses : 2 · fermes : 1 (7 emplois agricoles)");
  });

  test("the thousands are grouped in French", () => {
    const text = model.statsText({ light: 1234, medium: 0, dense: 0, farms: 0, farmJobs: 10000 });
    assert.match(text, /^Zones légères : 1\s234 · /);
    assert.match(text, /\(10\s000 emplois agricoles\)$/);
  });

  test("the note says what the switch does", () => {
    assert.match(model.noteText(true), /outil Zonage/);
    assert.match(model.noteText(false), /^Désactivé : toutes les zones sont denses/);
  });
});

describe("why the zoning tools are blocked", () => {
  test("rule off gives the rule message, whatever the view", () => {
    const city = withZones(1);
    assert.equal(model.zoningBlockedReason(city, { in3d: false }), model.RULE_OFF_MESSAGE);
    assert.equal(model.zoningBlockedReason(city, { in3d: true }), model.RULE_OFF_MESSAGE);
    assert.equal(model.RULE_OFF_MESSAGE, "Activez les densités de zonage pour zoner par densité.");
  });

  test("rule on: allowed in 2D, the 3D message in 3D", () => {
    const city = withZones(1);
    city.set_density_rules(true);
    assert.equal(model.zoningBlockedReason(city, { in3d: false }), "");
    assert.equal(model.zoningBlockedReason(city, { in3d: true }), model.IN_3D_MESSAGE);
  });

  test("an engine without the zoning has no zoning tool, so no reason", () => {
    assert.equal(model.zoningBlockedReason(new MockCity(1), { in3d: true }), "");
  });
});
