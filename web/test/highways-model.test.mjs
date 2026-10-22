// Pure part of the highways on the page (web/highways-model.js): the engine methods, the statistics and their lines,
// the blocked reason and the drag line with its cap.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as m from "../highways-model.js";
import { MockCity } from "./mock-engine.mjs";

const NBSP = " ";
const NNBSP = " ";

describe("the engine methods", () => {
  test("the seven methods of the highways", () => {
    assert.deepEqual([...m.METHODS], [
      "highway_rules", "set_highway_rules", "highway_preview", "place_highway", "remove_highway", "highway_layer",
      "highway_stats",
    ]);
  });

  test("supported only with every method; the rule is off by default and read from the engine", () => {
    assert.equal(m.supportsHighways(new MockCity(1)), false);
    const city = new MockCity(1, { highways: true });
    assert.equal(m.supportsHighways(city), true);
    assert.equal(m.readHighwaysOn(city), false, "off by default");
    city.set_highway_rules(true);
    assert.equal(m.readHighwaysOn(city), true);
    city.highway_layer = undefined;
    assert.equal(m.supportsHighways(city), false);
    assert.equal(m.readHighwaysOn(city), false);
    assert.equal(m.readHighwaysOn(null), false);
  });
});

describe("decodeHighwayStats", () => {
  test("tiles and yearly upkeep", () => {
    assert.deepEqual(m.decodeHighwayStats(Int32Array.of(34, 34)), { tiles: 34, upkeep: 34 });
  });

  test("bad values count as 0, and only the first STAT_COUNT are read", () => {
    assert.deepEqual(m.decodeHighwayStats([-5, "x"]), { tiles: 0, upkeep: 0 });
    assert.deepEqual(m.decodeHighwayStats([3, 9, 100]), { tiles: 3, upkeep: 9 });
    assert.deepEqual(m.decodeHighwayStats(undefined), { tiles: 0, upkeep: 0 });
    assert.equal(m.STAT_COUNT, 2);
  });
});

describe("the highway lines", () => {
  test("«Autoroutes : 34 tuiles» and «Entretien : 34 $ par an»", () => {
    assert.deepEqual(m.highwayStatsLines({ tiles: 34, upkeep: 34 }), [
      "Autoroutes : 34 tuiles",
      `Entretien : 34${NBSP}$ par an`,
    ]);
  });

  test("one tile is singular, big numbers are grouped", () => {
    assert.equal(m.tilesText(1), "1 tuile");
    assert.equal(m.tilesText(0), "0 tuiles");
    assert.equal(m.tilesText(1500), `1${NNBSP}500 tuiles`);
  });

  test("the note says what the rule does, on and off", () => {
    assert.match(m.highwayNoteText(true), /divisée par deux/);
    assert.equal(m.highwayNoteText(false), "Désactivé : les autoroutes sont retirées, sans remboursement.");
  });
});

describe("highwaysBlockedReason", () => {
  test("«Activez les autoroutes» while the rule is off, «» when it is on", () => {
    const city = new MockCity(1, { highways: true });
    assert.equal(m.highwaysBlockedReason(city), m.BLOCKED_TEXT);
    assert.equal(m.BLOCKED_TEXT, "Activez les autoroutes");
    city.set_highway_rules(true);
    assert.equal(m.highwaysBlockedReason(city), "");
  });

  test("«» without the highways: there is no tool to block", () => {
    assert.equal(m.highwaysBlockedReason(new MockCity(1)), "");
  });
});

describe("highwayLine, the drag line", () => {
  test("the tiles after the start, along the line, ending on the target", () => {
    assert.deepEqual(m.highwayLine(2, 2, 5, 2), [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }]);
    assert.deepEqual(m.highwayLine(1, 1, 1, 1), []);
    const diag = m.highwayLine(0, 0, 2, 2);
    assert.deepEqual(diag.at(-1), { x: 2, y: 2 });
  });

  test("the line length is capped at HIGHWAY_DRAG_MAX tiles", () => {
    assert.equal(m.HIGHWAY_DRAG_MAX, 256);
    const long = m.highwayLine(0, 0, 1000, 0);
    assert.equal(long.length, m.HIGHWAY_DRAG_MAX);
    assert.deepEqual(long[0], { x: 1, y: 0 });
    assert.equal(m.highwayLine(0, 0, 255, 0).length, 255, "a line just under the cap is whole");
  });
});
