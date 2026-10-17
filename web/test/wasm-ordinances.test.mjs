// Contract test of the ordinances API of the REAL compiled wasm adapter (ordinance_count, _key,
// _info, _active, set_ordinance): layout, bounds, invalid indices, the cost formula, saving and
// loading the active set, and "all off = the engine without ordinances". Run with
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

describe("wasm ordinances contract", { skip: SKIP }, () => {
  let City;
  before(() => {
    City = createRequire(import.meta.url)(join(PKG_DIR, "micropolis_wasm.js")).City;
  });

  const load = () => {
    const city = new City(1);
    city.load_cty(HAIGHT);
    city.take_events();
    return city;
  };
  const infoOf = (city, i) => Array.from(city.ordinance_info(i));

  test("eight ordinances, each with a distinct key and a 7-number info", () => {
    const city = load();
    assert.equal(city.ordinance_count(), 8);
    const keys = [];
    for (let i = 0; i < city.ordinance_count(); i++) {
      const key = city.ordinance_key(i);
      assert.match(key, /^[a-z_]+$/, `key ${i}`);
      keys.push(key);
      const info = infoOf(city, i);
      assert.equal(info.length, 7);
      assert.ok(info.every(Number.isInteger));
      assert.ok(info[0] > 0, "a cost");
      assert.ok(info.slice(1).some((v) => v !== 0), "an effect");
      assert.ok(info.slice(1).every((v) => v >= -30 && v <= 30), "modest percentages");
      assert.equal(city.ordinance_active(i), false, "off by default");
    }
    assert.equal(new Set(keys).size, 8);
    assert.deepEqual(infoOf(city, 0).slice(1), [-15, 0, 0, 0, 0, 0], "police de proximité");
  });

  test("the cost is base + per-thousand-inhabitants and follows the population", () => {
    const city = load();
    const pop = city.population();
    assert.ok(pop > 1000, "the sample is a city");
    // Police de proximité: 200 + 30 per 1000.
    assert.equal(infoOf(city, 0)[0], 200 + 30 * Math.floor(pop / 1000));
    const fresh = new City(1);
    assert.equal(fresh.population(), 0);
    assert.equal(infoOf(fresh, 0)[0], 200);
  });

  test("set_ordinance and ordinance_active follow each other; invalid indices change nothing", () => {
    const city = load();
    assert.equal(city.set_ordinance(2, true), true);
    assert.equal(city.ordinance_active(2), true);
    assert.equal(city.ordinance_active(1), false);
    assert.equal(city.set_ordinance(2, false), true);
    assert.equal(city.ordinance_active(2), false);
    city.set_ordinance(5, true);
    for (const bad of [-1, 8, 9, 31, 1000, 2 ** 31 - 1]) {
      assert.equal(city.set_ordinance(bad, true), false, `set ${bad}`);
      assert.equal(city.ordinance_active(bad), false, `active ${bad}`);
      assert.equal(city.ordinance_info(bad).length, 0, `info ${bad}`);
      assert.equal(city.ordinance_key(bad), "", `key ${bad}`);
    }
    assert.equal(city.ordinance_active(5), true, "the valid one is untouched");
  });

  test("funds are lower after several tax collections with ordinances on", () => {
    // Same city twice, one with two ordinances; the exact cost of one collection is checked in
    // crates/micropolis-core/tests/ordinances.rs. 400 ticks at speed 3 cross several collections.
    const plain = load();
    const withOrd = load();
    withOrd.set_ordinance(0, true);
    withOrd.set_ordinance(1, true);
    for (const c of [plain, withOrd]) {
      c.set_speed(3);
      c.enable_disasters(false);
    }
    for (let t = 0; t < 400; t++) {
      plain.tick();
      withOrd.tick();
    }
    assert.equal(plain.year(), withOrd.year());
    assert.ok(withOrd.funds() < plain.funds(), `${withOrd.funds()} < ${plain.funds()}`);
  });

  test("with every ordinance off the engine plays exactly as before", () => {
    const a = load();
    const b = load();
    for (let i = 0; i < 8; i++) b.set_ordinance(i, true);
    for (let i = 0; i < 8; i++) b.set_ordinance(i, false);
    for (const c of [a, b]) c.set_speed(3);
    for (let t = 0; t < 300; t++) {
      a.tick();
      b.tick();
    }
    assert.equal(a.funds(), b.funds());
    assert.deepEqual(Array.from(a.tiles()), Array.from(b.tiles()));
    assert.deepEqual(Array.from(a.save_city()), Array.from(b.save_city()));
  });

  test("the active set is saved with the city and loaded back", () => {
    const city = load();
    city.set_ordinance(0, true);
    city.set_ordinance(6, true);
    const bytes = city.save_city();
    assert.equal((bytes[4] << 8) | bytes[5], 3, "a version-3 file: it carries the extensions block");
    const back = new City(1);
    back.load_city(bytes);
    assert.deepEqual(
      Array.from({ length: 8 }, (_, i) => back.ordinance_active(i)),
      [true, false, false, false, false, false, true, false],
    );
    // A file without the block resets the set: the ordinances belong to the file.
    back.load_cty(HAIGHT);
    assert.deepEqual(Array.from({ length: 8 }, (_, i) => back.ordinance_active(i)), Array(8).fill(false));
  });
});
