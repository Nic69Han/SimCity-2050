// Contract test of the REAL compiled wasm adapter for the zoning densities (City.density_rules,
// set_density_rules, zone_preview, place_zone, density_layer, density_stats), through its
// JavaScript API. Run with scripts/test-wasm.sh: WASM_PKG_DIR must name a wasm-bindgen
// --target nodejs build. Without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const OK = 1, FAILED = 0;
const RESIDENTIAL = 1, INDUSTRIAL = 3;
const COMMERCIAL_TOOL = 1, BULLDOZER = 7;
const LIGHT = 1, DENSE = 3;
const LIGHT_COST = 60, DENSE_COST = 100;

describe("wasm zoning densities", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  // A free spot for a residential zone in a new city with the rules on.
  // With `bare`, only on land that costs nothing to clear, so the preview is the pure zone price.
  function spotCity(seed = 42, bare = false) {
    const city = City.new_sized(120, 100, seed);
    city.set_density_rules(true);
    for (let x = 2; x < 110; x++) {
      for (let y = 2; y < 90; y++) {
        const [result, cost] = city.zone_preview(RESIDENTIAL, DENSE, x, y);
        if (result === OK && (!bare || cost === DENSE_COST)) return { city, x, y };
      }
    }
    throw new Error("no free spot");
  }

  test("off by default: everything is refused for free and the lists are empty", () => {
    const city = new City(1);
    assert.equal(city.density_rules(), false);
    const funds = city.funds();
    assert.deepEqual(Array.from(city.zone_preview(RESIDENTIAL, LIGHT, 20, 20)), [0, 0]);
    assert.equal(city.place_zone(RESIDENTIAL, LIGHT, 20, 20), FAILED);
    const layer = city.density_layer();
    assert.ok(layer instanceof Uint8Array);
    assert.equal(layer.length, city.width() * city.height());
    assert.ok(layer.every((v) => v === 0));
    assert.deepEqual(Array.from(city.density_stats()), [0, 0, 0, 0, 0]);
    assert.equal(city.funds(), funds);
  });

  test("the preview prices a light zone at 60 and a dense one at 100, with typed results", () => {
    const { city, x, y } = spotCity(42, true);
    const light = city.zone_preview(RESIDENTIAL, LIGHT, x, y);
    const dense = city.zone_preview(RESIDENTIAL, DENSE, x, y);
    assert.ok(light instanceof Int32Array);
    assert.equal(light.length, 2);
    assert.deepEqual(Array.from(light), [OK, LIGHT_COST]);
    assert.deepEqual(Array.from(dense), [OK, DENSE_COST]);
  });

  test("an unknown genre or density gives [0, 0] and changes nothing", () => {
    const { city, x, y } = spotCity();
    const funds = city.funds();
    for (const [genre, density] of [[9, LIGHT], [RESIDENTIAL, 4], [0, LIGHT], [RESIDENTIAL, 0], [-1, LIGHT], [RESIDENTIAL, 300]]) {
      assert.deepEqual(Array.from(city.zone_preview(genre, density, x, y)), [0, 0]);
      assert.equal(city.place_zone(genre, density, x, y), FAILED);
    }
    assert.equal(city.funds(), funds);
  });

  test("place_zone builds the zone, charges the scaled price and fills the layer", () => {
    const { city, x, y } = spotCity();
    const funds = city.funds();
    assert.equal(city.place_zone(RESIDENTIAL, LIGHT, x, y), OK);
    assert.ok(city.funds() < funds);
    const layer = city.density_layer();
    assert.ok(layer instanceof Uint8Array);
    assert.equal(layer.length, city.width() * city.height());
    const marked = [];
    layer.forEach((v, i) => { if (v !== 0) marked.push([i, v]); });
    assert.equal(marked.length, 9);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        assert.equal(layer[(x + dx) * city.height() + (y + dy)], LIGHT);
      }
    }
  });

  test("density_stats is an Int32Array of 5: light, medium, dense, farms, farm jobs", () => {
    const { city, x, y } = spotCity();
    assert.equal(city.place_zone(RESIDENTIAL, LIGHT, x, y), OK);
    const stats = city.density_stats();
    assert.ok(stats instanceof Int32Array);
    assert.equal(stats.length, 5);
    assert.deepEqual(Array.from(stats), [1, 0, 0, 0, 0]);
  });

  test("a zone is saved and loaded back; switching the rule off clears the record", () => {
    const { city, x, y } = spotCity();
    assert.equal(city.place_zone(RESIDENTIAL, LIGHT, x, y), OK);
    const file = city.save_city();
    const other = new City(1);
    other.load_city(file);
    assert.equal(other.density_rules(), true);
    assert.deepEqual(Array.from(other.density_stats()), [1, 0, 0, 0, 0]);
    assert.deepEqual(Array.from(other.density_layer()), Array.from(city.density_layer()));
    other.set_density_rules(false);
    assert.equal(other.density_rules(), false);
    assert.deepEqual(Array.from(other.density_stats()), [0, 0, 0, 0, 0]);
    assert.ok(other.density_layer().every((v) => v === 0));
  });

  test("a classic zone built on a bulldozed light zone counts as dense (layer 3)", () => {
    const { city, x, y } = spotCity();
    assert.equal(city.place_zone(INDUSTRIAL, LIGHT, x, y), OK);
    assert.equal(city.tool_down(BULLDOZER, x, y), OK);
    assert.deepEqual(Array.from(city.density_stats()), [0, 0, 0, 0, 0]);
    assert.equal(city.tool_down(COMMERCIAL_TOOL, x, y), OK);
    const at = () => city.density_layer()[x * city.height() + y];
    assert.equal(at(), DENSE);
    assert.deepEqual(Array.from(city.density_stats()), [0, 0, 1, 0, 0]);
  });
});
