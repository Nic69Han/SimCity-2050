// The zoning by density of the mock engine (web/test/mock-zoning.mjs and the `densities` option of
// mock-engine.mjs): the rules the page tests rely on, one by one.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as z from "./mock-zoning.mjs";
import { MockCity, RESULT, RUBBLE, DIRT, WATER, START_FUNDS } from "./mock-engine.mjs";

// A mock with the zoning, its rule on, and no rubble so that only the rules under test decide.
const on = (seed = 1, options = {}) => {
  const city = new MockCity(seed, { densities: true, rubble: 0, ...options });
  city.set_density_rules(true);
  return city;
};

describe("the helpers", () => {
  test("a zone is one of nine: genre 1-3 and density 1-3, integers only", () => {
    for (const g of [1, 2, 3]) for (const d of [1, 2, 3]) assert.equal(z.isZone(g, d), true);
    assert.equal(z.isZone(0, 1), false);
    assert.equal(z.isZone(4, 1), false);
    assert.equal(z.isZone(1, 0), false);
    assert.equal(z.isZone(1, 4), false);
    assert.equal(z.isZone(1.5, 1), false);
    assert.equal(z.isZone("1", 1), false);
  });

  test("prices: 80, 100 and 150 dollars for light, medium and dense", () => {
    assert.deepEqual([1, 2, 3].map(z.zoneCost), [80, 100, 150]);
  });

  test("the tiles of the genres and the rule-off density", () => {
    assert.deepEqual([1, 2, 3].map(z.zoneTile), [240, 423, 612]);
    assert.equal(z.zoneDensity({ density: 1 }, true), 1);
    assert.equal(z.zoneDensity({ density: 1 }, false), z.CLASSIC_DENSITY);
    assert.equal(z.CLASSIC_DENSITY, 3);
  });

  test("the layer paints the 3x3 square of each zone, in column-major order", () => {
    const layer = z.zoneLayer([{ genre: 1, density: 2, x: 2, y: 3 }], 5, 6, true);
    assert.equal(layer.length, 30);
    let painted = 0;
    for (let x = 0; x < 5; x++) for (let y = 0; y < 6; y++) {
      const inside = Math.abs(x - 2) <= 1 && Math.abs(y - 3) <= 1;
      assert.equal(layer[x * 6 + y], inside ? 2 : 0, `tile ${x},${y}`);
      if (inside) painted++;
    }
    assert.equal(painted, 9);
  });

  test("the layer shows dense for every zone while the rule is off", () => {
    const layer = z.zoneLayer([{ genre: 2, density: 1, x: 1, y: 1 }], 3, 3, false);
    assert.equal(layer[1 * 3 + 1], z.CLASSIC_DENSITY);
    assert.equal(layer.reduce((a, b) => a + b, 0), 9 * z.CLASSIC_DENSITY);
  });

  test("the statistics count the zones by density, and farms are never counted", () => {
    const zones = [
      { genre: 1, density: 1, x: 2, y: 2 }, { genre: 1, density: 1, x: 6, y: 2 },
      { genre: 2, density: 2, x: 2, y: 6 }, { genre: 3, density: 3, x: 6, y: 6 },
    ];
    assert.deepEqual([...z.zoneStats(zones, true)], [2, 1, 1, 0, 0]);
    assert.deepEqual([...z.zoneStats(zones, false)], [0, 0, 4, 0, 0]);
    assert.deepEqual([...z.zoneStats([], true)], [0, 0, 0, 0, 0]);
  });
});

describe("the mock engine: feature switch", () => {
  test("hidden without the option, off by default and after a new city or a load", () => {
    assert.equal(new MockCity(1).zone_preview, undefined);
    assert.equal(new MockCity(1).density_rules, undefined);
    const city = new MockCity(1, { densities: true });
    assert.equal(city.density_rules(), false);
    city.set_density_rules(true);
    city.new_random_city(2);
    assert.equal(city.density_rules(), false);
    city.set_density_rules(true);
    city.load_cty();
    assert.equal(city.density_rules(), false);
  });

  test("a new city or a load drops every zone", () => {
    const city = on(1);
    assert.equal(city.place_zone(1, 1, 20, 20), RESULT.OK);
    city.new_random_city(1);
    city.set_density_rules(true);
    assert.deepEqual([...city.density_stats()], [0, 0, 0, 0, 0]);
    assert.equal(city.place_zone(1, 1, 20, 20), RESULT.OK, "the tiles are dirt again");
    city.load_cty();
    assert.deepEqual([...city.density_stats()], [0, 0, 0, 0, 0]);
  });

  test("the option leaves the classic mock as it was", () => {
    const city = new MockCity(1);
    assert.equal(typeof city.tool_preview, "function");
    assert.equal(typeof city.structure_rules, "undefined");
  });
});

describe("the mock engine: placing a zone", () => {
  test("refused while the rule is off: preview [0, 0] and Failed", () => {
    const city = new MockCity(1, { densities: true, rubble: 0 });
    assert.deepEqual([...city.zone_preview(1, 1, 20, 20)], [RESULT.FAILED, 0]);
    assert.equal(city.place_zone(1, 1, 20, 20), RESULT.FAILED);
    assert.equal(city.funds(), START_FUNDS);
  });

  test("a light residential zone on dirt: Ok, charged 80, nine tiles written", () => {
    const city = on(1);
    assert.deepEqual([...city.zone_preview(1, 1, 20, 20)], [RESULT.OK, 80]);
    assert.equal(city.place_zone(1, 1, 20, 20), RESULT.OK);
    assert.equal(city.funds(), START_FUNDS - 80);
    const tiles = city.tiles();
    const h = city.height();
    for (let x = 19; x <= 21; x++) for (let y = 19; y <= 21; y++) assert.equal(tiles[x * h + y], 240);
    assert.notEqual(tiles[18 * h + 20], 240);
  });

  test("the price follows the density, and the genre sets the tile", () => {
    const city = on(1);
    assert.equal(city.zone_preview(2, 2, 10, 10)[1], 100);
    assert.equal(city.zone_preview(3, 3, 10, 10)[1], 150);
    assert.equal(city.place_zone(3, 3, 10, 10), RESULT.OK);
    assert.equal(city.tiles()[10 * city.height() + 10], 612);
  });

  test("the zone is centred on the clicked tile: its edge is refused at the map border", () => {
    const city = on(1);
    assert.deepEqual([...city.zone_preview(1, 1, 0, 0)], [RESULT.FAILED, 0]);
    assert.deepEqual([...city.zone_preview(1, 1, 1, 1)], [RESULT.OK, 80]);
    assert.deepEqual([...city.zone_preview(1, 1, city.width() - 1, 5)], [RESULT.FAILED, 0]);
    assert.deepEqual([...city.zone_preview(1, 1, city.width() - 2, 5)], [RESULT.OK, 80]);
  });

  test("water or a zone under the square refuses", () => {
    const city = on(1);
    // the mock's lake covers x 3..9, y 3..7 for every seed: a zone centred on (4, 4) reaches it
    assert.deepEqual([...city.zone_preview(1, 1, 4, 4)], [RESULT.FAILED, 0]);
    assert.equal(city.place_zone(1, 1, 4, 4), RESULT.FAILED);
    assert.equal(city.place_zone(1, 1, 20, 20), RESULT.OK);
    assert.equal(city.place_zone(2, 2, 21, 21), RESULT.FAILED, "overlaps the first zone");
    assert.equal(city.place_zone(2, 2, 23, 20), RESULT.OK, "next to it is fine");
    assert.equal(city.funds(), START_FUNDS - 80 - 100);
  });

  test("rubble under the square: NeedBulldoze with the price, nothing placed", () => {
    const city = new MockCity(1, { densities: true, rubble: 2000 });
    city.set_density_rules(true);
    assert.equal(city.tiles()[20 * city.height() + 20], RUBBLE, "seed 1 has rubble on the origin");
    assert.deepEqual([...city.zone_preview(1, 1, 20, 20)], [RESULT.NEED_BULLDOZE, 80]);
    assert.equal(city.place_zone(1, 1, 20, 20), RESULT.NEED_BULLDOZE);
    assert.equal(city.funds(), START_FUNDS);
    assert.deepEqual([...city.density_stats()], [0, 0, 0, 0, 0]);
    assert.notEqual(DIRT, RUBBLE);
  });

  test("a poor city gets NoMoney with the price", () => {
    const city = new MockCity(1, { densities: true, rubble: 0, funds: 100 });
    city.set_density_rules(true);
    assert.deepEqual([...city.zone_preview(3, 3, 20, 20)], [RESULT.NO_MONEY, 150]);
    assert.equal(city.place_zone(3, 3, 20, 20), RESULT.NO_MONEY);
    assert.equal(city.funds(), 100);
    assert.deepEqual([...city.zone_preview(1, 1, 20, 20)], [RESULT.OK, 80], "light fits");
  });

  test("an unknown genre or density is Failed", () => {
    const city = on(1);
    for (const [g, d] of [[0, 1], [4, 1], [1, 0], [1, 4], [1.5, 1]]) {
      assert.equal(city.place_zone(g, d, 20, 20), RESULT.FAILED, `${g}/${d}`);
      assert.deepEqual([...city.zone_preview(g, d, 20, 20)], [RESULT.FAILED, 0]);
    }
  });
});

describe("the mock engine: the rule and the statistics", () => {
  test("the statistics count the placed zones by density while the rule is on", () => {
    const city = on(1);
    city.place_zone(1, 1, 20, 20);
    city.place_zone(2, 2, 25, 20);
    city.place_zone(3, 3, 30, 20);
    assert.deepEqual([...city.density_stats()], [1, 1, 1, 0, 0]);
  });

  test("the layer shows the density of each zone", () => {
    const city = on(1);
    city.place_zone(1, 3, 20, 20);
    const layer = city.density_layer();
    const h = city.height();
    assert.equal(layer.length, city.width() * h);
    assert.equal(layer[20 * h + 20], 3);
    assert.equal(layer[19 * h + 19], 3);
    assert.equal(layer[18 * h + 20], 0);
  });

  test("turning the rule off makes every zone dense and keeps them; on again restores them", () => {
    const city = on(1);
    city.place_zone(1, 1, 20, 20);
    city.set_density_rules(false);
    assert.deepEqual([...city.density_stats()], [0, 0, 1, 0, 0]);
    assert.equal(city.density_layer()[20 * city.height() + 20], z.CLASSIC_DENSITY);
    assert.equal(city.place_zone(1, 1, 25, 20), RESULT.FAILED, "no zone is placed while off");
    city.set_density_rules(true);
    assert.deepEqual([...city.density_stats()], [1, 0, 0, 0, 0]);
  });

  test("the layer and the statistics are zero for an empty city", () => {
    const city = on(1);
    assert.equal(city.density_layer().reduce((a, b) => a + b, 0), 0);
    assert.deepEqual([...city.density_stats()], [0, 0, 0, 0, 0]);
  });

  test("the page reads a Uint8Array layer and an Int32Array of five statistics", () => {
    const city = on(1);
    assert.ok(city.density_layer() instanceof Uint8Array);
    assert.ok(city.density_stats() instanceof Int32Array);
    assert.equal(city.density_stats().length, 5);
  });
});
