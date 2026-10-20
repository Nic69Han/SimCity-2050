// Transport of v0.5 on the page (docs/game-design-v05.md): the French names of the genres 10-12, the
// transport records and rows (web/agents-model.js), and the mock's transport answers and transit genres
// (web/test/mock-engine.mjs). Pure: no DOM, no engine.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as structures from "../structures-model.js";
import * as agents from "../agents-model.js";
import { MockCity, MOCK_TRANSIT_STRUCTURES, MOCK_STRUCTURES, TRANSPORT_FIXED, RESULT } from "./mock-engine.mjs";

const norm = (s) => s.replace(/[\s  ]/g, " ");

describe("names of the transport genres", () => {
  test("genres 10, 11 and 12 have their French names", () => {
    assert.equal(structures.nameOf(10), "Arrêt de bus");
    assert.equal(structures.nameOf(11), "Dépôt de bus");
    assert.equal(structures.nameOf(12), "Dépôt de taxis");
  });

  test("genre 13 is the rail station, Gare (docs/game-design-v06.md)", () => {
    assert.equal(structures.nameOf(13), "Gare");
  });

  test("the v0.4 names are unchanged, and an unknown genre still gets its number", () => {
    assert.equal(structures.nameOf(1), "Parc urbain");
    assert.equal(structures.nameOf(3), "Monument");
    assert.equal(structures.nameOf(14), "Bâtiment n° 14");
    assert.equal(structures.nameOf(4), "Bâtiment n° 4");
  });

  test("the names table lists exactly the known genres (the waste genres 20-23 since v0.8)", () => {
    assert.deepEqual(Object.keys(structures.NAMES).map(Number), [1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23]);
  });
});

describe("transport records", () => {
  test("six numbers, named in order", () => {
    assert.equal(agents.TRANSPORT_LEN, 6);
    assert.deepEqual(agents.decodeTransport(Int32Array.of(2, 1, 25, 340, 60, 1200)), {
      buses: 2, taxis: 1, waiting: 25, busTrips: 340, taxiRides: 60, income: 1200,
    });
  });

  test("a missing, empty or short array gives zeros for the missing values", () => {
    const zeros = { buses: 0, taxis: 0, waiting: 0, busTrips: 0, taxiRides: 0, income: 0 };
    assert.deepEqual(agents.decodeTransport(undefined), zeros);
    assert.deepEqual(agents.decodeTransport(null), zeros);
    assert.deepEqual(agents.decodeTransport(new Int32Array()), zeros);
    assert.deepEqual(agents.decodeTransport(Int32Array.of(4, 3)), { ...zeros, buses: 4, taxis: 3 });
  });

  test("supportsTransport is true only with the method", () => {
    assert.equal(agents.supportsTransport({ transport_stats() {} }), true);
    assert.equal(agents.supportsTransport({}), false);
    assert.equal(agents.supportsTransport(undefined), false);
    assert.equal(agents.supportsTransport({ transport_stats: 3 }), false);
  });
});

describe("transport rows", () => {
  test("six French rows in order; the income in dollars", () => {
    const rows = agents.transportLines(agents.decodeTransport(Int32Array.of(2, 1, 25, 1234, 60, 5400)));
    assert.deepEqual(rows.map(([label]) => label), [
      "Bus en service",
      "Taxis en service",
      "Voyageurs en attente",
      "Voyages en bus ce mois",
      "Courses de taxi ce mois",
      "Recettes des transports",
    ]);
    assert.deepEqual(rows.map(([, value]) => norm(value)), ["2", "1", "25", "1 234", "60", "5 400 $"]);
  });

  test("no transport record gives zero rows with the dollar sign kept", () => {
    const values = agents.transportLines(undefined).map(([, v]) => norm(v));
    assert.deepEqual(values, ["0", "0", "0", "0", "0", "0 $"]);
  });
});

describe("mock engine transport", () => {
  test("transport_stats is six zeros while the agents rule is off", () => {
    const city = new MockCity(1);
    assert.deepEqual([...city.transport_stats()], [0, 0, 0, 0, 0, 0]);
    city.set_agent_rules(true);
    city.set_agent_rules(false);
    assert.deepEqual([...city.transport_stats()], [0, 0, 0, 0, 0, 0]);
  });

  test("transport_stats gives the fixed numbers while the agents rule is on, and is six integers", () => {
    const city = new MockCity(1);
    city.set_agent_rules(true);
    const stats = city.transport_stats();
    assert.equal(stats.length, 6);
    assert.deepEqual([...stats], [...TRANSPORT_FIXED]);
    assert.deepEqual([...stats], [2, 1, 25, 340, 60, 1200]);
  });

  test("a new city or a load switches the answer back to zeros", () => {
    const city = new MockCity(1);
    city.set_agent_rules(true);
    city.new_random_city(3);
    assert.deepEqual([...city.transport_stats()], [0, 0, 0, 0, 0, 0]);
    city.set_agent_rules(true);
    city.load_cty();
    assert.deepEqual([...city.transport_stats()], [0, 0, 0, 0, 0, 0]);
  });
});

describe("mock engine transit genres", () => {
  test("the v0.4 catalog is unchanged without the transit option", () => {
    const decoded = structures.decodeCatalog(new MockCity(1, { structures: true }).structure_catalog());
    assert.deepEqual(decoded.map((r) => r.genre), MOCK_STRUCTURES.map((m) => m.genre));
    assert.deepEqual(decoded.map((r) => r.genre), [1, 2, 3]);
  });

  test("with structures and transit, the catalog adds genres 10 to 12 with their footprints", () => {
    const city = new MockCity(1, { structures: true, transit: true });
    const flat = [...city.structure_catalog()];
    assert.equal(flat.length, (MOCK_STRUCTURES.length + MOCK_TRANSIT_STRUCTURES.length) * 8);
    const transit = [];
    for (let i = 0; i < flat.length; i += 8) if (flat[i] >= 10) transit.push(flat.slice(i, i + 5));
    assert.deepEqual(transit, [[10, 1, 1, 50, 1], [11, 2, 2, 300, 8], [12, 2, 2, 400, 10]]);
  });

  test("the transit genres are placed and charged like the others, and counted in the upkeep", () => {
    const city = new MockCity(1, { structures: true, transit: true, rubble: 0 }); // no rubble on the way
    city.set_structure_rules(true);
    const before = city.funds();
    assert.equal(city.place_structure(10, 12, 12), RESULT.OK);
    assert.equal(city.place_structure(12, 20, 20), RESULT.OK);
    assert.equal(city.funds(), before - 50 - 400);
    assert.equal(city.structures_upkeep(), 1 + 10);
  });

  test("without the transit option a transit genre is refused", () => {
    const city = new MockCity(1, { structures: true });
    city.set_structure_rules(true);
    assert.equal(city.place_structure(10, 12, 12), RESULT.FAILED);
    assert.equal(city.structures().length, 0);
  });

  test("the transit option alone, without the structures option, has no buildings", () => {
    const city = new MockCity(1, { transit: true });
    assert.equal(city.structure_catalog, undefined);
  });
});
