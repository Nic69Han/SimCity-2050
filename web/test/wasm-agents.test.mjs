// Contract test of the simulated-cars API of the REAL compiled wasm adapter (agent_rules,
// set_agent_rules, agent_stats, vehicles, traffic_load): record layouts, bounds, determinism, the
// save, and "rule off = the engine without cars". Run with scripts/test-wasm.sh, which sets
// WASM_PKG_DIR; without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: run scripts/test-wasm.sh";
const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));

describe("wasm agents contract", { skip: SKIP }, () => {
  let City;
  before(() => {
    City = createRequire(import.meta.url)(join(PKG_DIR, "micropolis_wasm.js")).City;
  });

  const load = () => {
    const city = new City(1);
    city.load_cty(HAIGHT);
    city.take_events();
    city.set_speed(3);
    city.enable_disasters(false);
    return city;
  };
  const run = (city, n) => {
    for (let t = 0; t < n; t++) city.tick();
  };
  const records = (city, max) => {
    const flat = Array.from(city.vehicles(max));
    assert.equal(flat.length % 5, 0);
    const out = [];
    for (let i = 0; i < flat.length; i += 5) out.push(flat.slice(i, i + 5));
    return out;
  };

  test("off by default: no car, zero stats, a flat load map", () => {
    const city = load();
    assert.equal(city.agent_rules(), false);
    run(city, 100);
    assert.deepEqual(Array.from(city.agent_stats()), [0, 0, 0, 0, 0]);
    assert.equal(city.vehicles(100).length, 0);
    const load0 = city.traffic_load();
    assert.equal(load0.length, city.width() * city.height());
    assert.ok(load0.every((v) => v === 0));
  });

  test("cars drive: records of five, centres inside the map, bounded by max", () => {
    const city = load();
    city.set_agent_rules(true);
    run(city, 600);
    const [active, finished, mean, saturated, motorised] = Array.from(city.agent_stats());
    assert.ok(active > 0 && finished > 0 && mean > 0 && motorised > 0 && saturated >= 0);
    const all = records(city, 100000);
    assert.equal(all.length, active);
    assert.equal(records(city, 3).length, 3);
    assert.equal(city.vehicles(0).length, 0);
    const ids = new Set();
    for (const [id, kind, x16, y16, dir] of all) {
      assert.equal(kind, 0);
      assert.ok(x16 >= 0 && x16 < city.width() * 16 && y16 >= 0 && y16 < city.height() * 16);
      assert.ok(dir >= 0 && dir <= 3);
      ids.add(id);
    }
    assert.equal(ids.size, all.length, "no duplicated id");
  });

  test("the measured load is a Uint8Array in tile order and follows the cars", () => {
    const city = load();
    city.set_agent_rules(true);
    run(city, 400);
    const loadMap = city.traffic_load();
    assert.ok(loadMap instanceof Uint8Array);
    assert.equal(loadMap.length, city.width() * city.height());
    assert.ok(loadMap.some((v) => v > 0));
    const h = city.height();
    const tiles = city.tiles();
    for (const [, , x16, y16] of records(city, 100000)) {
      const i = (x16 >> 4) * h + (y16 >> 4);
      assert.ok((tiles[i] & 0x3ff) >= 64 && (tiles[i] & 0x3ff) < 208, "a car is on a road");
    }
  });

  test("two runs are identical", () => {
    const a = load();
    const b = load();
    a.set_agent_rules(true);
    b.set_agent_rules(true);
    run(a, 400);
    run(b, 400);
    assert.deepEqual(records(a, 100000), records(b, 100000));
    assert.deepEqual(Array.from(a.traffic_load()), Array.from(b.traffic_load()));
    assert.deepEqual(Array.from(a.agent_stats()), Array.from(b.agent_stats()));
  });

  test("only the switch is saved; the cars restart from the city; off = today's file", () => {
    const plain = load();
    const city = load();
    assert.deepEqual(Array.from(city.save_city()), Array.from(plain.save_city()));
    city.set_agent_rules(true);
    run(city, 200);
    const back = new City(1);
    back.load_city(city.save_city());
    assert.equal(back.agent_rules(), true);
    assert.equal(back.agent_stats()[0], 0);
    city.set_agent_rules(false);
    assert.equal(city.vehicles(10).length, 0);
    assert.deepEqual(Array.from(city.save_city()).length, Array.from(plain.save_city()).length);
  });
});
