// The water network on the page: the pure model, the tool module and the 2D layer
// (docs/game-design-v02.md, "Réseau d'eau"), against a small fake of the engine's water methods.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  supportsWater, readWater, setWater, waterBlockedReason, waterToolPressed, statsText, networkShapes,
  WATER_TOOL_KEYS, LAYER,
} from "../water-model.js";
import * as tools from "../tools-water.js";
import { WATER_LAYER, setWaterView, waterViewState } from "../map-layer-water.js";
import { extraCatalog, extraCalls, extraBlockedReason } from "../extra-tools.js";
import { groupCatalog } from "../tools.js";
import { createMapLayers } from "../map-layers.js";

// A fake of the water side of the wasm City: a W x H map, pipes in a Map, no rules of its own
// beyond "rules off refuses everything" (the engine's rules are tested in Rust).
class WaterCity {
  constructor(w = 6, h = 5) {
    this.w = w; this.h = h; this.rules = false; this.pieces = new Map(); this.log = [];
    this.fed = new Set(); this.dry = [];
  }
  width() { return this.w; }
  height() { return this.h; }
  water_rules() { return this.rules; }
  set_water_rules(on) { this.rules = on; }
  water_costs() { return Int32Array.of(5, 300, 64); }
  #ok(x, y) { return this.rules && x >= 0 && y >= 0 && x < this.w && y < this.h; }
  place_pipe(x, y) { this.log.push(["pipe", x, y]); if (!this.#ok(x, y) || this.pieces.has(`${x},${y}`)) return 0; this.pieces.set(`${x},${y}`, 1); return 1; }
  pipe_preview(x, y) { return Int32Array.of(this.#ok(x, y) && !this.pieces.has(`${x},${y}`) ? 1 : 0, 5); }
  remove_pipe(x, y) { this.log.push(["rmpipe", x, y]); return this.pieces.get(`${x},${y}`) === 1 ? (this.pieces.delete(`${x},${y}`), 1) : 0; }
  place_pump(x, y) { this.log.push(["pump", x, y]); if (!this.#ok(x, y)) return 0; this.pieces.set(`${x},${y}`, 3); return 1; }
  pump_preview(x, y) { return Int32Array.of(this.#ok(x, y) ? 1 : 0, 300); }
  remove_pump(x, y) { this.log.push(["rmpump", x, y]); return this.pieces.get(`${x},${y}`) === 3 ? (this.pieces.delete(`${x},${y}`), 1) : 0; }
  water_piece(x, y) { return this.pieces.get(`${x},${y}`) ?? 0; }
  water_layer() {
    const out = new Uint8Array(this.w * this.h);
    for (const [k, v] of this.pieces) {
      const [x, y] = k.split(",").map(Number);
      out[x * this.h + y] = v === 3 ? 3 : this.fed.has(k) ? 2 : 1;
    }
    return out;
  }
  water_dry_zones() { return Int32Array.from(this.dry); }
  water_stats() { return Int32Array.of(1, 4, 2, 3); }
}

// Records the 2D context calls the layer makes.
function fakeCtx() {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    save: rec("save"), restore: rec("restore"), beginPath: rec("beginPath"), moveTo: rec("moveTo"),
    lineTo: rec("lineTo"), stroke: rec("stroke"), fill: rec("fill"), arc: rec("arc"), fillRect: rec("fillRect"),
  };
}

describe("water model", () => {
  test("the engine is recognised by its methods and the flag is read from it", () => {
    assert.equal(supportsWater(new WaterCity()), true);
    assert.equal(supportsWater({}), false);
    assert.equal(supportsWater(null), false);
    const city = new WaterCity();
    assert.equal(readWater(city), false);
    assert.equal(setWater(city, true), true);
    assert.equal(readWater(city), true);
    assert.equal(setWater({}, true), false);
    assert.equal(readWater({}), false);
  });

  test("the tools are blocked in French until the rules are on, and in 3D", () => {
    assert.match(waterBlockedReason({ rules: false, in3d: false }), /Activez « Réseau d'eau »/);
    assert.match(waterBlockedReason({ rules: true, in3d: true }), /2D/);
    assert.equal(waterBlockedReason({ rules: true, in3d: false }), "");
  });

  test("a pressed water tool is spotted among the pressed buttons", () => {
    assert.equal(waterToolPressed(["route", "pompe"]), true);
    assert.equal(waterToolPressed(["route"]), false);
    assert.equal(waterToolPressed([]), false);
  });

  test("the stats line counts with the right plurals, and is empty for an empty city", () => {
    assert.equal(statsText([1, 4, 2, 3]), "Eau : 1 pompe, 4 canalisations · 2 zones alimentées, 3 à sec");
    assert.equal(statsText([0, 0, 1, 0]), "Eau : 0 pompe, 0 canalisation · 1 zone alimentée, 0 à sec");
    assert.equal(statsText([0, 0, 0, 0]), "");
    assert.equal(statsText(undefined), "");
  });

  test("shapes join neighbouring pieces, fed or dry, and list pumps and lone pipes", () => {
    // 4 x 3 map, index x * 3 + y
    const layer = new Uint8Array(12);
    const set = (x, y, v) => { layer[x * 3 + y] = v; };
    set(0, 0, LAYER.PUMP); set(1, 0, LAYER.PIPE); set(1, 1, LAYER.PIPE); // fed chain
    set(3, 2, LAYER.DRY_PIPE); set(3, 1, LAYER.DRY_PIPE); // dry pair
    set(2, 2, LAYER.PIPE); // lone fed pipe next to a dry one: joined as dry
    const s = networkShapes(layer, 4, 3);
    assert.deepEqual(s.pumps, [[0, 0]]);
    assert.deepEqual(s.fed, [[0, 0, 1, 0], [1, 0, 1, 1]]);
    assert.deepEqual(s.dry, [[2, 2, 3, 2], [3, 1, 3, 2]]);
    assert.deepEqual(s.dots.map(([x, y]) => `${x},${y}`).sort(), ["1,0", "1,1", "2,2", "3,1", "3,2"]);
    assert.deepEqual(networkShapes(new Uint8Array(12), 4, 3), { fed: [], dry: [], pumps: [], dots: [] });
  });
});

describe("water tools", () => {
  let city;
  beforeEach(() => { city = new WaterCity(); city.rules = true; });

  test("an engine without water gives no entry, and the empty-module contract holds", () => {
    assert.deepEqual(tools.catalog({}), []);
    assert.equal(tools.calls({}, { kind: tools.KIND }), null);
    assert.equal(tools.calls(city, { kind: "relief", id: "relief:1" }), null);
    assert.equal(tools.label(Int32Array.of(1, 10)), undefined);
    assert.equal(tools.blockedReason({}, { in3d: false, flags: {} }), "");
  });

  test("the catalog has pipe, pump and removal in the Réseaux group, priced by the engine", () => {
    const entries = tools.catalog(city);
    assert.deepEqual(entries.map((e) => e.key), WATER_TOOL_KEYS.slice());
    assert.deepEqual(entries.map((e) => e.label), ["Canalisation", "Pompe à eau", "Retirer canalisation ou pompe"]);
    assert.deepEqual(entries.map((e) => e.cost), [5, 300, 0]);
    for (const e of entries) {
      assert.equal(e.kind, "water");
      assert.equal(e.group, "reseaux");
      assert.equal(e.size, 1);
    }
    assert.equal(new Set(entries.map((e) => e.id)).size, 3);
    // the palette keeps them: «Réseaux» is one of its groups
    const reseaux = groupCatalog(entries).find((g) => g.id === "reseaux");
    assert.equal(reseaux.tools.length, 3);
  });

  test("the registry routes water entries to this module", () => {
    const entries = extraCatalog(city).filter((e) => e.kind === "water");
    assert.equal(entries.length, 3);
    assert.equal(typeof extraCalls(city, entries[0]).drag, "function");
    assert.match(extraBlockedReason(entries[0], new WaterCity(), { in3d: false, flags: {} }), /Activez/);
    assert.equal(extraBlockedReason(entries[0], city, { in3d: false, flags: {} }), "");
  });

  test("a click lays a pipe or builds a pump; the preview is the engine's", () => {
    const [pipe, pump] = tools.catalog(city);
    const p = tools.calls(city, pipe), q = tools.calls(city, pump);
    assert.deepEqual([...p.footprint(2, 3)], [2, 3, 1, 1]);
    assert.deepEqual([...p.preview(1, 1)], [1, 5]);
    assert.equal(p.down(1, 1), 1);
    assert.deepEqual([...p.preview(1, 1)], [0, 5]);
    assert.equal(q.down(0, 0), 1);
    assert.equal(city.water_piece(0, 0), 3);
    assert.deepEqual([...q.preview(2, 2)], [1, 300]);
  });

  test("a pipe drag lays every tile it crosses, and reports success when one was laid", () => {
    const [pipe] = tools.catalog(city);
    const c = tools.calls(city, pipe);
    c.down(0, 0);
    assert.equal(c.drag(0, 0, 3, 0), 1);
    assert.deepEqual(city.log.filter((l) => l[0] === "pipe").map((l) => l.slice(1)), [[0, 0], [1, 0], [2, 0], [3, 0]]);
    assert.equal(c.drag(0, 0, 3, 0), 0, "all of it was there already");
  });

  test("a drag that runs out of money says so even when some tiles were laid", () => {
    const [pipe] = tools.catalog(city);
    const c = tools.calls(city, pipe);
    let n = 0;
    city.place_pipe = () => (++n < 3 ? 1 : -2);
    assert.equal(c.drag(0, 0, 5, 0), -2);
  });

  test("a pump drag places nothing", () => {
    const [, pump] = tools.catalog(city);
    const before = city.log.length;
    assert.equal(tools.calls(city, pump).drag(0, 0, 4, 4), 1);
    assert.equal(city.log.length, before);
  });

  test("removal takes up a pump or a pipe, and previews by what lies there", () => {
    const [pipe, pump, remove] = tools.catalog(city);
    tools.calls(city, pipe).down(1, 1);
    tools.calls(city, pump).down(2, 2);
    const r = tools.calls(city, remove);
    assert.deepEqual([...r.preview(1, 1)], [1, 0]);
    assert.deepEqual([...r.preview(4, 4)], [0, 0]);
    assert.equal(r.down(2, 2), 1);
    assert.equal(r.down(1, 1), 1);
    assert.equal(city.pieces.size, 0);
    tools.calls(city, pipe).down(0, 0);
    tools.calls(city, pipe).down(1, 0);
    assert.equal(r.drag(0, 0, 1, 0), 1, "the tile after the start");
    assert.equal(city.pieces.size, 1);
  });

  test("the blocked reason follows the engine's flag", () => {
    city.rules = false;
    assert.match(tools.blockedReason(city, { in3d: false }), /Activez « Réseau d'eau »/);
    city.rules = true;
    assert.equal(tools.blockedReason(city, { in3d: false }), "");
    assert.match(tools.blockedReason(city, { in3d: true }), /2D/);
  });

  test("a button title says the name, then the reason or the hint", () => {
    assert.match(tools.buttonTitle("canalisation", ""), /^Canalisation : /);
    assert.equal(tools.buttonTitle("pompe", "raison"), "Pompe à eau : raison");
    assert.equal(tools.buttonTitle("inconnu", ""), "");
  });
});

describe("water layer", () => {
  let city;
  beforeEach(() => {
    city = new WaterCity(6, 5);
    city.rules = true;
    setWaterView({ show: false, tool: false });
  });

  test("it is registered with the map layers under the name water", () => {
    assert.equal(WATER_LAYER.name, "water");
    assert.equal(typeof WATER_LAYER.draw, "function");
  });

  test("it shows only with the rules on and a view chosen", () => {
    assert.equal(WATER_LAYER.visible(city), false);
    assert.equal(setWaterView({ show: true }), true);
    assert.equal(setWaterView({ show: true }), false, "unchanged");
    assert.equal(WATER_LAYER.visible(city), true);
    city.rules = false;
    assert.equal(WATER_LAYER.visible(city), false);
    city.rules = true;
    setWaterView({ show: false, tool: true });
    assert.equal(WATER_LAYER.visible(city), true);
    assert.deepEqual(waterViewState(), { show: false, tool: true });
    assert.equal(WATER_LAYER.visible({}), false, "an engine without water");
  });

  test("it makes the map renderer repaint the tiles first, then stop doing so", () => {
    const layers = createMapLayers([WATER_LAYER]);
    assert.equal(layers.plan(city).full, false);
    setWaterView({ tool: true });
    assert.equal(layers.plan(city).full, true);
    setWaterView({ tool: false });
    assert.equal(layers.plan(city).full, true, "one more full repaint erases it");
    assert.equal(layers.plan(city).full, false);
  });

  test("it tints dry zones, strokes fed and dry pipes, and discs the pumps", () => {
    city.pieces.set("0,0", 3);
    city.pieces.set("1,0", 1); city.fed.add("1,0");
    city.pieces.set("4,3", 1); // dry
    city.dry = [3, 2, 1, 1];
    const ctx = fakeCtx();
    WATER_LAYER.draw(ctx, city, 8);
    const rects = ctx.calls.filter((c) => c[0] === "fillRect");
    assert.deepEqual(rects.slice(0, 2).map((c) => c.slice(1)), [[16, 8, 24, 24], [0, 0, 24, 24]], "3 x 3 tiles per dry zone");
    const strokes = ctx.calls.filter((c) => c[0] === "stroke");
    assert.equal(strokes.length >= 2, true, "the fed segment and the pump edge");
    const moves = ctx.calls.filter((c) => c[0] === "moveTo").map((c) => c.slice(1));
    assert.deepEqual(moves, [[4, 4]], "one fed segment, from the pump to the pipe");
    const arcs = ctx.calls.filter((c) => c[0] === "arc");
    assert.equal(arcs.length, 1);
    assert.deepEqual(arcs[0].slice(1, 3), [4, 4], "centred on the pump tile");
    assert.equal(ctx.calls.filter((c) => c[0] === "save").length, ctx.calls.filter((c) => c[0] === "restore").length);
  });

  test("an empty network and no dry zone draw nothing", () => {
    const ctx = fakeCtx();
    WATER_LAYER.draw(ctx, city, 8);
    assert.equal(ctx.calls.filter((c) => c[0] === "fillRect" || c[0] === "arc" || c[0] === "stroke").length, 0);
  });
});
