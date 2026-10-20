// Contract test of the trains and the metro (docs/game-design-v06.md) in the REAL compiled wasm
// adapter: rail_stats() = [trains, metro_cars, train_riders_month, metro_riders_month,
// rail_income_month, train_lines, metro_lines], zeros unless the transport runs, and the gare
// (genre 13) refused where no classic rail tile touches it. Run with scripts/test-wasm.sh, which
// sets WASM_PKG_DIR; without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: run scripts/test-wasm.sh";
const HAIGHT = readFileSync(fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url)));
const GARE = 13;

describe("wasm trains and metro", { skip: SKIP }, () => {
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

  test("rail_stats has seven numbers, all zero while the rules are off or nothing is built", () => {
    const city = load();
    assert.deepEqual(Array.from(city.rail_stats()), [0, 0, 0, 0, 0, 0, 0]);
    city.set_agent_rules(true);
    city.set_structure_rules(true);
    for (let i = 0; i < 100; i++) city.tick();
    assert.deepEqual(Array.from(city.rail_stats()), [0, 0, 0, 0, 0, 0, 0]);
  });

  test("a gare needs a rail tile next to it: on a bare corner of the map it is refused", () => {
    const city = load();
    city.set_structure_rules(true);
    assert.equal(city.place_structure(GARE, 0, 0), 0);
    assert.equal(city.structures().length, 0);
  });
});
