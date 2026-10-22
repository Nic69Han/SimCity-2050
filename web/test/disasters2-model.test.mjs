// Pure part of the catastrophes panel (web/disasters2-model.js): the engine methods, the decoding of the statistics,
// the French lines, the trigger texts. Every cap and every fallback is checked.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as m from "../disasters2-model.js";
import { MockCity } from "./mock-engine.mjs";

const NNBSP = " ";

describe("the engine methods", () => {
  test("the four methods of the extended disasters, and the switch of the engine", () => {
    assert.deepEqual([...m.METHODS], ["disaster2_rules", "set_disaster2_rules", "trigger_disaster", "disaster2_stats"]);
    assert.equal(m.supportsDisasters(new MockCity(1)), false);
    assert.equal(m.supportsDisasters(new MockCity(1, { disasters2: true })), true);
    assert.equal(m.supportsDisasters(null), false);
    assert.equal(m.readDisastersOn(new MockCity(1)), false);
    assert.equal(m.readDisastersOn(new MockCity(1, { disasters2: true })), false, "off by default");
    const city = new MockCity(1, { disasters2: true });
    city.set_disaster2_rules(true);
    assert.equal(m.readDisastersOn(city), true);
  });

  test("a partial engine is not supported", () => {
    const city = new MockCity(1, { disasters2: true });
    city.trigger_disaster = undefined;
    assert.equal(m.supportsDisasters(city), false);
    assert.equal(m.readDisastersOn(city), false);
  });
});

describe("the four triggers", () => {
  test("kinds 1 to 4, with the French buttons, names and messages", () => {
    assert.deepEqual(m.TRIGGERS.map((t) => t.kind), [1, 2, 3, 4]);
    assert.deepEqual(m.TRIGGERS.map((t) => t.label), [
      "Déclencher une émeute", "Déclencher un OVNI", "Déclencher une météorite", "Déclencher une sécheresse",
    ]);
    assert.deepEqual(m.TRIGGERS.map((t) => t.name), ["Émeute", "OVNI", "Météorite", "Sécheresse"]);
    assert.equal(m.triggerOf(3).name, "Météorite");
    assert.equal(m.triggerOf(0), undefined);
    assert.equal(m.triggerOf(5), undefined);
  });

  test("the trigger texts: done, rule off, impossible; anything else is empty", () => {
    assert.equal(m.triggerText(m.TRIGGER.DONE, 3), "Météorite déclenchée.");
    assert.equal(m.triggerText(m.TRIGGER.DONE, 2), "OVNI déclenché.");
    assert.equal(m.triggerText(m.TRIGGER.RULE_OFF, 1), m.RULE_OFF_TEXT);
    assert.equal(m.triggerText(m.TRIGGER.IMPOSSIBLE, 1), m.IMPOSSIBLE_TEXT);
    assert.equal(m.triggerText(7, 1), "");
    assert.equal(m.triggerText(1, 9), "", "an unknown kind has no text");
  });

  test("the codes are the engine's", () => {
    assert.deepEqual({ ...m.TRIGGER }, { DONE: 1, RULE_OFF: 0, IMPOSSIBLE: -1 });
  });
});

describe("decodeDisasterStats", () => {
  test("drought months, last kind and place", () => {
    assert.deepEqual(m.decodeDisasterStats(Int32Array.of(7, 3, 40, 22)), {
      droughtMonths: 7, last: 3, place: { x: 40, y: 22 },
    });
  });

  test("no place when a coordinate is negative (a drought has none)", () => {
    assert.deepEqual(m.decodeDisasterStats(Int32Array.of(12, 4, -1, -1)).place, null);
    assert.deepEqual(m.decodeDisasterStats(Int32Array.of(0, 1, -1, 5)).place, null);
  });

  test("nothing yet: no drought, no last disaster", () => {
    assert.deepEqual(m.decodeDisasterStats(Int32Array.of(0, 0, -1, -1)), {
      droughtMonths: 0, last: 0, place: null,
    });
  });

  test("bad values count as 0 (a negative drought, a kind out of 0..4, a non-number)", () => {
    const d = m.decodeDisasterStats([-3, 9, "x", 4]);
    assert.equal(d.droughtMonths, 0);
    assert.equal(d.last, 0, "a kind out of the list is none");
    assert.deepEqual(d.place, { x: 0, y: 4 }, "a non-numeric x counts as 0, so the place is (0, 4)");
  });

  test("a missing array gives the empty statistics; extra values are not read", () => {
    assert.deepEqual(m.decodeDisasterStats(undefined), { droughtMonths: 0, last: 0, place: null });
    assert.deepEqual(m.decodeDisasterStats([2, 2, 1, 1, 99, 99]), { droughtMonths: 2, last: 2, place: { x: 1, y: 1 } });
    assert.equal(m.STAT_COUNT, 4);
  });
});

describe("the French lines", () => {
  test("the drought line: the months left, singular and plural, or no drought", () => {
    assert.equal(m.droughtLine(7), "Sécheresse : 7 mois restants");
    assert.equal(m.droughtLine(1), "Sécheresse : 1 mois restant");
    assert.equal(m.droughtLine(0), "Pas de sécheresse");
    assert.equal(m.droughtLine(-4), "Pas de sécheresse");
    assert.equal(m.droughtLine(1200), `Sécheresse : 1${NNBSP}200 mois restants`);
  });

  test("the last disaster line: the name, with the place when there is one", () => {
    assert.equal(
      m.lastDisasterLine({ last: 3, place: { x: 40, y: 22 } }),
      "Dernière catastrophe : Météorite en (40, 22)",
    );
    assert.equal(m.lastDisasterLine({ last: 4, place: null }), "Dernière catastrophe : Sécheresse");
    assert.equal(m.lastDisasterLine({ last: 1, place: { x: 0, y: 0 } }), "Dernière catastrophe : Émeute en (0, 0)");
    assert.equal(m.lastDisasterLine({ last: 2, place: null }), "Dernière catastrophe : OVNI");
    assert.equal(m.lastDisasterLine({ last: 0, place: null }), m.NO_LAST_TEXT);
  });

  test("the statistics are two lines, in order", () => {
    const stats = m.decodeDisasterStats(Int32Array.of(7, 3, 40, 22));
    assert.deepEqual(m.disasterStatsLines(stats), [
      "Sécheresse : 7 mois restants",
      "Dernière catastrophe : Météorite en (40, 22)",
    ]);
    assert.deepEqual(m.disasterStatsLines(m.decodeDisasterStats([])), ["Pas de sécheresse", m.NO_LAST_TEXT]);
  });

  test("the notes say what the rule does, on and off", () => {
    assert.match(m.disasterNoteText(true), /au hasard, ou à la demande/);
    assert.equal(m.disasterNoteText(false), "Désactivé : seules les catastrophes classiques existent.");
    assert.equal(m.DISASTERS_RULE_LABEL, "Catastrophes étendues");
    assert.equal(m.HEADING, "Catastrophes et autoroutes");
  });
});
