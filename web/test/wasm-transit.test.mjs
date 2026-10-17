// Contract test of the REAL compiled wasm adapter for the metro (City.transit_rules,
// place_tunnel, place_station, previews, removals, transit_layer, transit_stats, transit_params),
// through its JavaScript API. Run with scripts/test-wasm.sh: WASM_PKG_DIR must name a
// wasm-bindgen --target nodejs build. Without it the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: build the package for Node (see scripts/test-wasm.sh)";

const OK = 1, FAILED = 0;
const NOTHING = 0, TUNNEL = 1, TUNNEL_WORKING = 2, STATION = 3, STATION_WORKING = 4;

describe("wasm metro", { skip: SKIP }, () => {
  let City;
  before(() => {
    const require = createRequire(import.meta.url);
    ({ City } = require(join(PKG_DIR, "micropolis_wasm.js")));
  });

  const bare = () => City.new_sized(80, 67, 5);
  // [tunnel cost, station cost, radius, traffic cut %, land bonus, most stations]
  const params = (city) => Array.from(city.transit_params());

  // A land tile on row y with `n` land tiles in a row from it, found on the real map.
  function landRun(city, n) {
    const w = city.width(), h = city.height(), tiles = city.tiles();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x + n <= w; x++) {
        let ok = true;
        for (let k = 0; k < n && ok; k++) ok = (tiles[(x + k) * h + y] & 0x3ff) === 0;
        if (ok) return { x, y };
      }
    }
    throw new Error("no bare land run on this map");
  }

  test("the rules are off by default, and everything is refused and free", () => {
    const city = bare();
    assert.equal(city.transit_rules(), false);
    const { x, y } = landRun(city, 3);
    const funds = city.funds();
    assert.equal(city.place_tunnel(x, y), FAILED);
    assert.equal(city.place_station(x, y), FAILED);
    assert.equal(city.remove_tunnel(x, y), FAILED);
    assert.equal(city.remove_station(x, y), FAILED);
    assert.deepEqual(Array.from(city.tunnel_preview(x, y)), [0, 0]);
    assert.deepEqual(Array.from(city.station_preview(x, y)), [0, 0]);
    assert.equal(city.funds(), funds);
    assert.deepEqual(Array.from(city.transit_stats()), [0, 0, 0, 0]);
  });

  test("the layer has one value per tile, in the order of tiles(), and starts empty", () => {
    const city = bare();
    const layer = city.transit_layer();
    assert.ok(layer instanceof Uint8Array);
    assert.equal(layer.length, city.tiles().length);
    assert.ok(layer.every((v) => v === NOTHING));
  });

  test("the constants are the engine's", () => {
    const p = params(bare());
    assert.equal(p.length, 6);
    assert.ok(p.every((v) => v > 0), `${p}`);
  });

  test("two stations joined by a tunnel make one line; the funds follow the costs", () => {
    const city = bare();
    const [tunnelCost, stationCost, radius] = params(city);
    const { x, y } = landRun(city, 5);
    city.set_transit_rules(true);
    assert.equal(city.transit_rules(), true);
    assert.deepEqual(Array.from(city.tunnel_preview(x + 1, y)), [OK, tunnelCost]);
    assert.deepEqual(Array.from(city.station_preview(x, y)), [OK, stationCost]);
    const funds = city.funds();
    const surface = Array.from(city.tiles());
    for (let k = 0; k <= 4; k++) assert.equal(city.place_tunnel(x + k, y), OK);
    assert.equal(city.place_station(x, y), OK);
    assert.equal(city.funds(), funds - 5 * tunnelCost - stationCost);
    assert.deepEqual(Array.from(city.transit_stats()).slice(0, 3), [1, 4, 0], "one station is no line");
    assert.equal(city.place_station(x + 4, y), OK);
    const [stations, tunnels, lines, covered] = Array.from(city.transit_stats());
    assert.deepEqual([stations, tunnels, lines], [2, 3, 1]);
    assert.ok(covered > 0 && covered <= (2 * radius + 5) * (2 * radius + 1));
    assert.equal(city.funds(), funds - 5 * tunnelCost - 2 * stationCost);
    // the surface is untouched
    assert.deepEqual(Array.from(city.tiles()), surface);
    const layer = city.transit_layer(), h = city.height();
    assert.equal(layer[x * h + y], STATION_WORKING);
    assert.equal(layer[(x + 2) * h + y], TUNNEL_WORKING);
    assert.equal(layer[(x + 4) * h + y], STATION_WORKING);
    // a refusal costs nothing
    assert.equal(city.place_tunnel(x + 2, y), FAILED);
    assert.equal(city.funds(), funds - 5 * tunnelCost - 2 * stationCost);
    // cutting the line: both stations are idle (code 3), the tunnels idle (code 1)
    assert.equal(city.remove_tunnel(x + 2, y), OK);
    assert.equal(city.transit_layer()[x * h + y], STATION);
    assert.equal(city.transit_layer()[(x + 1) * h + y], TUNNEL);
    assert.equal(Array.from(city.transit_stats())[2], 0);
    assert.equal(city.remove_station(x, y), OK);
    assert.equal(city.remove_station(x, y), FAILED);
  });

  test("without money the placement is refused with -2 and the preview says so", () => {
    const city = bare();
    city.set_transit_rules(true);
    const [tunnelCost] = params(city);
    const w = city.width(), h = city.height();
    // dig tunnels tile after tile until the purse is empty (at most one per tile: bounded by the map)
    let last = OK;
    for (let i = 0; i < w * h && last !== -2; i++) last = city.place_tunnel(Math.floor(i / h), i % h);
    assert.equal(last, -2, "the money ran out before the map did");
    assert.ok(city.funds() < tunnelCost);
    const free = Array.from({ length: w * h }, (_, i) => i).find((i) => city.transit_layer()[i] === NOTHING
      && (city.tiles()[i] & 0x3ff) === 0);
    const [x, y] = [Math.floor(free / h), free % h];
    assert.deepEqual(Array.from(city.tunnel_preview(x, y)), [-2, 0]);
    assert.equal(city.place_tunnel(x, y), -2);
    assert.equal(city.transit_layer()[free], NOTHING);
  });

  test("out of the map and under the water are refused", () => {
    const city = bare();
    city.set_transit_rules(true);
    assert.equal(city.place_tunnel(-1, 0), FAILED);
    assert.equal(city.place_station(80, 0), FAILED);
    assert.equal(city.place_tunnel(0, 67), FAILED);
    const w = city.width(), h = city.height(), tiles = city.tiles();
    const water = tiles.findIndex((t) => (t & 0x3ff) >= 2 && (t & 0x3ff) <= 4);
    if (water >= 0) {
      assert.equal(city.place_tunnel(Math.floor(water / h), water % h), FAILED);
      assert.equal(w * h, tiles.length);
    }
  });

  test("the network is saved with the city and the rule comes back on load", () => {
    const city = bare();
    city.set_transit_rules(true);
    const { x, y } = landRun(city, 5);
    for (let k = 0; k <= 4; k++) city.place_tunnel(x + k, y);
    city.place_station(x, y);
    city.place_station(x + 4, y);
    const stats = Array.from(city.transit_stats());
    const layer = Array.from(city.transit_layer());
    const bytes = city.save_city();
    const back = City.new_sized(80, 67, 9);
    assert.equal(back.transit_rules(), false);
    back.load_city(bytes);
    assert.equal(back.transit_rules(), true);
    assert.deepEqual(Array.from(back.transit_stats()), stats);
    assert.deepEqual(Array.from(back.transit_layer()), layer);
    assert.deepEqual(Array.from(back.save_city()), Array.from(bytes), "saved again, the same bytes");
    // a new city has no network
    back.new_random_city(3);
    assert.deepEqual(Array.from(back.transit_stats()), [0, 0, 0, 0]);
  });

  test("the rule off, the network stays but nothing can be added or removed", () => {
    const city = bare();
    city.set_transit_rules(true);
    const { x, y } = landRun(city, 3);
    assert.equal(city.place_tunnel(x, y), OK);
    city.set_transit_rules(false);
    const funds = city.funds();
    assert.equal(city.place_tunnel(x + 1, y), FAILED);
    assert.equal(city.remove_tunnel(x, y), FAILED);
    assert.equal(city.funds(), funds);
    assert.equal(city.transit_layer()[x * city.height() + y], TUNNEL);
    assert.deepEqual(Array.from(city.transit_stats()).slice(0, 2), [0, 1]);
  });
});
