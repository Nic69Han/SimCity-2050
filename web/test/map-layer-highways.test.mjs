// The 2D highways layer: the pure walk over the engine's bytes and the view toggle (map-layer-highways-model.js), and
// the layer itself (map-layer-highways.js) with a fake canvas context and the mock engine (highways: true).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { forEachHighwayStroke, setHighwaysView, highwaysViewState, HIGHWAY } from "../map-layer-highways-model.js";
import { HIGHWAYS_LAYER, HIGHWAY_COLOR, HIGHWAY_WIDTH_TILES } from "../map-layer-highways.js";
import { MockCity, MOCK_TOOLS } from "./mock-engine.mjs";

// Column-major bytes of a w x h map, from a list of highway tiles.
function layerOf(w, h, tiles) {
  const out = new Uint8Array(w * h);
  for (const [x, y] of tiles) out[x * h + y] = HIGHWAY;
  return out;
}
function strokesOf(bytes, w, h) {
  const out = [];
  forEachHighwayStroke(bytes, w, h, (x0, y0, x1, y1) => out.push([x0, y0, x1, y1]));
  return out;
}

describe("forEachHighwayStroke", () => {
  test("a link to each highway east and south, a point for a tile alone", () => {
    const w = 4, h = 3;
    assert.deepEqual(strokesOf(layerOf(w, h, [[0, 0], [1, 0]]), w, h), [[0, 0, 1, 0]]);
    assert.deepEqual(strokesOf(layerOf(w, h, [[2, 2]]), w, h), [[2, 2, 2, 2]]);
  });

  test("an L shape is linked both ways, each link once", () => {
    const w = 3, h = 3;
    const got = strokesOf(layerOf(w, h, [[0, 0], [1, 0], [0, 1]]), w, h);
    assert.deepEqual(got, [[0, 0, 1, 0], [0, 0, 0, 1]]);
  });

  test("a tile with a neighbour before it (west or north) gets no point of its own", () => {
    const w = 3, h = 3;
    const got = strokesOf(layerOf(w, h, [[0, 0], [1, 0]]), w, h);
    assert.equal(got.some(([x0, y0, x1, y1]) => x0 === x1 && y0 === y1 && x0 === 1), false);
  });

  test("no highway, no stroke; the map edge has no neighbour beyond it", () => {
    assert.deepEqual(strokesOf(new Uint8Array(9), 3, 3), []);
    assert.deepEqual(strokesOf(layerOf(3, 3, [[2, 2]]), 3, 3), [[2, 2, 2, 2]]);
  });

  test("a full 2x2 map: each link once, in engine order", () => {
    assert.deepEqual(strokesOf(Uint8Array.of(1, 1, 1, 1), 2, 2), [[0, 0, 1, 0], [0, 0, 0, 1], [0, 1, 1, 1], [1, 0, 1, 1]]);
  });

  test("the walk is bounded by the map: extra bytes, bad sizes and non-arrays", () => {
    const got = [];
    forEachHighwayStroke(Uint8Array.of(1, 1, 1, 1, 1, 1, 1, 1), 2, 2, () => got.push(1));
    assert.equal(got.length, 4, "the bytes past width * height are ignored: four links, at most two per tile");
    let calls = 0;
    forEachHighwayStroke(new Uint8Array(4).fill(1), 0, 2, () => calls++);
    forEachHighwayStroke(null, 2, 2, () => calls++);
    forEachHighwayStroke([1, 1], 2, 2, () => calls++);
    assert.equal(calls, 0);
  });

  test("the highway value is 1; any other byte is not a highway", () => {
    assert.equal(HIGHWAY, 1);
    assert.deepEqual(strokesOf(Uint8Array.of(0, 2, 3, 0), 2, 2), []);
  });
});

describe("the view toggle «Voir les autoroutes»", () => {
  test("off by default; setHighwaysView reports whether it changed", () => {
    assert.deepEqual(highwaysViewState(), { show: false });
    assert.equal(setHighwaysView(true), true);
    assert.equal(setHighwaysView(true), false, "no change the second time");
    assert.deepEqual(highwaysViewState(), { show: true });
    assert.equal(setHighwaysView(0), true);
    assert.equal(highwaysViewState().show, false);
  });

  test("highwaysViewState is a copy", () => {
    const state = highwaysViewState();
    state.show = true;
    assert.equal(highwaysViewState().show, false);
  });
});

// A fake canvas context that records what the layer does.
function fakeCtx() {
  const log = [];
  return {
    log,
    save() { log.push(["save"]); },
    restore() { log.push(["restore"]); },
    beginPath() { log.push(["beginPath"]); },
    moveTo(x, y) { log.push(["moveTo", x, y]); },
    lineTo(x, y) { log.push(["lineTo", x, y]); },
    stroke() { log.push(["stroke", this.strokeStyle, this.lineWidth, this.lineCap]); },
    strokeStyle: null, lineWidth: 0, lineCap: "butt",
  };
}

// A mock city of 40 x 30 with the highways rule on and a road along y = 15 from x = 20 to x = 22, two highways on it.
function cityWithHighways() {
  const city = new MockCity(1, { highways: true, rubble: 0 });
  const road = MOCK_TOOLS.findIndex((t) => t.key === "road");
  for (let x = 20; x <= 22; x++) city.tool_down(road, x, 15);
  city.set_highway_rules(true);
  city.place_highway(20, 15);
  city.place_highway(21, 15);
  return city;
}

describe("HIGHWAYS_LAYER", () => {
  test("visible only with the rule on and the view asked, and only with the engine's methods", () => {
    const city = cityWithHighways();
    setHighwaysView(false);
    assert.equal(HIGHWAYS_LAYER.visible(city), false, "the view is not asked");
    setHighwaysView(true);
    assert.equal(HIGHWAYS_LAYER.visible(city), true);
    city.set_highway_rules(false);
    assert.equal(HIGHWAYS_LAYER.visible(city), false, "the rule is off");
    assert.equal(HIGHWAYS_LAYER.visible(new MockCity(1)), false, "no highways in the engine");
    assert.equal(HIGHWAYS_LAYER.visible({}), false);
    setHighwaysView(false);
  });

  test("the name and the drawing function of a layer", () => {
    assert.equal(HIGHWAYS_LAYER.name, "highways");
    assert.equal(typeof HIGHWAYS_LAYER.draw, "function");
    assert.throws(() => { HIGHWAYS_LAYER.name = "x"; }, TypeError, "frozen");
  });

  test("draws a wide orange-red stroke from tile centre to tile centre, inside save and restore", () => {
    const city = cityWithHighways();
    const ctx = fakeCtx();
    HIGHWAYS_LAYER.draw(ctx, city, 10);
    assert.deepEqual(ctx.log[0], ["save"]);
    assert.deepEqual(ctx.log.at(-1), ["restore"]);
    // the two highways (20, 15) and (21, 15) make one link: centres at (20.5, 15.5) and (21.5, 15.5) at scale 10
    assert.deepEqual(ctx.log.filter((e) => e[0] === "moveTo" || e[0] === "lineTo"), [
      ["moveTo", 205, 155], ["lineTo", 215, 155],
    ]);
    const stroke = ctx.log.find((e) => e[0] === "stroke");
    assert.equal(stroke[1], HIGHWAY_COLOR);
    assert.equal(stroke[2], Math.max(2, 10 * HIGHWAY_WIDTH_TILES));
    assert.equal(stroke[3], "round");
  });

  test("the band is at least 2 pixels wide, however small the scale", () => {
    const ctx = fakeCtx();
    HIGHWAYS_LAYER.draw(ctx, cityWithHighways(), 1);
    assert.equal(ctx.log.find((e) => e[0] === "stroke")[2], 2);
    assert.equal(HIGHWAY_COLOR, "rgb(230, 81, 0)");
  });
});
