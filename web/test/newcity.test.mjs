// "Nouvelle ville" seeds: parsing, clamping, random seeds, feature detection; and the mock.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSeed, randomSeed, supportsNewCity, applyEnginePreferences, SEED_MIN, SEED_MAX } from "../newcity.js";
import { MockCity, MOCK_TOOLS } from "./mock-engine.mjs";

const fixed = (n) => () => n;

describe("random seed", () => {
  test("a 31-bit positive integer from the random source", () => {
    assert.equal(randomSeed(fixed(0xffffffff)), 0x7fffffff);
    assert.equal(randomSeed(fixed(0x80000000)), 1, "the top bit is dropped; zero becomes 1");
    assert.equal(randomSeed(fixed(0x12345678)), 0x12345678);
  });

  test("zero from the source gives 1, never 0", () => {
    assert.equal(randomSeed(fixed(0)), 1);
    assert.equal(randomSeed(fixed(0x100000000)), 1);
  });

  test("the default source (crypto) gives positive 31-bit seeds", () => {
    for (let i = 0; i < 50; i++) {
      const s = randomSeed();
      assert.ok(Number.isInteger(s) && s >= 1 && s <= SEED_MAX, String(s));
    }
  });
});

describe("parse the seed box", () => {
  test("empty or blank text means a random seed", () => {
    for (const text of ["", "   ", undefined, null]) {
      const r = parseSeed(text, fixed(42));
      assert.deepEqual(r, { seed: 42, random: true }, JSON.stringify(text));
    }
  });

  test("an integer is used as typed (spaces trimmed, sign allowed)", () => {
    assert.deepEqual(parseSeed("12345", fixed(1)), { seed: 12345, random: false });
    assert.deepEqual(parseSeed("  77  ", fixed(1)), { seed: 77, random: false });
    assert.deepEqual(parseSeed("-7", fixed(1)), { seed: -7, random: false });
    assert.deepEqual(parseSeed("+8", fixed(1)), { seed: 8, random: false });
    assert.deepEqual(parseSeed("0", fixed(1)), { seed: 0, random: false });
    assert.deepEqual(parseSeed("007", fixed(1)), { seed: 7, random: false });
  });

  test("numbers outside i32 are clamped to it", () => {
    assert.equal(parseSeed("3000000000", fixed(1)).seed, SEED_MAX);
    assert.equal(parseSeed("-3000000000", fixed(1)).seed, SEED_MIN);
    assert.equal(parseSeed("2147483647", fixed(1)).seed, 2147483647);
    assert.equal(parseSeed("2147483648", fixed(1)).seed, SEED_MAX);
    assert.equal(parseSeed("-2147483648", fixed(1)).seed, SEED_MIN);
    assert.equal(parseSeed("9".repeat(400), fixed(1)).seed, SEED_MAX);
    assert.equal(parseSeed("-" + "9".repeat(400), fixed(1)).seed, SEED_MIN);
  });

  test("anything that is not an integer is an error, and no seed is made", () => {
    for (const text of ["abc", "12.5", "1e3", "0x1f", "12 34", "--3", "7-"]) {
      const r = parseSeed(text, fixed(1));
      assert.equal(r.seed, undefined, text);
      assert.match(r.error, /nombre entier/u, text);
    }
  });
});

describe("feature detection", () => {
  test("the engine has new_random_city: the button is shown", () => {
    assert.equal(supportsNewCity(new MockCity(1)), true);
  });
  test("an engine without the method (or no engine): hidden", () => {
    assert.equal(supportsNewCity({}), false);
    assert.equal(supportsNewCity({ new_random_city: 3 }), false);
    assert.equal(supportsNewCity(null), false);
    assert.equal(supportsNewCity(undefined), false);
  });
});

describe("mock new_random_city", () => {
  test("the same seed gives the same map; another seed gives another map", () => {
    const a = new MockCity(1);
    a.new_random_city(4242);
    const b = new MockCity(9);
    b.new_random_city(4242);
    assert.deepEqual(a.tiles(), b.tiles());
    a.new_random_city(4243);
    assert.notDeepEqual(a.tiles(), b.tiles());
    assert.equal(a.seed, 4243);
  });

  test("the funds go back to the start value and the map is replaced", () => {
    const city = new MockCity(1, { rubble: 0 });
    assert.equal(city.tool_down(MOCK_TOOLS.findIndex((t) => t.key === "road"), 20, 20), 1);
    assert.ok(city.funds() < 20000, "the road was paid for");
    city.new_random_city(5);
    assert.equal(city.funds(), 20000);
  });

  test("the seed is the i32 the page sent, never a float", () => {
    const city = new MockCity(1);
    city.new_random_city(SEED_MAX);
    assert.equal(city.seed, SEED_MAX);
    city.new_random_city(-1);
    assert.equal(city.seed, -1);
  });

});

describe("the page's settings after a new city", () => {
  test("the engine resets speed and disasters on a new city (mock: as the wasm adapter)", () => {
    const city = new MockCity(1);
    city.set_speed(1);
    city.enable_disasters(false);
    city.new_random_city(3);
    assert.equal(city.speed(), 3);
    assert.equal(city.disasters(), true);
  });

  test("applyEnginePreferences pushes the page's checkbox and slider back to the engine", () => {
    const city = new MockCity(1);
    city.new_random_city(77); // engine: speed 3, disasters on
    applyEnginePreferences(city, { speed: "1", disasters: false });
    assert.equal(city.speed(), 1);
    assert.equal(city.disasters(), false);
    applyEnginePreferences(city, { speed: "2", disasters: true });
    assert.equal(city.speed(), 2);
    assert.equal(city.disasters(), true);
  });

  test("the slider value arrives as a string and is sent as a number", () => {
    const calls = [];
    const fake = { set_speed: (n) => calls.push(["speed", n]), enable_disasters: (b) => calls.push(["dis", b]) };
    applyEnginePreferences(fake, { speed: "3", disasters: 0 });
    assert.deepEqual(calls, [["dis", false], ["speed", 3]]);
  });
});
