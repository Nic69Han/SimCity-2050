// The mock engine's highways and extended disasters (web/test/mock-highways.mjs, mock-disasters2.mjs, and the
// options of mock-engine.mjs): the rules documented in the mock's header hold, so the page tests can rely on them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MockCity, MOCK_TOOLS, RESULT } from "./mock-engine.mjs";
import { MockHighways, HIGHWAY_COST, HIGHWAY_UPKEEP, MOCK_ROAD, HIGHWAY_METHODS } from "./mock-highways.mjs";
import {
  MockDisasters2, DISASTER2_METHODS, KIND, MOCK_DROUGHT_MONTHS, TRIGGER_DONE, TRIGGER_RULE_OFF, TRIGGER_IMPOSSIBLE,
} from "./mock-disasters2.mjs";

const ROAD = MOCK_TOOLS.findIndex((t) => t.key === "road");
const city = (options = {}) => new MockCity(1, { highways: true, rubble: 0, ...options });
function roadFrom(c, x0, x1, y) {
  for (let x = x0; x <= x1; x++) c.tool_down(ROAD, x, y);
}

describe("options", () => {
  test("the highway methods are hidden unless the option is given, and so are the disasters'", () => {
    const bare = new MockCity(1);
    for (const name of [...HIGHWAY_METHODS, ...DISASTER2_METHODS]) assert.equal(bare[name], undefined, name);
    for (const name of HIGHWAY_METHODS) assert.equal(typeof city()[name], "function", name);
    for (const name of DISASTER2_METHODS) assert.equal(typeof city({ disasters2: true })[name], "function", name);
    assert.equal(city()[DISASTER2_METHODS[0]], undefined, "highways alone: no disasters");
  });

  test("the constants of the mock are the ones the docs name", () => {
    assert.equal(HIGHWAY_COST, 25);
    assert.equal(HIGHWAY_UPKEEP, 1);
    assert.equal(MOCK_ROAD, 64);
    assert.equal(MOCK_DROUGHT_MONTHS, 12);
    assert.deepEqual({ ...KIND }, { RIOT: 1, UFO: 2, METEOR: 3, DROUGHT: 4 });
    assert.deepEqual([TRIGGER_DONE, TRIGGER_RULE_OFF, TRIGGER_IMPOSSIBLE], [1, 0, -1]);
  });
});

describe("MockHighways (the state)", () => {
  test("off by default; the set of tiles, the layer and the stats", () => {
    const h = new MockHighways();
    assert.equal(h.rule(), false);
    h.setRule(true);
    h.add(1, 2);
    h.add(3, 0);
    assert.equal(h.has(1, 2), true);
    assert.equal(h.count(), 2);
    const layer = h.layer(4, 3);
    assert.equal(layer[1 * 3 + 2], 1);
    assert.equal(layer[3 * 3 + 0], 1);
    assert.equal(layer.reduce((a, b) => a + b, 0), 2);
    assert.deepEqual([...h.stats()], [2, 2 * HIGHWAY_UPKEEP]);
  });

  test("remove reports whether there was a highway; switching the rule off removes all, reset too", () => {
    const h = new MockHighways();
    h.setRule(true);
    h.add(0, 0);
    assert.equal(h.remove(0, 0), true);
    assert.equal(h.remove(0, 0), false);
    h.add(5, 5);
    h.setRule(false);
    assert.equal(h.count(), 0);
    h.setRule(true);
    h.add(1, 1);
    h.reset();
    assert.equal(h.rule(), false);
    assert.equal(h.count(), 0);
  });
});

describe("the highway methods of the mock engine", () => {
  test("the rule: off by default, on and off through the setter, read back", () => {
    const c = city();
    assert.equal(c.highway_rules(), false);
    c.set_highway_rules(true);
    assert.equal(c.highway_rules(), true);
  });

  test("a preview is [0, 0] while off, [OK, HIGHWAY_COST] on a road, [0, 0] elsewhere", () => {
    const c = city();
    roadFrom(c, 20, 22, 15);
    assert.deepEqual([...c.highway_preview(20, 15)], [RESULT.FAILED, 0], "rule off");
    c.set_highway_rules(true);
    assert.deepEqual([...c.highway_preview(20, 15)], [RESULT.OK, HIGHWAY_COST]);
    assert.deepEqual([...c.highway_preview(20, 5)], [RESULT.FAILED, 0], "no road");
    assert.deepEqual([...c.highway_preview(-1, 15)], [RESULT.FAILED, 0], "off the map");
    assert.deepEqual([...c.highway_preview(1000, 15)], [RESULT.FAILED, 0], "far off the map");
  });

  test("place_highway charges the price, refuses a second highway and a missing road, reports no money", () => {
    const c = city();
    roadFrom(c, 20, 21, 15);
    c.set_highway_rules(true);
    const before = c.funds();
    assert.equal(c.place_highway(20, 15), RESULT.OK);
    assert.equal(c.funds(), before - HIGHWAY_COST);
    assert.equal(c.place_highway(20, 15), RESULT.FAILED, "already a highway");
    assert.equal(c.place_highway(20, 5), RESULT.FAILED, "no road");
    assert.equal(c.funds(), before - HIGHWAY_COST, "refusals charge nothing");
    const poor = city({ funds: 10 });
    roadFrom(poor, 20, 20, 15);
    poor.set_highway_rules(true);
    assert.equal(poor.place_highway(20, 15), RESULT.NO_MONEY);
    assert.deepEqual([...poor.highway_preview(20, 15)], [RESULT.NO_MONEY, HIGHWAY_COST]);
  });

  test("remove_highway takes one up (1) or reports 0; the layer and the stats follow", () => {
    const c = city();
    roadFrom(c, 20, 21, 15);
    c.set_highway_rules(true);
    c.place_highway(20, 15);
    c.place_highway(21, 15);
    assert.deepEqual([...c.highway_stats()], [2, 2 * HIGHWAY_UPKEEP]);
    assert.equal(c.remove_highway(20, 15), RESULT.OK);
    assert.equal(c.remove_highway(20, 15), RESULT.FAILED);
    assert.deepEqual([...c.highway_stats()], [1, HIGHWAY_UPKEEP]);
    const layer = c.highway_layer();
    assert.equal(layer.length, c.width() * c.height());
    assert.equal(layer[21 * c.height() + 15], 1);
    assert.equal(layer[20 * c.height() + 15], 0);
  });

  test("the rule off removes every highway, with no refund; remove_highway is 0 while off", () => {
    const c = city();
    roadFrom(c, 20, 21, 15);
    c.set_highway_rules(true);
    c.place_highway(20, 15);
    const spent = c.funds();
    c.set_highway_rules(false);
    assert.equal(c.funds(), spent, "no refund");
    assert.deepEqual([...c.highway_stats()], [0, 0]);
    assert.equal(c.highway_layer().reduce((a, b) => a + b, 0), 0);
    assert.equal(c.remove_highway(20, 15), RESULT.FAILED);
  });

  test("a new city and a load switch the rule off and forget the highways", () => {
    const c = city();
    roadFrom(c, 20, 20, 15);
    c.set_highway_rules(true);
    c.place_highway(20, 15);
    c.new_random_city(7);
    assert.equal(c.highway_rules(), false);
    assert.deepEqual([...c.highway_stats()], [0, 0]);
    c.set_highway_rules(true);
    c.load_cty();
    assert.equal(c.highway_rules(), false);
  });
});

describe("MockDisasters2 (the state)", () => {
  test("off by default; a trigger while off answers rule off", () => {
    const d = new MockDisasters2();
    assert.equal(d.trigger(KIND.RIOT, 40, 30), TRIGGER_RULE_OFF);
    assert.deepEqual([...d.stats()], [0, 0, -1, -1]);
  });

  test("riot, UFO and meteorite at the map centre; a drought with no place and 12 months", () => {
    const d = new MockDisasters2();
    d.setRule(true);
    assert.equal(d.trigger(KIND.METEOR, 40, 30), TRIGGER_DONE);
    assert.deepEqual([...d.stats()], [0, 3, 20, 15]);
    assert.equal(d.trigger(KIND.UFO, 41, 31), TRIGGER_DONE);
    assert.deepEqual([...d.stats()], [0, 2, 20, 15]);
    assert.equal(d.trigger(KIND.DROUGHT, 40, 30), TRIGGER_DONE);
    assert.deepEqual([...d.stats()], [12, 4, -1, -1]);
  });

  test("a kind out of 1..4 is impossible and changes nothing", () => {
    const d = new MockDisasters2();
    d.setRule(true);
    d.trigger(KIND.RIOT, 40, 30);
    assert.equal(d.trigger(0, 40, 30), TRIGGER_IMPOSSIBLE);
    assert.equal(d.trigger(5, 40, 30), TRIGGER_IMPOSSIBLE);
    assert.equal(d.trigger("1", 40, 30), TRIGGER_IMPOSSIBLE);
    assert.deepEqual([...d.stats()], [0, 1, 20, 15]);
  });

  test("the months of drought are clamped to 0..12 by the test hook", () => {
    const d = new MockDisasters2();
    d.setRule(true);
    d.setDrought(7);
    assert.equal(d.stats()[0], 7);
    d.setDrought(99);
    assert.equal(d.stats()[0], MOCK_DROUGHT_MONTHS);
    d.setDrought(-3);
    assert.equal(d.stats()[0], 0);
    d.setDrought("x");
    assert.equal(d.stats()[0], 0);
  });

  test("switching the rule off forgets the drought and the last disaster", () => {
    const d = new MockDisasters2();
    d.setRule(true);
    d.trigger(KIND.DROUGHT, 40, 30);
    d.setRule(false);
    assert.deepEqual([...d.stats()], [0, 0, -1, -1]);
    assert.equal(d.rule(), false);
  });
});

describe("the disasters methods of the mock engine", () => {
  test("rules, triggers and stats through the City", () => {
    const c = new MockCity(1, { disasters2: true });
    assert.equal(c.disaster2_rules(), false);
    assert.equal(c.trigger_disaster(KIND.RIOT), TRIGGER_RULE_OFF);
    c.set_disaster2_rules(true);
    assert.equal(c.trigger_disaster(KIND.RIOT), TRIGGER_DONE);
    assert.deepEqual([...c.disaster2_stats()], [0, 1, 20, 15]);
    c.mock_set_drought(5);
    assert.equal(c.disaster2_stats()[0], 5);
  });

  test("a new city and a load switch the disasters off", () => {
    const c = new MockCity(1, { disasters2: true });
    c.set_disaster2_rules(true);
    c.trigger_disaster(KIND.DROUGHT);
    c.new_random_city(3);
    assert.equal(c.disaster2_rules(), false);
    assert.deepEqual([...c.disaster2_stats()], [0, 0, -1, -1]);
    c.set_disaster2_rules(true);
    c.load_cty();
    assert.equal(c.disaster2_rules(), false);
  });
});
