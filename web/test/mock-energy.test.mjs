// The energy of the mock engine (web/test/mock-energy.mjs, the `energy` option of mock-engine.mjs): the methods are
// hidden without the option, the numbers are fixed while the rule is on, and the rule resets with a new city or a load.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MockCity } from "./mock-engine.mjs";
import { ENERGY_FIXED, MOCK_PLANTS, energyStatsOf, powerPlantsOf, ENERGY_METHODS } from "./mock-energy.mjs";

describe("the mock's energy", () => {
  test("the methods are hidden without the option, present with it", () => {
    const off = new MockCity(1);
    for (const m of ENERGY_METHODS) assert.equal(off[m], undefined, m);
    const on = new MockCity(1, { energy: true });
    for (const m of ENERGY_METHODS) assert.equal(typeof on[m], "function", m);
  });

  test("off: the rule is off, six zeros, no plant", () => {
    const city = new MockCity(1, { energy: true });
    assert.equal(city.energy_rules(), false);
    assert.deepEqual([...city.energy_stats()], [0, 0, 0, 0, 0, 0]);
    assert.equal(city.power_plants().length, 0);
  });

  test("on: the fixed numbers and the three fixed plants", () => {
    const city = new MockCity(1, { energy: true });
    city.set_energy_rules(true);
    assert.equal(city.energy_rules(), true);
    assert.deepEqual([...city.energy_stats()], [...ENERGY_FIXED]);
    const plants = [...city.power_plants()];
    assert.equal(plants.length, MOCK_PLANTS.length * 6);
    assert.deepEqual(plants.slice(0, 6), [40, 10, 10, 36, 480, 100]);
    city.set_energy_rules(false);
    assert.equal(city.energy_stats()[0], 0, "off again");
  });

  test("a new city and a load switch the rule off", () => {
    const city = new MockCity(1, { energy: true });
    city.set_energy_rules(true);
    city.new_random_city(7);
    assert.equal(city.energy_rules(), false);
    city.set_energy_rules(true);
    city.load_cty(new Uint8Array(0));
    assert.equal(city.energy_rules(), false);
  });

  test("the helpers: zeros and nothing while off, the flat records while on", () => {
    assert.deepEqual([...energyStatsOf(false)], [0, 0, 0, 0, 0, 0]);
    assert.deepEqual([...energyStatsOf(true)], [...ENERGY_FIXED]);
    assert.equal(powerPlantsOf(false).length, 0);
    assert.equal(powerPlantsOf(true).length, 18);
  });
});
