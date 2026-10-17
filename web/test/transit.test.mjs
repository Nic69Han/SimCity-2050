// The metro on the page: the pure model (transit-model.js), the tool module (tools-transit.js)
// and the 2D layer (map-layer-transit.js), against a small fake engine (not the real one: the
// real wasm contract is web/test/wasm-transit.test.mjs).
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as model from "../transit-model.js";
import * as tools from "../tools-transit.js";
import { TRANSIT_LAYER, COLORS } from "../map-layer-transit.js";
import { MAP_LAYERS } from "../map-layers.js";
import { extraCatalog, extraCalls, extraBlockedReason, isExtraTool } from "../extra-tools.js";
import { groupCatalog, shortcutRows, SHORTCUTS } from "../tools.js";
import { MockCity } from "./mock-engine.mjs";

// A fake engine with the metro API: tunnels cost 50, stations 500, a free tile is any (x, y) on a
// 10 x 6 map except the water tile (9, 5). Placements are recorded.
class FakeMetro extends MockCity {
  constructor() {
    super(1);
    this.rules = false;
    this.grid = new Uint8Array(60);
    this.calls = [];
    this.money = 10000;
  }
  width() { return 10; }
  height() { return 6; }
  transit_rules() { return this.rules; }
  set_transit_rules(on) { this.rules = Boolean(on); }
  transit_params() { return Int32Array.of(50, 500, 3, 40, 12, 64); }
  #plan(x, y, code, cost) {
    if (!this.rules || x < 0 || y < 0 || x >= 10 || y >= 6 || (x === 9 && y === 5)) return [0, 0];
    if (this.grid[x * 6 + y] !== 0 && !(code === 2 && this.grid[x * 6 + y] === 1)) return [0, 0];
    return this.money < cost ? [-2, 0] : [1, cost];
  }
  #place(x, y, code, cost) {
    this.calls.push([code === 1 ? "tunnel" : "station", x, y]);
    const [r] = this.#plan(x, y, code, cost);
    if (r === 1) { this.grid[x * 6 + y] = code; this.money -= cost; }
    return r;
  }
  place_tunnel(x, y) { return this.#place(x, y, 1, 50); }
  tunnel_preview(x, y) { return Int32Array.from(this.#plan(x, y, 1, 50)); }
  remove_tunnel() { return 0; }
  place_station(x, y) { return this.#place(x, y, 2, 500); }
  station_preview(x, y) { return Int32Array.from(this.#plan(x, y, 2, 500)); }
  remove_station() { return 0; }
  transit_layer() {
    return this.grid.map((v) => (v === 1 ? model.CODE_TUNNEL : v === 2 ? model.CODE_STATION : 0));
  }
  transit_stats() { return Int32Array.of(0, 0, 0, 0); }
}

beforeEach(() => {
  model.setPlanShown(false);
  model.setMetroToolActive(false);
});

describe("the model", () => {
  test("feature detection and the engine's flag", () => {
    assert.equal(model.supportsTransit(new MockCity(1)), false);
    assert.equal(model.readTransit(new MockCity(1)), false);
    assert.equal(model.setTransit(new MockCity(1), true), false, "an engine without the metro answers off");
    const city = new FakeMetro();
    assert.equal(model.supportsTransit(city), true);
    assert.equal(model.readTransit(city), false);
    assert.equal(model.setTransit(city, true), true);
    assert.equal(city.rules, true);
    assert.equal(model.setTransit(city, false), false);
  });

  test("the numbers come from the engine, with defaults for an older one", () => {
    assert.deepEqual(model.readParams(new FakeMetro()), {
      tunnelCost: 50, stationCost: 500, radius: 3, trafficCutPct: 40, landBonus: 12, maxStations: 64,
    });
    assert.equal(model.readParams(new MockCity(1)).radius, model.DEFAULT_RADIUS);
  });

  test("the reasons a metro tool is blocked", () => {
    assert.match(model.transitBlockedReason({ rules: false, in3d: false }), /Activez « Métro »/u);
    assert.match(model.transitBlockedReason({ rules: true, in3d: true }), /carte 2D/u);
    assert.equal(model.transitBlockedReason({ rules: true, in3d: false }), "");
    assert.match(model.TRANSIT_HELP, /trafic baisse/u);
  });

  test("the stats line, with singular and plural", () => {
    assert.equal(model.formatTransitStats(Int32Array.of(2, 5, 1, 120)),
      "Métro : 2 stations, 5 tunnels, 1 ligne en service, 120 tuiles desservies");
    assert.equal(model.formatTransitStats([1, 1, 0, 0]),
      "Métro : 1 station, 1 tunnel, 0 ligne en service, 0 tuile desservie");
    assert.equal(model.formatTransitStats(undefined), "Métro : 0 station, 0 tunnel, 0 ligne en service, 0 tuile desservie");
  });

  test("a dug line touches the previous tile by a side, never by a corner", () => {
    const touches = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
    for (const [x0, y0, x1, y1] of [[0, 0, 5, 0], [5, 3, 0, 3], [0, 0, 0, 4], [0, 0, 4, 4], [4, 4, 0, 1], [1, 5, 6, 2], [2, 2, 2, 2]]) {
      const path = model.tunnelPath(x0, y0, x1, y1);
      let prev = { x: x0, y: y0 };
      for (const t of path) {
        assert.ok(touches(prev, t), `${x0},${y0} -> ${x1},${y1}: ${prev.x},${prev.y} then ${t.x},${t.y}`);
        prev = t;
      }
      assert.deepEqual(prev, { x: x1, y: y1 });
      assert.equal(path.some((t) => t.x === x0 && t.y === y0 && (x0 !== x1 || y0 !== y1)), false, "start excluded");
    }
    assert.deepEqual(model.tunnelPath(3, 3, 3, 3), []);
  });

  test("a run of placements is summarized: no money wins, then success, else the last refusal", () => {
    assert.equal(model.summarize([1, 0, -2]), -2);
    assert.equal(model.summarize([0, 1, 0]), 1);
    assert.equal(model.summarize([0, 0]), 0);
    assert.equal(model.summarize([]), 0);
  });

  test("the network is shown while the rule is on and a tool is chosen or the plan is on", () => {
    const city = new FakeMetro();
    assert.equal(model.metroShown(city), false);
    model.setPlanShown(true);
    assert.equal(model.metroShown(city), false, "the rule is off");
    city.rules = true;
    assert.equal(model.metroShown(city), true);
    model.setPlanShown(false);
    assert.equal(model.metroShown(city), false);
    model.setMetroToolActive(true);
    assert.equal(model.metroShown(city), true);
    assert.equal(model.isMetroToolActive() && !model.isPlanShown(), true);
  });
});

describe("the tool module", () => {
  test("no tool for an engine without the metro, and the routing finds the module", () => {
    assert.deepEqual(tools.catalog(new MockCity(1)), []);
    assert.equal(tools.calls(new MockCity(1), { kind: "transit", part: "tunnel" }), null);
    assert.equal(tools.blockedReason(new MockCity(1), { in3d: false }), "");
    const city = new FakeMetro();
    const entries = extraCatalog(city).filter((e) => e.kind === "transit");
    assert.deepEqual(entries.map((e) => e.label), ["Tunnel de métro", "Station de métro"]);
    assert.equal(isExtraTool(entries[0]), true);
    assert.equal(typeof extraCalls(city, entries[1]).down, "function");
    assert.equal(tools.calls(city, { kind: "relief" }), null);
  });

  test("the entries show in the palette, with their engine price and a shortcut used once", () => {
    const city = new FakeMetro();
    const entries = tools.catalog(city);
    assert.deepEqual(entries.map((e) => [e.id, e.key, e.cost, e.size]), [
      ["transit:tunnel", "metro_tunnel", 50, 1], ["transit:station", "metro_station", 500, 1],
    ]);
    const shown = groupCatalog(entries).flatMap((g) => g.tools);
    assert.equal(shown.length, 2, "a known palette group");
    const all = [...entries, ...extraCatalog(new MockCity(1))];
    const rows = shortcutRows(all).map((r) => r.key);
    assert.equal(new Set(rows).size, rows.length, "no key twice");
    for (const e of entries) assert.equal(Object.values(SHORTCUTS).includes(e.shortcut), false, e.shortcut);
    assert.equal(tools.label(Int32Array.of(1, 50)), undefined, "the default cost label");
  });

  test("blocked with a French reason while the rule is off, read from the engine itself", () => {
    const city = new FakeMetro();
    const [tunnel, station] = tools.catalog(city);
    for (const e of [tunnel, station]) {
      assert.match(extraBlockedReason(e, city, { in3d: false, flags: {} }), /Activez « Métro »/u);
    }
    city.rules = true;
    assert.equal(extraBlockedReason(tunnel, city, { in3d: false, flags: {} }), "");
    assert.match(extraBlockedReason(station, city, { in3d: true, flags: {} }), /2D/u);
  });

  test("tunnel: footprint, preview and click go to the engine", () => {
    const city = new FakeMetro();
    city.rules = true;
    const [tunnel] = tools.catalog(city);
    const c = tools.calls(city, tunnel);
    assert.deepEqual([...c.footprint(4, 2)], [4, 2, 1, 1]);
    assert.deepEqual([...c.preview(4, 2)], [1, 50]);
    assert.deepEqual([...c.preview(9, 5)], [0, 0], "water");
    assert.equal(c.down(4, 2), 1);
    assert.equal(city.money, 10000 - 50);
    assert.equal(c.down(4, 2), 0, "already there");
  });

  test("tunnel drag digs every tile crossed, by sides, after the start", () => {
    const city = new FakeMetro();
    city.rules = true;
    const c = tools.calls(city, tools.catalog(city)[0]);
    assert.equal(c.drag(1, 1, 4, 3), 1);
    const dug = city.calls.map(([, x, y]) => `${x},${y}`);
    assert.equal(dug.includes("1,1"), false, "the start belongs to the click");
    assert.equal(dug.at(-1), "4,3");
    let prev = [1, 1];
    for (const [, x, y] of city.calls) {
      assert.equal(Math.abs(x - prev[0]) + Math.abs(y - prev[1]), 1);
      prev = [x, y];
    }
    // a drag over a line that exists is not an error; without money it is
    assert.equal(c.drag(1, 1, 4, 3), 0);
    city.money = 0;
    assert.equal(c.drag(5, 0, 8, 0), -2);
  });

  test("station: one per click, a drag does nothing", () => {
    const city = new FakeMetro();
    city.rules = true;
    const c = tools.calls(city, tools.catalog(city)[1]);
    assert.deepEqual([...c.preview(2, 2)], [1, 500]);
    assert.equal(c.down(2, 2), 1);
    assert.equal(city.money, 10000 - 500);
    assert.equal(c.drag(2, 2, 6, 2), 0);
    assert.equal(city.calls.length, 1);
  });
});

describe("the map layer", () => {
  // A context that records what is painted, with the fill style in force at each call.
  function recorder() {
    const log = [];
    const ctx = {
      fillStyle: "", strokeStyle: "", lineWidth: 0,
      save: () => log.push(["save"]), restore: () => log.push(["restore"]),
      beginPath: () => log.push(["beginPath"]),
      arc(x, y, r) { log.push(["arc", x, y, r, this.fillStyle]); },
      fill() { log.push(["fill"]); },
      stroke() { log.push(["stroke"]); },
      fillRect(x, y, w, h) { log.push(["rect", x, y, w, h, this.fillStyle]); },
    };
    return { ctx, log };
  }

  test("it is the transit layer of the page, after the water layer", () => {
    assert.equal(MAP_LAYERS.at(-1), TRANSIT_LAYER);
    assert.equal(TRANSIT_LAYER.name, "transit");
  });

  test("visible only with the rule on and a metro tool or the plan", () => {
    const city = new FakeMetro();
    assert.equal(TRANSIT_LAYER.visible(city), false);
    city.rules = true;
    assert.equal(TRANSIT_LAYER.visible(city), false, "nothing asked");
    model.setMetroToolActive(true);
    assert.equal(TRANSIT_LAYER.visible(city), true);
    model.setMetroToolActive(false);
    model.setPlanShown(true);
    assert.equal(TRANSIT_LAYER.visible(city), true);
    city.rules = false;
    assert.equal(TRANSIT_LAYER.visible(city), false);
    assert.equal(TRANSIT_LAYER.visible({}), false, "an engine without the metro");
  });

  test("draws tunnels as tiles, stations as discs, and the reach of working stations faintly", () => {
    const city = new FakeMetro();
    // tunnel (1,1), working tunnel, station (2,2), working station (3,3): layer codes by hand
    const codes = new Uint8Array(60);
    codes[1 * 6 + 1] = model.CODE_TUNNEL;
    codes[2 * 6 + 1] = model.CODE_TUNNEL_WORKING;
    codes[2 * 6 + 2] = model.CODE_STATION;
    codes[3 * 6 + 3] = model.CODE_STATION_WORKING;
    city.transit_layer = () => codes;
    const { ctx, log } = recorder();
    TRANSIT_LAYER.draw(ctx, city, 16);
    const rects = log.filter((e) => e[0] === "rect");
    assert.deepEqual(rects.map((r) => r.slice(1)), [
      [16, 16, 16, 16, COLORS.tunnel],
      [32, 16, 16, 16, COLORS.tunnelWorking],
    ]);
    const arcs = log.filter((e) => e[0] === "arc");
    assert.deepEqual(arcs.map((a) => a.slice(1)), [
      [3.5 * 16, 3.5 * 16, 3 * 16, COLORS.reach], // the reach, radius 3 from the engine
      [2.5 * 16, 2.5 * 16, 0.45 * 16, COLORS.station],
      [3.5 * 16, 3.5 * 16, 0.45 * 16, COLORS.stationWorking],
    ]);
    assert.equal(log.at(0)[0], "save");
    assert.equal(log.at(-1)[0], "restore");
    assert.ok(log.indexOf(arcs[0]) < log.indexOf(rects[0]), "the reach is under the tunnels");
  });

  test("an empty network paints nothing but saves and restores the context", () => {
    const city = new FakeMetro();
    const { ctx, log } = recorder();
    TRANSIT_LAYER.draw(ctx, city, 16);
    assert.deepEqual(log.map((e) => e[0]), ["save", "restore"]);
  });
});
