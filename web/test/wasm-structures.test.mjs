// Contract test of the REAL compiled wasm adapter for the extended buildings (City.structure_rules,
// set_structure_rules, structure_catalog, structures, structure_preview, place_structure,
// remove_structure, structures_upkeep), through its JavaScript API. Run with scripts/test-wasm.sh:
// WASM_PKG_DIR must name a wasm-bindgen --target nodejs build. Without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const OK = 1, FAILED = 0, NEED_BULLDOZE = -1, NO_MONEY = -2;
const PARK = 1, PLAZA = 2, MONUMENT = 3;
const CATALOG_RECORD = 8, STRUCTURE_RECORD = 6;

describe("wasm extended buildings", { skip: SKIP }, () => {
  let City;

  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  // A free spot for a building of `genre` in a new city with the rules on.
  function spotCity(genre, seed = 42) {
    const city = City.new_sized(120, 100, seed);
    city.set_structure_rules(true);
    for (let x = 2; x < 110; x++) {
      for (let y = 2; y < 90; y++) {
        if (city.structure_preview(genre, x, y)[0] === OK) return { city, x, y };
      }
    }
    throw new Error("no free spot");
  }

  function catalogOf(city) {
    const flat = Array.from(city.structure_catalog());
    assert.equal(flat.length % CATALOG_RECORD, 0);
    const out = [];
    for (let i = 0; i < flat.length; i += CATALOG_RECORD) {
      const [genre, width, height, cost, upkeep, flags, radius, effect] = flat.slice(i, i + CATALOG_RECORD);
      out.push({ genre, width, height, cost, upkeep, flags, radius, effect });
    }
    return out;
  }

  test("off by default: everything is refused for free and the lists are empty", () => {
    const city = new City(1);
    assert.equal(city.structure_rules(), false);
    const funds = city.funds();
    assert.equal(city.place_structure(PARK, 5, 5), FAILED);
    assert.equal(city.remove_structure(5, 5), FAILED);
    assert.deepEqual(Array.from(city.structure_preview(PARK, 5, 5)), [FAILED, 0]);
    assert.equal(city.structures().length, 0);
    assert.equal(city.structures_upkeep(), 0);
    assert.equal(city.funds(), funds);
  });

  test("the catalog lists the three genres of the milestone", () => {
    const cat = catalogOf(new City(1));
    assert.deepEqual(cat.map((k) => [k.genre, k.width, k.height]), [[PARK, 2, 2], [PLAZA, 1, 1], [MONUMENT, 3, 3]]);
    for (const k of cat) {
      assert.ok(k.cost > 0 && k.upkeep >= 0 && k.radius > 0);
      assert.ok([0, 1].includes(k.effect));
      assert.equal(k.flags & ~3, 0);
    }
  });

  test("the switch turns on and off; off removes the buildings without refund", () => {
    const { city, x, y } = spotCity(PARK);
    assert.equal(city.structure_rules(), true);
    assert.equal(city.place_structure(PARK, x, y), OK);
    const funds = city.funds();
    city.set_structure_rules(false);
    assert.equal(city.structure_rules(), false);
    assert.equal(city.structures().length, 0);
    assert.equal(city.funds(), funds);
  });

  test("a building is previewed, placed, listed, paid for and removed", () => {
    for (const genre of [PARK, PLAZA, MONUMENT]) {
      const { city, x, y } = spotCity(genre);
      const k = catalogOf(city).find((c) => c.genre === genre);
      assert.deepEqual(Array.from(city.structure_preview(genre, x, y)), [OK, k.cost]);
      const funds = city.funds();
      assert.equal(city.place_structure(genre, x, y), OK);
      assert.equal(city.funds(), funds - k.cost);
      const list = Array.from(city.structures());
      assert.equal(list.length, STRUCTURE_RECORD);
      assert.deepEqual(list.slice(0, 5), [genre, x, y, k.width, k.height]);
      assert.equal(list[5] & ~3, 0);
      assert.equal(city.structures_upkeep(), k.upkeep);
      // on the same spot: bulldoze first
      assert.equal(city.place_structure(genre, x, y), NEED_BULLDOZE);
      // removed from its far corner
      assert.equal(city.remove_structure(x + k.width - 1, y + k.height - 1), OK);
      assert.equal(city.structures().length, 0);
      assert.equal(city.remove_structure(x, y), FAILED);
    }
  });

  test("bad genres and the map edge are refused for free", () => {
    const { city, x, y } = spotCity(MONUMENT);
    const funds = city.funds();
    for (const genre of [0, 4, -1, 300]) assert.equal(city.place_structure(genre, x, y), FAILED);
    assert.equal(city.place_structure(MONUMENT, 119, 99), FAILED);
    assert.equal(city.place_structure(MONUMENT, -1, 5), FAILED);
    assert.deepEqual(Array.from(city.structure_preview(MONUMENT, 119, 99)), [FAILED, 0]);
    assert.equal(city.funds(), funds);
    assert.equal(city.structures().length, 0);
  });

  test("a lack of money is -2, for free", () => {
    const city = City.new_sized(120, 100, 42);
    city.set_structure_rules(true);
    let refused = null;
    // monuments are dear: a new city runs out of money within a few dozen of them
    for (let x = 2; x < 117 && refused === null; x += 4) {
      for (let y = 2; y < 97 && refused === null; y += 4) {
        const before = city.funds();
        const preview = Array.from(city.structure_preview(MONUMENT, x, y));
        const code = city.place_structure(MONUMENT, x, y);
        if (code === NO_MONEY) {
          assert.deepEqual(preview, [NO_MONEY, 0]);
          assert.equal(city.funds(), before);
          refused = [x, y];
        }
      }
    }
    assert.notEqual(refused, null);
  });

  test("a building is saved and loaded back", () => {
    const { city, x, y } = spotCity(MONUMENT);
    assert.equal(city.place_structure(MONUMENT, x, y), OK);
    const before = Array.from(city.structures());
    const file = city.save_city();
    const other = new City(1);
    other.load_city(file);
    assert.equal(other.structure_rules(), true);
    assert.deepEqual(Array.from(other.structures()), before);
    assert.equal(other.structures_upkeep(), city.structures_upkeep());
  });
});
