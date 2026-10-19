// Tests of the pure «Circulation simulée» model (web/agents-model.js): the engine's records, the
// French texts and the number formatting.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  NOTE, RAIL_LEN, REQUIRED, STATS_LEN, SWITCH_LABEL, TITLE, decodeRail, decodeStats, formatCount, railLines,
  statsLines, stateText, supports, supportsRail,
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

// ---- rail_stats (docs/game-design-v06.md): seven numbers, the train and metro rows ----

const ZERO_RAIL = Object.freeze({ trains: 0, rames: 0, trainRiders: 0, metroRiders: 0, railIncome: 0, trainLines: 0, metroLines: 0 });

describe("rail_stats records", () => {
  test("seven numbers, named in order", () => {
    assert.equal(RAIL_LEN, 7);
    assert.deepEqual(decodeRail(Int32Array.of(2, 1, 340, 120, 900, 1, 1)), {
      trains: 2, rames: 1, trainRiders: 340, metroRiders: 120, railIncome: 900, trainLines: 1, metroLines: 1,
    });
  });

  test("a missing, empty or short array gives zeros for the missing values", () => {
    assert.deepEqual(decodeRail(null), ZERO_RAIL);
    assert.deepEqual(decodeRail([]), ZERO_RAIL);
    assert.deepEqual(decodeRail(Int32Array.of(3, 4)), { ...ZERO_RAIL, trains: 3, rames: 4 });
  });

  test("garbage values read as 0 and never throw", () => {
    assert.deepEqual(decodeRail([NaN, "x", undefined, {}, null, 1.5, 2]), { ...ZERO_RAIL, trainLines: 1, metroLines: 2 });
  });

  test("supportsRail: a function named rail_stats; no method means no rail rows", () => {
    assert.equal(supportsRail({ rail_stats: () => [] }), true);
    assert.equal(supportsRail({}), false);
    assert.equal(supportsRail(null), false);
  });
});

describe("rail rows", () => {
  test("five rows, labels and values in order, the income in dollars", () => {
    const rows = railLines(decodeRail(Int32Array.of(2, 1, 340, 120, 900, 1, 1)));
    assert.deepEqual(rows, [
      ["Trains", "2"],
      ["Rames de métro", "1"],
      ["Voyageurs en train ce mois", "340"],
      ["Voyageurs en métro ce mois", "120"],
      ["Recettes du rail", "900 $"],
    ]);
  });

  test("thousands are grouped in French", () => {
    const rows = railLines(decodeRail(Int32Array.of(0, 0, 1234, 0, 1500, 0, 0)));
    assert.equal(norm(rows[2][1]), "1 234");
    assert.equal(norm(rows[4][1]), "1 500 $");
  });

  test("no argument shows zeros", () => {
    assert.deepEqual(railLines(), railLines(decodeRail()));
    assert.equal(railLines()[4][1], "0 $");
  });
});
