// Tests of the pure «Circulation simulée» model (web/agents-model.js): the engine's records, the
// French texts and the number formatting.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  NOTE, REQUIRED, STATS_LEN, SWITCH_LABEL, TITLE, decodeStats, formatCount, statsLines, stateText, supports,
} from "../agents-model.js";

const norm = (s) => s.replace(/[  ]/g, " ");

describe("agents model", () => {
  test("names the engine methods the panel needs", () => {
    assert.deepEqual(REQUIRED, ["agent_rules", "set_agent_rules", "agent_stats"]);
    assert.equal(STATS_LEN, 5);
    assert.equal(TITLE, "Circulation simulée");
    assert.equal(SWITCH_LABEL, "Activer la circulation simulée");
    assert.match(NOTE, /bouchons/);
  });

  test("supports() needs every method, and nothing else", () => {
    const full = { agent_rules() {}, set_agent_rules() {}, agent_stats() {} };
    assert.equal(supports(full), true);
    assert.equal(supports({ ...full, agent_stats: undefined }), false);
    assert.equal(supports({ agent_rules() {}, set_agent_rules() {} }), false);
    assert.equal(supports(undefined), false);
    assert.equal(supports(null), false);
  });

  test("decodes the five numbers of agent_stats by position", () => {
    assert.deepEqual(decodeStats(Int32Array.of(12, 340, 42, 3, 5678)), {
      activeCars: 12, finishedTrips: 340, meanTripTicks: 42, saturatedTiles: 3, motorisedResidents: 5678,
    });
  });

  test("a missing, empty or short array gives zeros for the missing values", () => {
    const zeros = { activeCars: 0, finishedTrips: 0, meanTripTicks: 0, saturatedTiles: 0, motorisedResidents: 0 };
    assert.deepEqual(decodeStats(undefined), zeros);
    assert.deepEqual(decodeStats(null), zeros);
    assert.deepEqual(decodeStats(new Int32Array()), zeros);
    assert.deepEqual(decodeStats(Int32Array.of(7, 8)), { ...zeros, activeCars: 7, finishedTrips: 8 });
  });

  test("formats counts with the French locale and keeps a bad value at zero", () => {
    assert.equal(norm(formatCount(0)), "0");
    assert.equal(norm(formatCount(1234567)), "1 234 567");
    assert.equal(formatCount(undefined), "0");
    assert.equal(formatCount(Number.NaN), "0");
  });

  test("the stats list has the five French labels in order, the mean trip in ticks", () => {
    const lines = statsLines(decodeStats(Int32Array.of(12, 1234, 42, 0, 9000)));
    assert.deepEqual(lines.map(([label]) => label), [
      "Voitures en route",
      "Trajets terminés",
      "Durée moyenne d'un trajet",
      "Tuiles saturées",
      "Habitants motorisés",
    ]);
    const values = lines.map(([, value]) => norm(value));
    assert.deepEqual(values, ["12", "1 234", "42 pas", "0", "9 000"]);
  });

  test("statsLines without stats shows zeros", () => {
    const values = statsLines(undefined).map(([, v]) => norm(v));
    assert.deepEqual(values, ["0", "0", "0 pas", "0", "0"]);
  });

  test("the state text says what the switch does", () => {
    assert.equal(stateText(true), "Activée : les voitures roulent sur les routes.");
    assert.equal(stateText(false), "Désactivée : aucune voiture ne circule.");
  });
});
