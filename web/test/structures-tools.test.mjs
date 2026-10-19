// Extended buildings on the page: the pure model (structures-model.js), the tool module
// (tools-structures.js) and the registry, against the mock engine (web/test/mock-engine.mjs).
// The real wasm contract is covered by the wasm tests of the core workstream.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as model from "../structures-model.js";
import * as tools from "../tools-structures.js";
import { extraCatalog, extraCalls, extraBlockedReason, extraLabel, isExtraTool } from "../extra-tools.js";
import { MockCity, MOCK_STRUCTURES, RESULT } from "./mock-engine.mjs";

// A mock engine with the buildings (the option of the mock: without it there are none).
const withBuildings = (seed = 1, options = {}) => new MockCity(seed, { ...options, structures: true });

// A record list of the catalog, as the engine sends it: [genre, w, h, cost, upkeep, flags, radius, effect].
const REC = (genre, w, h, cost, upkeep) => [genre, w, h, cost, upkeep, 0, 4, 1];

describe("feature detection and the rule flag", () => {
  test("the buildings need all seven engine methods", () => {
    assert.equal(model.supportsStructures(withBuildings(1)), true);
    assert.equal(model.supportsStructures(new MockCity(1)), false, "an engine without the buildings");
    assert.equal(model.supportsStructures({}), false);
    assert.equal(model.supportsStructures(null), false);
    for (const m of ["structure_rules", "set_structure_rules", "structure_catalog", "structures",
      "structure_preview", "place_structure", "remove_structure"]) {
      const city = withBuildings(1);
      city[m] = undefined;
      assert.equal(model.supportsStructures(city), false, `without ${m}`);
    }
  });

  test("the flag is read from the engine, off by default and false without the buildings", () => {
    const city = withBuildings(1);
    assert.equal(model.readStructureRules(city), false);
    city.set_structure_rules(true);
    assert.equal(model.readStructureRules(city), true);
    assert.equal(model.readStructureRules({}), false);
  });
});

describe("the catalog records", () => {
  test("eight numbers per record, in the order of the contract", () => {
    const [a, b] = model.decodeCatalog(Int32Array.of(...REC(1, 2, 2, 200, 5), ...REC(3, 3, 3, 1000, 20)));
    assert.deepEqual(a, { genre: 1, width: 2, height: 2, cost: 200, upkeep: 5, flags: 0, radius: 4, effect: 1 });
    assert.equal(b.genre, 3);
    assert.equal(b.upkeep, 20);
  });

  test("a trailing partial record and a record with no room are ignored", () => {
    const records = Int32Array.of(...REC(1, 2, 2, 200, 5), ...REC(2, 0, 1, 100, 2), 9, 9, 9);
    assert.deepEqual(model.decodeCatalog(records).map((r) => r.genre), [1]);
    assert.deepEqual(model.decodeCatalog(Int32Array.of(...REC(2, 1, -1, 100, 2))), []);
  });

  test("an empty, missing or plain-array catalog decodes too", () => {
    assert.deepEqual(model.decodeCatalog(Int32Array.of()), []);
    assert.deepEqual(model.decodeCatalog(undefined), []);
    assert.deepEqual(model.decodeCatalog(null), []);
    assert.equal(model.decodeCatalog([...REC(2, 1, 1, 100, 2)]).length, 1);
  });

  test("the decoding is capped at MAX_CATALOG_RECORDS records", () => {
    assert.equal(model.MAX_CATALOG_RECORDS, 32);
    const many = [];
    for (let g = 1; g <= 40; g++) many.push(...REC(g, 1, 1, 10, 1));
    assert.equal(model.decodeCatalog(Int32Array.from(many)).length, model.MAX_CATALOG_RECORDS);
    assert.equal(model.decodeCatalog(Int32Array.from(many)).at(-1).genre, model.MAX_CATALOG_RECORDS);
  });

  test("the French names, and a number for an unknown genre", () => {
    assert.equal(model.nameOf(1), "Parc urbain");
    assert.equal(model.nameOf(2), "Place publique");
    assert.equal(model.nameOf(3), "Monument");
    assert.equal(model.nameOf(9), "Bâtiment n° 9");
  });

  test("the upkeep line, with the sign and the monthly unit", () => {
    assert.equal(model.upkeepText(5), `+ ${(5).toLocaleString("fr-FR")} $/mois`);
    assert.equal(model.upkeepText(1000), `+ ${(1000).toLocaleString("fr-FR")} $/mois`);
    assert.match(model.upkeepText(0), /^\+ 0 \$\/mois$/u);
  });
});

describe("why the buildings are blocked", () => {
  test("rule off gives the rule message, whatever the view", () => {
    const city = withBuildings(1);
    assert.equal(model.structuresBlockedReason(city, { in3d: false }), model.RULE_OFF_MESSAGE);
    assert.equal(model.structuresBlockedReason(city, { in3d: true }), model.RULE_OFF_MESSAGE);
    assert.equal(model.RULE_OFF_MESSAGE, "Activez les bâtiments étendus pour construire.");
  });

  test("rule on: allowed in 2D, the 3D message in 3D", () => {
    const city = withBuildings(1);
    city.set_structure_rules(true);
    assert.equal(model.structuresBlockedReason(city, { in3d: false }), "");
    assert.equal(model.structuresBlockedReason(city, { in3d: true }), model.IN_3D_MESSAGE);
    assert.match(model.IN_3D_MESSAGE, /carte 2D/u);
  });

  test("an engine without the buildings has no building tool, so no reason", () => {
    assert.equal(model.structuresBlockedReason({}, { in3d: false }), "");
    assert.equal(model.structuresBlockedReason({}, { in3d: true }), "");
  });
});

describe("the tool module", () => {
  test("one entry per genre of the catalog, with the group, size, cost and upkeep", () => {
    const entries = tools.catalog(withBuildings(1));
    assert.deepEqual(entries.map((e) => e.id), ["structures:1", "structures:2", "structures:3"]);
    const [park, square, monument] = entries;
    assert.equal(park.label, "Parc urbain");
    assert.equal(park.key, "structure_1");
    assert.equal(park.group, "batiments");
    assert.equal(park.groupLabel, "Bâtiments");
    assert.equal(park.kind, tools.KIND);
    assert.equal(park.size, 2, "size is the larger side");
    assert.equal(park.cost, 200);
    assert.equal(park.costText, model.upkeepText(5));
    assert.equal(square.size, 1);
    assert.equal(monument.size, 3);
    assert.equal(monument.cost, 1000);
    assert.equal(monument.costText, model.upkeepText(20));
    assert.equal(park.shortcut, null);
  });

  test("the catalog is empty without the buildings, and does not depend on the flag", () => {
    assert.deepEqual(tools.catalog({}), []);
    assert.deepEqual(tools.catalog(new MockCity(1)), [], "an engine without the buildings");
    const city = withBuildings(1);
    assert.equal(tools.catalog(city).length, 3, "listed with the rule off: the button is disabled, not removed");
  });

  test("calls: the footprint starts at the clicked tile and covers the building", () => {
    const city = withBuildings(1);
    const [, , monument] = tools.catalog(city);
    const c = tools.calls(city, monument);
    assert.deepEqual([...c.footprint(4, 5)], [4, 5, 3, 3]);
    const [park] = tools.catalog(city);
    assert.deepEqual([...tools.calls(city, park).footprint(0, 0)], [0, 0, 2, 2]);
  });

  test("calls: preview and down go to the engine with the genre; a drag places nothing", () => {
    const city = withBuildings(1);
    city.set_structure_rules(true);
    const [, square] = tools.catalog(city);
    const c = tools.calls(city, square);
    assert.deepEqual([...c.preview(20, 20)], [RESULT.OK, 100]);
    assert.equal(c.down(20, 20), RESULT.OK);
    assert.equal(city.structures().length, 6, "one building placed");
    assert.equal(c.drag(0, 0, 9, 9), 0);
    assert.equal(city.structures().length, 6, "the drag placed nothing");
  });

  test("calls: null for another module's entry or without the buildings", () => {
    const city = withBuildings(1);
    assert.equal(tools.calls(city, { kind: "water", id: "water:pipe" }), null);
    assert.equal(tools.calls(city, null), null);
    assert.equal(tools.calls({}, { kind: tools.KIND, genre: 1, width: 2, height: 2 }), null);
  });

  test("the label is the default one", () => {
    assert.equal(tools.label(Int32Array.of(1, 100)), undefined);
  });

  test("blockedReason follows the flag and the view", () => {
    const city = withBuildings(1);
    assert.equal(tools.blockedReason(city, { in3d: false }), model.RULE_OFF_MESSAGE);
    city.set_structure_rules(true);
    assert.equal(tools.blockedReason(city, { in3d: false }), "");
    assert.equal(tools.blockedReason(city, { in3d: true }), model.IN_3D_MESSAGE);
    assert.equal(tools.blockedReason({}, { in3d: false }), "");
  });
});

describe("through the registry", () => {
  test("the building entries are extra tools, routed to this module", () => {
    const city = withBuildings(1);
    city.set_structure_rules(true);
    const entries = extraCatalog(city).filter((e) => e.kind === tools.KIND);
    assert.equal(entries.length, 3);
    for (const e of entries) {
      assert.equal(isExtraTool(e), true);
      assert.equal(typeof extraCalls(city, e).down, "function");
      assert.equal(extraLabel(e, Int32Array.of(1, 5)), undefined);
    }
    assert.equal(extraBlockedReason(entries[0], city, { in3d: false, flags: {} }), "");
    city.set_structure_rules(false);
    assert.equal(extraBlockedReason(entries[0], city, { in3d: false, flags: {} }), model.RULE_OFF_MESSAGE);
  });
});

describe("the mock engine's buildings", () => {
  test("off by default, and off again after a new city or a load", () => {
    const city = withBuildings(1);
    assert.equal(city.structure_rules(), false);
    assert.deepEqual([...city.structure_preview(2, 3, 3)], [0, 0]);
    assert.equal(city.place_structure(2, 3, 3), RESULT.FAILED);
    city.set_structure_rules(true);
    city.place_structure(2, 3, 3);
    city.new_random_city(7);
    assert.equal(city.structure_rules(), false);
    assert.equal(city.structures().length, 0, "a new city has no building");
    city.set_structure_rules(true);
    city.place_structure(2, 3, 3);
    city.load_cty();
    assert.equal(city.structure_rules(), false);
    assert.equal(city.structures().length, 0, "a load has no building");
  });

  test("the catalog lists the three genres of the milestone, in eight numbers each", () => {
    const records = [...withBuildings(1).structure_catalog()];
    assert.equal(records.length, MOCK_STRUCTURES.length * model.RECORD_LENGTH);
    assert.deepEqual(model.decodeCatalog(records).map((r) => [r.genre, r.width, r.height, r.cost, r.upkeep]),
      [[1, 2, 2, 200, 5], [2, 1, 1, 100, 2], [3, 3, 3, 1000, 20]]);
  });

  test("a placement is checked, charged and listed in the records", () => {
    const city = withBuildings(1);
    city.set_structure_rules(true);
    const funds = city.funds();
    assert.deepEqual([...city.structure_preview(1, 10, 10)], [RESULT.OK, 200]);
    assert.equal(city.place_structure(1, 10, 10), RESULT.OK);
    assert.equal(city.funds(), funds - 200);
    assert.deepEqual([...city.structures()], [1, 10, 10, 2, 2, 0]);
    assert.equal(city.structures_upkeep(), 5);
  });

  test("a footprint cannot overlap a building, nor leave the map", () => {
    const city = withBuildings(1, { width: 10, height: 10 });
    city.set_structure_rules(true);
    city.place_structure(1, 2, 2); // covers 2..3 x 2..3
    assert.equal(city.structure_preview(2, 3, 3)[0], RESULT.FAILED, "a tile of the first building");
    assert.equal(city.structure_preview(2, 1, 0)[0], RESULT.OK, "next to it is free");
    assert.equal(city.structure_preview(3, 8, 8)[0], RESULT.FAILED, "the 3x3 leaves the map");
    assert.equal(city.structure_preview(1, 9, 9)[0], RESULT.FAILED, "the 2x2 leaves the map");
    assert.equal(city.structure_preview(1, -1, 0)[0], RESULT.FAILED, "off the map");
  });

  test("water refuses, rubble asks for a bulldozer, a poor city gets no money", () => {
    const city = withBuildings(1, { rubble: 0 });
    city.set_structure_rules(true);
    assert.equal(city.structure_preview(2, 4, 4)[0], RESULT.FAILED, "water tile of the mock lake");
    // a rubble tile of a map with rubble: the 1x1 building stops on it
    const rubbled = withBuildings(1, { rubble: 60 });
    rubbled.set_structure_rules(true);
    const tiles = rubbled.tiles();
    const i = tiles.indexOf(44);
    assert.notEqual(i, -1, "the mock map has rubble");
    const x = Math.floor(i / 30), y = i % 30;
    assert.equal(rubbled.structure_preview(2, x, y)[0], RESULT.NEED_BULLDOZE);
    assert.equal(rubbled.place_structure(2, x, y), RESULT.NEED_BULLDOZE);
    const poor = withBuildings(1, { funds: 50, rubble: 0 });
    poor.set_structure_rules(true);
    assert.equal(poor.structure_preview(2, 30, 25)[0], RESULT.NO_MONEY);
    assert.equal(poor.place_structure(2, 30, 25), RESULT.NO_MONEY);
    assert.equal(poor.structures().length, 0);
  });

  test("removing takes a building by any of its tiles, with no refund", () => {
    const city = withBuildings(1, { rubble: 0 });
    city.set_structure_rules(true);
    city.place_structure(3, 10, 10); // covers 10..12 x 10..12
    const funds = city.funds();
    assert.equal(city.remove_structure(12, 11), RESULT.OK);
    assert.equal(city.structures().length, 0);
    assert.equal(city.funds(), funds, "no refund");
    assert.equal(city.remove_structure(12, 11), RESULT.FAILED, "nothing left there");
  });

  test("turning the rule off removes every building, with no refund (and on again starts empty)", () => {
    const city = withBuildings(1, { rubble: 0 });
    city.set_structure_rules(true);
    assert.equal(city.place_structure(1, 10, 10), RESULT.OK);
    assert.equal(city.place_structure(3, 20, 20), RESULT.OK);
    const funds = city.funds();
    assert.equal(city.structures().length, 12, "two buildings (6 numbers each) listed before the switch-off");
    city.set_structure_rules(false);
    assert.equal(city.structures().length, 0, "no building left");
    assert.equal(city.structures_upkeep(), 0, "no upkeep left");
    assert.equal(city.funds(), funds, "no refund");
    city.set_structure_rules(true);
    assert.equal(city.structures().length, 0, "the rule back on does not bring them back");
  });

  test("the upkeep is the sum of the monthly upkeep of the placed buildings", () => {
    const city = withBuildings(1);
    city.set_structure_rules(true);
    assert.equal(city.structures_upkeep(), 0);
    city.place_structure(1, 10, 10);
    city.place_structure(2, 20, 20);
    city.place_structure(3, 25, 25);
    assert.equal(city.structures_upkeep(), 5 + 2 + 20);
  });
});
