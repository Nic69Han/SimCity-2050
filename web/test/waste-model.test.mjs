// The waste model (web/waste-model.js): the API check, the decoded statistics, the French lines, the landfill
// count, the snapshot block and the environment findings; and the names of the waste genres (structures-model.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as W from "../waste-model.js";
import { nameOf } from "../structures-model.js";

const norm = (s) => s.replace(/[  ]/g, " ");
const FULL = { waste_rules() {}, set_waste_rules() {}, waste_stats() {}, waste_layer() {} };

describe("constants and the API", () => {
  test("the waste API has four methods, the statistics have seven numbers, the urgent level is 500", () => {
    assert.deepEqual([...W.METHODS], ["waste_rules", "set_waste_rules", "waste_stats", "waste_layer"]);
    assert.equal(W.STAT_COUNT, 7);
    assert.equal(W.WASTE_URGENT, 500);
    assert.equal(W.GENRE_LANDFILL, 20);
    assert.equal(W.STRUCTURE_RECORD, 6);
  });

  test("supports: every method is needed; no city, no methods, or a method missing is not supported", () => {
    assert.equal(W.supports(FULL), true);
    assert.equal(W.supports({}), false);
    assert.equal(W.supports(null), false);
    assert.equal(W.supports(undefined), false);
    for (const m of W.METHODS) {
      const city = { ...FULL, [m]: undefined };
      assert.equal(W.supports(city), false, m);
    }
  });
});

describe("decodeStats", () => {
  test("reads the seven numbers in the engine's order", () => {
    assert.deepEqual(W.decodeStats(Int32Array.of(10, 6, 2, 1, 1, 500, 40)), {
      produced: 10, treated: 6, recycled: 2, exported: 1, accumulated: 1, landfillLeft: 500, power: 40,
    });
  });

  test("a missing value counts as 0, a negative or non-numeric one too, and extra values are ignored", () => {
    assert.deepEqual(W.decodeStats([5, -3, "x", 4]), {
      produced: 5, treated: 0, recycled: 0, exported: 4, accumulated: 0, landfillLeft: 0, power: 0,
    });
    assert.deepEqual(W.decodeStats([1, 2, 3, 4, 5, 6, 7, 8, 9]).power, 7);
  });

  test("fractions are truncated and null or undefined reads as zeros", () => {
    assert.equal(W.decodeStats([9.9]).produced, 9);
    assert.deepEqual(W.decodeStats(null), W.decodeStats([]));
    assert.equal(W.decodeStats(undefined).accumulated, 0);
  });
});

describe("statsLines and noteText", () => {
  test("seven French lines in the engine's order", () => {
    const lines = W.statsLines(W.decodeStats([1200, 900, 100, 50, 250, 3000, 40]));
    assert.equal(lines.length, 7);
    assert.deepEqual(lines.map(norm), [
      "Produits par mois : 1 200",
      "Traités par mois : 900",
      "Recyclés par mois : 100",
      "Exportés par mois : 50",
      "Accumulés sur la carte : 250",
      "Capacité des décharges restante : 3 000",
      "Électricité produite : 40",
    ]);
  });

  test("the note says what the switch does, on and off", () => {
    assert.match(W.noteText(true), /^Les zones produisent des déchets/);
    assert.equal(W.noteText(false), "Désactivé : les zones ne produisent pas de déchets.");
  });
});

describe("landfills and the snapshot block", () => {
  // [genre, x, y, width, height, state] records
  const rec = (genre) => [genre, 1, 1, 3, 3, 0];

  test("counts the landfills (genre 20) only, bounded by the data, a partial record ignored", () => {
    const flat = [...rec(20), ...rec(21), ...rec(20), ...rec(1), 20, 0, 0];
    assert.equal(W.countLandfills(Int32Array.from(flat)), 2);
    assert.equal(W.countLandfills(null), 0);
    assert.equal(W.countLandfills([]), 0);
  });

  test("the snapshot block: accumulated and landfill room from the stats, landfills from the buildings", () => {
    const stats = [0, 0, 0, 0, 320, 0, 0];
    assert.deepEqual(W.wasteSnapshot(stats, Int32Array.from([...rec(20)])), { accumulated: 320, landfillLeft: 0, landfills: 1 });
    assert.deepEqual(W.wasteSnapshot([], null), { accumulated: 0, landfillLeft: 0, landfills: 0 });
  });
});

describe("wasteOf", () => {
  test("null unless the rule is exactly true and the block is an object", () => {
    assert.equal(W.wasteOf({}), null);
    assert.equal(W.wasteOf({ rules: { waste: false }, waste: { accumulated: 1 } }), null);
    assert.equal(W.wasteOf({ rules: { waste: 1 }, waste: { accumulated: 1 } }), null);
    assert.equal(W.wasteOf({ rules: { waste: true } }), null);
    assert.equal(W.wasteOf({ rules: { waste: true }, waste: 5 }), null);
  });

  test("reads the three numbers, and a garbage one reads as 0", () => {
    const s = { rules: { waste: true }, waste: { accumulated: 4, landfillLeft: "x", landfills: NaN } };
    assert.deepEqual(W.wasteOf(s), { accumulated: 4, landfillLeft: 0, landfills: 0 });
  });
});

describe("wasteFindings", () => {
  const on = (accumulated, landfillLeft = 100, landfills = 0) => ({
    rules: { waste: true }, waste: { accumulated, landfillLeft, landfills },
  });

  test("nothing while the rule is off or the block is absent", () => {
    assert.deepEqual(W.wasteFindings({ rules: { waste: false }, waste: { accumulated: 900, landfillLeft: 0, landfills: 1 } }), []);
    assert.deepEqual(W.wasteFindings({}), []);
  });

  test("nothing on the map and room left: no finding", () => {
    assert.deepEqual(W.wasteFindings(on(0, 100, 1)), []);
    assert.deepEqual(W.wasteFindings(on(0, 0, 0)), [], "a full landfill is only news when one is built");
  });

  test("garbage on the map is attention, and urgent from WASTE_URGENT, with the remedy", () => {
    const low = W.wasteFindings(on(1))[0];
    assert.equal(low.severity, "attention");
    assert.equal(W.wasteFindings(on(W.WASTE_URGENT - 1))[0].severity, "attention");
    const high = W.wasteFindings(on(W.WASTE_URGENT))[0];
    assert.equal(high.severity, "urgent");
    assert.equal(high.action, "Construisez une décharge, un incinérateur ou un centre de recyclage.");
    assert.match(norm(high.diagnosis), /^Les ordures non ramassées s'accumulent : 500 sur la carte\./);
  });

  test("full landfills with a landfill built are attention", () => {
    const f = W.wasteFindings(on(0, 0, 2));
    assert.deepEqual(f, [{ severity: "attention", diagnosis: "Les décharges sont pleines.",
      action: "Construisez une nouvelle décharge ou traitez les déchets par un incinérateur ou un centre de recyclage." }]);
  });

  test("both findings, the garbage first", () => {
    const f = W.wasteFindings(on(600, 0, 1));
    assert.deepEqual(f.map((x) => x.severity), ["urgent", "attention"]);
    assert.equal(f[1].diagnosis, "Les décharges sont pleines.");
  });
});

describe("the genres of the waste are named", () => {
  test("20 décharge, 21 incinérateur, 22 centre de recyclage, 23 usine de valorisation", () => {
    assert.equal(nameOf(20), "Décharge");
    assert.equal(nameOf(21), "Incinérateur");
    assert.equal(nameOf(22), "Centre de recyclage");
    assert.equal(nameOf(23), "Usine de valorisation");
    assert.equal(nameOf(24), "Bâtiment n° 24");
  });
});
