// Contract test of the REAL compiled wasm adapter for the SimCity 3000 disasters (City.disaster2_rules,
// set_disaster2_rules, trigger_disaster, disaster2_stats) and their messages (docs/game-design-v13.md).
// Run with scripts/test-wasm.sh: WASM_PKG_DIR must name a wasm-bindgen --target nodejs build. Without it
// the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";
const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));

const DONE = 1, RULES_OFF = 0, IMPOSSIBLE = -1;
const RIOT = 1, UFO = 2, METEOR = 3, DROUGHT = 4;
const STATS = 4, DROUGHT_MONTHS = 12;
const MESSAGE_KIND = 1;
const MESSAGE_RIOT = 44, MESSAGE_UFO = 59, MESSAGE_METEOR = 60, MESSAGE_DROUGHT = 61;
const TICKS_PER_YEAR = 1200;

describe("wasm SimCity 3000 disasters", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  function haight() {
    const city = City.new_sized(120, 100, 1);
    city.load_cty(HAIGHT);
    city.set_speed(3);
    return city;
  }

  function ready() {
    const city = haight();
    city.set_disaster2_rules(true);
    return city;
  }

  function ticks(city, n) {
    for (let i = 0; i < n; i++) city.tick();
  }

  // The message records [kind, number, x, y, picture, important] the engine emitted since the last call.
  function messages(city) {
    const flat = Array.from(city.take_messages());
    const out = [];
    for (let i = 0; i < flat.length; i += 6) {
      if (flat[i] === MESSAGE_KIND) out.push({ number: flat[i + 1], x: flat[i + 2], y: flat[i + 3] });
    }
    return out;
  }

  test("off by default: stats are empty and every trigger is refused", () => {
    const city = haight();
    assert.equal(city.disaster2_rules(), false);
    assert.ok(city.disaster2_stats() instanceof Int32Array);
    assert.deepEqual(Array.from(city.disaster2_stats()), [0, 0, -1, -1]);
    for (const kind of [RIOT, UFO, METEOR, DROUGHT, 0, 9, -1]) {
      assert.equal(city.trigger_disaster(kind), RULES_OFF, `kind ${kind}`);
    }
    assert.deepEqual(Array.from(city.disaster2_stats()), [0, 0, -1, -1]);
  });

  test("an unknown kind is impossible, a riot without residential zone too", () => {
    const city = ready();
    for (const kind of [0, 5, 99, -3]) assert.equal(city.trigger_disaster(kind), IMPOSSIBLE, `kind ${kind}`);
    const empty = new City(1);
    empty.set_disaster2_rules(true);
    assert.equal(empty.trigger_disaster(RIOT), IMPOSSIBLE);
    assert.equal(empty.trigger_disaster(DROUGHT), DONE);
  });

  test("a riot lights fires near the zone with the most crime and says so", () => {
    const city = ready();
    city.take_messages();
    const before = Array.from(city.tiles());
    assert.equal(city.trigger_disaster(RIOT), DONE);
    const stats = Array.from(city.disaster2_stats());
    assert.equal(stats.length, STATS);
    assert.deepEqual([stats[0], stats[1]], [0, RIOT]);
    assert.ok(stats[2] >= 0 && stats[2] < 120 && stats[3] >= 0 && stats[3] < 100);
    assert.notDeepEqual(Array.from(city.tiles()), before, "fires were lit");
    const riot = messages(city).filter((m) => m.number === MESSAGE_RIOT);
    assert.deepEqual(riot, [{ number: MESSAGE_RIOT, x: stats[2], y: stats[3] }]);
  });

  test("a UFO destroys a strip, a meteor digs a crater, each with its message", () => {
    const city = ready();
    city.take_messages();
    assert.equal(city.trigger_disaster(UFO), DONE);
    let stats = Array.from(city.disaster2_stats());
    assert.equal(stats[1], UFO);
    assert.deepEqual(messages(city).filter((m) => m.number === MESSAGE_UFO), [{ number: MESSAGE_UFO, x: stats[2], y: stats[3] }]);

    const before = Array.from(city.tiles());
    assert.equal(city.trigger_disaster(METEOR), DONE);
    stats = Array.from(city.disaster2_stats());
    assert.equal(stats[1], METEOR);
    const [cx, cy] = [stats[2], stats[3]];
    assert.ok(cx >= 1 && cx < 119 && cy >= 1 && cy < 99, "the crater fits the map");
    assert.deepEqual(messages(city).filter((m) => m.number === MESSAGE_METEOR), [{ number: MESSAGE_METEOR, x: cx, y: cy }]);
    const after = Array.from(city.tiles());
    const changed = after.filter((t, i) => t !== before[i]).length;
    assert.ok(changed >= 1 && changed <= 9 + 20, `a crater of at most 9 tiles (plus the UFO strip's fires): ${changed}`);
  });

  test("a drought lasts a year: months left, the message, over after the year", () => {
    const city = ready();
    city.enable_disasters(false); // nothing else at the yearly pass
    city.take_messages();
    assert.equal(city.trigger_disaster(DROUGHT), DONE);
    assert.deepEqual(Array.from(city.disaster2_stats()), [DROUGHT_MONTHS, DROUGHT, -1, -1]);
    assert.equal(messages(city).filter((m) => m.number === MESSAGE_DROUGHT).length, 1);
    assert.equal(city.trigger_disaster(DROUGHT), DONE);
    assert.equal(city.disaster2_stats()[0], DROUGHT_MONTHS, "it does not add up");
    ticks(city, TICKS_PER_YEAR + 100);
    assert.equal(city.disaster2_stats()[0], 0, "bounded: over by the next yearly pass");
  });

  test("the drought makes the pumps weaker (water rule on) and turning the rule off ends it", () => {
    const city = ready();
    city.set_water_rules(true);
    city.trigger_disaster(DROUGHT);
    city.set_disaster2_rules(false);
    assert.deepEqual(Array.from(city.disaster2_stats()), [0, 0, -1, -1]);
    assert.equal(city.disaster2_rules(), false);
  });

  test("the rule on with disasters not allowed draws nothing for two years", () => {
    const a = haight();
    const b = ready();
    a.enable_disasters(false);
    b.enable_disasters(false);
    ticks(a, 2 * TICKS_PER_YEAR);
    ticks(b, 2 * TICKS_PER_YEAR);
    assert.deepEqual(Array.from(b.disaster2_stats()), [0, 0, -1, -1]);
    assert.deepEqual(Array.from(a.tiles()), Array.from(b.tiles()));
    assert.equal(a.funds(), b.funds());
  });

  test("rule off = the classic engine: two runs and a toggled one end identical (600 ticks)", () => {
    const a = haight();
    const b = haight();
    b.set_disaster2_rules(true);
    b.set_disaster2_rules(false);
    ticks(a, 600);
    ticks(b, 600);
    assert.deepEqual(Array.from(a.tiles()), Array.from(b.tiles()));
    assert.equal(a.funds(), b.funds());
  });

  test("the same seed gives the same disaster", () => {
    const a = ready();
    const b = ready();
    for (const kind of [UFO, METEOR, RIOT]) {
      assert.equal(a.trigger_disaster(kind), DONE);
      assert.equal(b.trigger_disaster(kind), DONE);
      assert.deepEqual(Array.from(a.disaster2_stats()), Array.from(b.disaster2_stats()));
    }
    assert.deepEqual(Array.from(a.tiles()), Array.from(b.tiles()));
  });

  test("the drought and the switch survive a save", () => {
    const city = ready();
    city.trigger_disaster(DROUGHT);
    const file = city.save_city();
    const back = City.new_sized(120, 100, 1);
    back.load_city(file);
    assert.equal(back.disaster2_rules(), true);
    assert.equal(back.disaster2_stats()[0], DROUGHT_MONTHS);
    const plain = haight();
    plain.set_disaster2_rules(true);
    plain.set_disaster2_rules(false);
    assert.deepEqual(Array.from(plain.save_cty()), Array.from(haight().save_cty()), "off: the file it always was");
  });
});
