// Contract test of the buses and taxis (docs/game-design-v05.md) in the REAL compiled wasm adapter:
// transport_stats() = [buses, taxis, waiting, bus_trips_month, taxi_rides_month, income_month],
// vehicles of kind 1 (bus) and 2 (taxi), the bus stop placement rule, "off = nothing". Run with
// scripts/test-wasm.sh, which sets WASM_PKG_DIR; without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: run scripts/test-wasm.sh";
const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));
const OK = 1, FAILED = 0;
const STOP = 10, BUS_DEPOT = 11, TAXI_DEPOT = 12;

describe("wasm buses and taxis", { skip: SKIP }, () => {
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
  const kinds = (city) => {
    const flat = Array.from(city.vehicles(100000));
    return flat.filter((_, i) => i % 5 === 1);
  };
  const bulldozer = (city) => {
    for (let i = 0; i < city.tool_count(); i++) if (city.tool_key(i) === "bulldozer") return i;
    throw new Error("no bulldozer");
  };
  // Builds up to `want` buildings of `genre`. Haight has hardly any bare land: where the engine
  // would build but something is in the way (code -1), the bulldozer clears the whole footprint.
  // A depot is only useful with a road next to it, so the spots are those where a stop could stand.
  const build = (city, genre, want, step = 4) => {
    const size = genre === STOP ? 1 : 2;
    const bd = bulldozer(city);
    const tiles = city.tiles(), h = city.height();
    const roadish = (x, y) => {
      const t = tiles[x * h + y] & 0x3ff;
      return t >= 64 && t <= 238;
    };
    let n = 0;
    for (let x = 2; x < city.width() - 3 && n < want; x += step) {
      for (let y = 2; y < city.height() - 3 && n < want; y += step) {
        const code = city.structure_preview(genre, x, y)[0];
        if (code === FAILED) continue;
        if (genre !== STOP && city.structure_preview(STOP, x, y)[0] === FAILED) continue;
        if (genre !== STOP && [[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dy]) => roadish(x + dx, y + dy))) continue;
        if (code !== OK) {
          for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) city.tool_down(bd, x + dx, y + dy);
        }
        if (city.place_structure(genre, x, y) === OK) n++;
      }
    }
    return n;
  };

  test("off by default and with only one of the two rules: zeros", () => {
    const city = load();
    assert.deepEqual(Array.from(city.transport_stats()), [0, 0, 0, 0, 0, 0]);
    city.set_agent_rules(true);
    run(city, 100);
    assert.deepEqual(Array.from(city.transport_stats()), [0, 0, 0, 0, 0, 0]);
    const other = load();
    other.set_structure_rules(true);
    other.set_agent_rules(false);
    run(other, 100);
    assert.deepEqual(Array.from(other.transport_stats()), [0, 0, 0, 0, 0, 0]);
  });

  test("the bus stop needs a road next to it; the depots do not", () => {
    const city = load();
    city.set_structure_rules(true);
    let refused = 0, accepted = 0;
    for (let x = 2; x < 60; x++) {
      for (let y = 2; y < 40; y++) {
        const [code] = Array.from(city.structure_preview(STOP, x, y));
        if (code === FAILED) refused++;
        if (code === OK) accepted++;
      }
    }
    assert.ok(refused > 0 && accepted > 0);
    assert.equal(build(city, BUS_DEPOT, 1), 1);
    assert.equal(build(city, TAXI_DEPOT, 1), 1);
  });

  test("with depots and stops: buses and taxis appear as vehicles of kind 1 and 2", () => {
    const city = load();
    city.set_structure_rules(true);
    city.set_agent_rules(true);
    assert.ok(build(city, STOP, 12) >= 6);
    assert.ok(build(city, BUS_DEPOT, 2) >= 1);
    assert.ok(build(city, TAXI_DEPOT, 2) >= 1);
    let sawBus = false, sawTaxi = false;
    for (let t = 0; t < 1500; t++) {
      city.tick();
      if (t % 10 === 0) {
        const ks = kinds(city);
        sawBus ||= ks.includes(1);
        sawTaxi ||= ks.includes(2);
        assert.ok(ks.every((k) => k >= 0 && k <= 2));
      }
    }
    const stats = Array.from(city.transport_stats());
    assert.equal(stats.length, 6);
    assert.ok(sawBus && sawTaxi);
    assert.ok(stats[2] > 0 && stats[5] > 0, "riders wait and fares are earned");
    assert.ok(stats.every((v) => Number.isInteger(v) && v >= 0));
    assert.equal(kinds(city).filter((k) => k === 1).length, stats[0]);
    assert.equal(kinds(city).filter((k) => k === 2).length, stats[1]);
  });

  test("two identical runs give identical statistics", () => {
    const make = () => {
      const city = load();
      city.set_structure_rules(true);
      city.set_agent_rules(true);
      build(city, STOP, 12);
      build(city, BUS_DEPOT, 2);
      build(city, TAXI_DEPOT, 2);
      run(city, 800);
      return [Array.from(city.transport_stats()), Array.from(city.vehicles(1000))];
    };
    assert.deepEqual(make(), make());
  });
});
