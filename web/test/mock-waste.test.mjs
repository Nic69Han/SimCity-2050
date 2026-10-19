// The waste of the mock engine (web/test/mock-waste.mjs and the `waste` option of mock-engine.mjs).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MockCity } from "./mock-engine.mjs";
import { MOCK_WASTE_STRUCTURES, WASTE_STAT_COUNT, wasteStatsOf } from "./mock-waste.mjs";

describe("the mock's waste", () => {
  test("hidden without the option", () => {
    const city = new MockCity(1);
    for (const m of ["waste_rules", "set_waste_rules", "waste_stats", "waste_layer"]) assert.equal(city[m], undefined, m);
  });

  test("off by default, seven zeros while off, and the rule is set", () => {
    const city = new MockCity(1, { waste: true, rubble: 0 });
    assert.equal(city.waste_rules(), false);
    assert.deepEqual([...city.waste_stats()], [0, 0, 0, 0, 0, 0, 0]);
    city.set_waste_rules(true);
    assert.equal(city.waste_rules(), true);
    assert.equal(city.waste_stats().length, WASTE_STAT_COUNT);
  });

  test("on, the statistics are the numbers set by the test hook (missing ones 0, extra ones ignored)", () => {
    const city = new MockCity(1, { waste: true });
    city.set_waste_rules(true);
    assert.deepEqual([...city.waste_stats()], [0, 0, 0, 0, 0, 0, 0], "zeros until set");
    city.set_mock_waste([10, 6, 2, 1, 1, 500, 40, 99]);
    assert.deepEqual([...city.waste_stats()], [10, 6, 2, 1, 1, 500, 40]);
    city.set_mock_waste([3]);
    assert.deepEqual([...city.waste_stats()], [3, 0, 0, 0, 0, 0, 0]);
  });

  test("the layer has one value per tile, all zeros in the mock", () => {
    const city = new MockCity(1, { waste: true });
    city.set_waste_rules(true);
    city.set_mock_waste([1, 1, 1, 1, 9, 9, 9]);
    const layer = city.waste_layer();
    assert.equal(layer.length, city.width() * city.height());
    assert.equal(layer.every((v) => v === 0), true);
  });

  test("a new city or a load turns the rule off and forgets the numbers", () => {
    const city = new MockCity(1, { waste: true });
    city.set_waste_rules(true);
    city.set_mock_waste([5, 5, 5, 5, 5, 5, 5]);
    city.new_random_city(2);
    assert.equal(city.waste_rules(), false);
    city.set_waste_rules(true);
    assert.deepEqual([...city.waste_stats()], [0, 0, 0, 0, 0, 0, 0]);
    city.set_mock_waste([4, 0, 0, 0, 0, 0, 0]);
    city.load_cty();
    assert.equal(city.waste_rules(), false);
    city.set_waste_rules(true);
    assert.deepEqual([...city.waste_stats()], [0, 0, 0, 0, 0, 0, 0]);
  });

  test("the rule off reports zeros even with numbers set", () => {
    const city = new MockCity(1, { waste: true });
    city.set_mock_waste([7, 7, 7, 7, 7, 7, 7]);
    assert.deepEqual([...city.waste_stats()], [0, 0, 0, 0, 0, 0, 0]);
  });

  test("the four waste genres join the catalog only with structures and waste", () => {
    assert.equal(new MockCity(1, { structures: true }).structure_catalog().length, 3 * 8);
    assert.equal(new MockCity(1, { structures: true, waste: true }).structure_catalog().length,
      (3 + MOCK_WASTE_STRUCTURES.length) * 8);
    assert.deepEqual([...MOCK_WASTE_STRUCTURES.map((s) => s.genre)], [20, 21, 22, 23]);
  });

  test("the helper: zeros when off, padded and truncated when on", () => {
    assert.deepEqual([...wasteStatsOf(false, [1, 2])], [0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual([...wasteStatsOf(true, [1.8, -2, "3"])], [1, -2, 3, 0, 0, 0, 0]);
  });
});
