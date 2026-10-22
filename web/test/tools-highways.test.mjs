// The highway tool module (web/tools-highways.js) through the registry (extra-tools.js) and the palette (tools.js),
// against the mock engine (highways: true). Roads are placed through the mock's road tool.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as tools from "../tools-highways.js";
import { extraCatalog, extraCalls, extraLabel, extraBlockedReason, isExtraTool } from "../extra-tools.js";
import { readCatalog, callsFor, groupCatalog } from "../tools.js";
import { MockCity, MOCK_TOOLS, RESULT } from "./mock-engine.mjs";
import { HIGHWAY_COST } from "./mock-highways.mjs";

const ROAD = MOCK_TOOLS.findIndex((t) => t.key === "road");
const withHighways = (options = {}) => new MockCity(1, { highways: true, rubble: 0, ...options });
// A city with the highways rule on and a road along y = 10, from x = 20 to x = 30 (each road costs 10 $).
function onWithRoad(options = {}) {
  const city = withHighways(options);
  city.set_highway_rules(true);
  for (let x = 20; x <= 30; x++) city.tool_down(ROAD, x, 10);
  return city;
}
const entryOf = (city) => tools.catalog(city)[0];

describe("catalog", () => {
  test("one entry «Autoroute», in the group of the roads, of kind highways", () => {
    const [e] = tools.catalog(withHighways());
    assert.equal(tools.catalog(withHighways()).length, 1);
    assert.equal(e.id, "highway");
    assert.equal(e.key, "highway");
    assert.equal(e.label, "Autoroute");
    assert.equal(e.kind, tools.KIND);
    assert.equal(tools.KIND, "highways");
    assert.equal(e.group, "reseaux");
    assert.equal(e.groupLabel, "Réseaux");
    assert.equal(e.size, 1, "a footprint of 1x1");
    assert.equal(e.shortcut, null);
    assert.equal(e.costText, "au survol", "the price is the engine's, shown on hover");
  });

  test("empty without the highways, and it does not depend on the rule", () => {
    assert.deepEqual(tools.catalog(new MockCity(1)), []);
    assert.equal(tools.catalog(withHighways()).length, 1);
    assert.equal(tools.catalog(onWithRoad()).length, 1);
  });
});

describe("engine calls", () => {
  test("footprint is the clicked tile, 1x1", () => {
    const city = onWithRoad();
    const c = tools.calls(city, entryOf(city));
    assert.deepEqual([...c.footprint(4, 7)], [4, 7, 1, 1]);
  });

  test("preview: the rule off refuses every tile at no cost, a road is allowed at the price", () => {
    const city = withHighways();
    for (let x = 20; x <= 30; x++) city.tool_down(ROAD, x, 10);
    const c = tools.calls(city, entryOf(city));
    assert.deepEqual([...c.preview(20, 10)], [RESULT.FAILED, 0]);
    city.set_highway_rules(true);
    const before = city.funds();
    assert.deepEqual([...c.preview(20, 10)], [RESULT.OK, HIGHWAY_COST]);
    assert.equal(city.funds(), before, "a preview charges nothing");
  });

  test("down places a highway on a road and charges the price; a non-road tile is refused", () => {
    const city = onWithRoad();
    const c = tools.calls(city, entryOf(city));
    const before = city.funds();
    assert.equal(c.down(20, 10), RESULT.OK);
    assert.equal(city.funds(), before - HIGHWAY_COST);
    assert.deepEqual([...city.highway_stats()], [1, 1]);
    assert.equal(c.down(20, 5), RESULT.FAILED, "no road there");
    assert.equal(city.funds(), before - HIGHWAY_COST);
  });

  test("a drag places along the line from the tile after the start, and returns the stroke's result", () => {
    const city = onWithRoad();
    const c = tools.calls(city, entryOf(city));
    const before = city.funds();
    assert.equal(c.down(20, 10), RESULT.OK);
    assert.equal(c.drag(20, 10, 24, 10), RESULT.OK);
    assert.deepEqual([...city.highway_stats()], [5, 5], "the start tile was placed by down, then four more");
    assert.equal(city.funds(), before - 5 * HIGHWAY_COST);
  });

  test("a drag over roads already highways, or with no money, reports the engine's summary", () => {
    const city = onWithRoad();
    const c = tools.calls(city, entryOf(city));
    c.drag(20, 10, 22, 10);
    assert.equal(c.drag(20, 10, 22, 10), RESULT.FAILED, "every tile refused, the last code is returned");
    const poor = onWithRoad({ funds: 120 }); // the 11 roads take 110 $: 10 $ left, not enough for a highway
    assert.equal(tools.calls(poor, entryOf(poor)).drag(20, 10, 24, 10), RESULT.NO_MONEY);
  });

  test("a diagonal drag across the corner of an L-shaped road places the corner and every tile", () => {
    // L-shaped road: y = 5 from x = 10 to 15, then x = 15 from y = 5 to 7 (the corner is (15, 5)).
    // The drag from (14, 5) to (15, 7) steps (15, 5), (15, 6), (15, 7): every one is a road.
    const city = withHighways();
    city.set_highway_rules(true);
    for (let x = 10; x <= 15; x++) city.tool_down(ROAD, x, 5);
    for (let y = 6; y <= 7; y++) city.tool_down(ROAD, 15, y);
    const c = tools.calls(city, entryOf(city));
    assert.equal(c.down(14, 5), RESULT.OK);
    assert.equal(c.drag(14, 5, 15, 7), RESULT.OK);
    assert.equal(city.highway_stats()[0], 4, "the start, then the corner and the two tiles after it");
    const layer = city.highway_layer(); // the default map: 40 x 30, index x * 30 + y
    for (const [x, y] of [[14, 5], [15, 5], [15, 6], [15, 7]]) {
      assert.equal(layer[x * 30 + y], 1, `highway on (${x}, ${y})`);
    }
    assert.equal(layer[10 * 30 + 5], 0, "a road tile the drag never crossed has no highway");
  });

  test("a drag stops at the line cap", () => {
    const city = new MockCity(1, { highways: true, rubble: 0, width: 300, height: 20 });
    city.set_highway_rules(true);
    // a road along y = 15, clear of the lake (x 3..9, y 3..7 of the mock)
    for (let x = 0; x < 300; x++) city.tool_down(ROAD, x, 15);
    const c = tools.calls(city, entryOf(city));
    c.drag(0, 15, 299, 15);
    assert.equal(city.highway_stats()[0], 256, "HIGHWAY_DRAG_MAX tiles at most");
  });

  test("null for an entry of another module, an engine entry, or without the highways", () => {
    const city = onWithRoad();
    assert.equal(tools.calls(city, { kind: "zoning", id: "zoning:r:leger" }), null);
    assert.equal(tools.calls(city, { id: "road" }), null, "an engine entry has no kind");
    assert.equal(tools.calls(city, undefined), null);
    assert.equal(tools.calls(new MockCity(1), { kind: tools.KIND }), null);
  });
});

describe("label", () => {
  test("undefined (the default cost) for an allowed tile and for a charged refusal", () => {
    assert.equal(tools.label([RESULT.OK, HIGHWAY_COST]), undefined);
    assert.equal(tools.label([RESULT.NO_MONEY, HIGHWAY_COST]), undefined);
    assert.equal(tools.label(undefined), undefined);
  });

  test("the reason of a refused tile (the engine gives it a cost of 0)", () => {
    assert.equal(tools.label([RESULT.FAILED, 0]), "Impossible ici : posez-la sur une route");
    assert.equal(tools.label([RESULT.NEED_BULLDOZE, 0]), "Terrain à dégager");
    assert.equal(tools.label([-2, 0]), "Fonds insuffisants");
    assert.equal(tools.label([42, 0]), "Impossible ici : posez-la sur une route", "an unknown code is a failure");
  });
});

describe("blockedReason", () => {
  test("«Activez les autoroutes» while the rule is off, «» when on", () => {
    const city = withHighways();
    assert.equal(tools.blockedReason(city), "Activez les autoroutes");
    city.set_highway_rules(true);
    assert.equal(tools.blockedReason(city), "");
    assert.equal(tools.blockedReason(new MockCity(1)), "", "no tool, no reason");
  });
});

describe("through the registry and the palette", () => {
  test("the entry goes to this module, the registry blocks it while the rule is off", () => {
    const city = withHighways();
    const [entry] = extraCatalog(city).filter((e) => e.kind === "highways");
    assert.equal(isExtraTool(entry), true);
    assert.equal(extraLabel(entry, Int32Array.of(RESULT.FAILED, 0)), "Impossible ici : posez-la sur une route");
    assert.equal(extraBlockedReason(entry, city, { in3d: false, flags: {} }), "Activez les autoroutes");
    city.set_highway_rules(true);
    assert.equal(extraBlockedReason(entry, city, { in3d: false, flags: {} }), "");
    assert.deepEqual([...extraCalls(city, entry).footprint(3, 4)], [3, 4, 1, 1]);
  });

  test("callsFor sends the highway to its module", () => {
    const city = onWithRoad();
    const entry = extraCatalog(city).find((e) => e.id === "highway");
    assert.deepEqual([...callsFor(city, entry).preview(20, 10)], [RESULT.OK, HIGHWAY_COST]);
  });

  test("the palette lists it under «Réseaux», next to the engine's roads", () => {
    const city = onWithRoad();
    const group = groupCatalog([...readCatalog(city), ...extraCatalog(city)]).find((g) => g.id === "reseaux");
    assert.ok(group.tools.some((t) => t.id === "highway"));
    assert.ok(group.tools.some((t) => t.key === "road"));
  });
});
