// The 2D densities layer and its pure part: tints by value, the column-major walk, the view toggle.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DENSITIES_LAYER } from "../map-layer-densities.js";
import {
  DENSITY, tintOf, forEachTint, setDensityView, densityViewState,
} from "../map-layer-densities-model.js";

const W = 3, H = 2;

// A 2D context that records the rectangles it fills, with the colour in force.
function fakeCtx() {
  return {
    fillStyle: null,
    rects: [],
    fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, style: this.fillStyle }); },
  };
}

// A city with the density engine reads the test controls.
function fakeCity({ rules = true, bytes = new Uint8Array(W * H) } = {}) {
  return {
    width: () => W,
    height: () => H,
    density_rules: () => rules,
    density_layer: () => bytes,
  };
}

// Puts `value` on the tile (x, y), with the engine's column-major index x * height + y.
function setTile(bytes, x, y, value) {
  bytes[x * H + y] = value;
}

describe("the view toggle (module-owned state)", () => {
  test("starts off; setDensityView reports whether it changed", () => {
    setDensityView(false);
    assert.deepEqual(densityViewState(), { show: false });
    assert.equal(setDensityView(true), true);
    assert.equal(setDensityView(true), false, "unchanged");
    assert.deepEqual(densityViewState(), { show: true });
    assert.equal(setDensityView(0), true);
    assert.equal(setDensityView(undefined), false, "a falsy value is off");
    assert.deepEqual(densityViewState(), { show: false });
  });

  test("densityViewState returns a copy", () => {
    setDensityView(false);
    densityViewState().show = true;
    assert.equal(densityViewState().show, false);
  });
});

describe("tints", () => {
  test("nothing has no tint; light, medium, dense and farm each have one, all different", () => {
    assert.equal(tintOf(DENSITY.NONE), null);
    const tints = [DENSITY.LIGHT, DENSITY.MEDIUM, DENSITY.DENSE, DENSITY.FARM].map(tintOf);
    for (const t of tints) assert.equal(typeof t, "string");
    assert.equal(new Set(tints).size, 4);
    assert.deepEqual([DENSITY.NONE, DENSITY.LIGHT, DENSITY.MEDIUM, DENSITY.DENSE, DENSITY.FARM], [0, 1, 2, 3, 4]);
  });

  test("a value the layer does not know, or a non-integer, has no tint", () => {
    for (const v of [5, 255, -1, 1.5, NaN, undefined, "1"]) assert.equal(tintOf(v), null, String(v));
  });
});

describe("forEachTint: the column-major walk", () => {
  test("a value at index x * height + y is visited at tile (x, y)", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 1, 0, DENSITY.DENSE);
    setTile(bytes, 2, 1, DENSITY.LIGHT);
    const seen = [];
    forEachTint(bytes, W, H, (x, y, tint) => seen.push([x, y, tint]));
    assert.deepEqual(seen, [[1, 0, tintOf(3)], [2, 1, tintOf(1)]]);
  });

  test("index 2 is tile (1, 0), not (0, 2): the order is column-major", () => {
    const bytes = new Uint8Array(W * H);
    bytes[2] = DENSITY.MEDIUM;
    const seen = [];
    forEachTint(bytes, W, H, (x, y) => seen.push([x, y]));
    assert.deepEqual(seen, [[1, 0]]);
  });

  test("bytes past width * height are ignored; a shorter array visits what it holds", () => {
    const long = new Uint8Array(W * H + 2);
    long[W * H] = DENSITY.FARM;
    long[W * H + 1] = DENSITY.FARM;
    let n = 0;
    forEachTint(long, W, H, () => n++);
    assert.equal(n, 0, "past the map");
    const short = Uint8Array.from([DENSITY.FARM]);
    const seen = [];
    forEachTint(short, W, H, (x, y) => seen.push([x, y]));
    assert.deepEqual(seen, [[0, 0]]);
  });

  test("nothing visited for a missing array, a non-typed array, or an empty map", () => {
    let n = 0;
    forEachTint(null, W, H, () => n++);
    forEachTint([4, 4, 4, 4, 4, 4], W, H, () => n++);
    forEachTint(new Uint8Array(W * H).fill(4), 0, H, () => n++);
    forEachTint(new Uint8Array(W * H).fill(4), W, 0, () => n++);
    assert.equal(n, 0);
  });
});

describe("the layer", () => {
  test("named densities, with the draw and visible functions", () => {
    assert.equal(DENSITIES_LAYER.name, "densities");
    assert.equal(typeof DENSITIES_LAYER.draw, "function");
    assert.equal(typeof DENSITIES_LAYER.visible, "function");
  });

  test("visible only when the engine has the API, the rule is on and the view is asked", () => {
    setDensityView(true);
    assert.equal(DENSITIES_LAYER.visible(fakeCity()), true);
    assert.equal(DENSITIES_LAYER.visible(fakeCity({ rules: false })), false, "rule off");
    setDensityView(false);
    assert.equal(DENSITIES_LAYER.visible(fakeCity()), false, "view not asked");
    setDensityView(true);
    assert.equal(DENSITIES_LAYER.visible({}), false, "an engine without density");
    assert.equal(DENSITIES_LAYER.visible({ density_rules: () => true }), false, "no density_layer");
    setDensityView(false);
  });

  test("draws one rectangle per tinted tile, at (x * scale, y * scale), in its tint", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 0, 0, DENSITY.LIGHT);
    setTile(bytes, 1, 0, DENSITY.NONE);
    setTile(bytes, 2, 1, DENSITY.FARM);
    const ctx = fakeCtx();
    DENSITIES_LAYER.draw(ctx, fakeCity({ bytes }), 8);
    assert.deepEqual(ctx.rects, [
      { x: 0, y: 0, w: 8, h: 8, style: tintOf(DENSITY.LIGHT) },
      { x: 16, y: 8, w: 8, h: 8, style: tintOf(DENSITY.FARM) },
    ]);
  });

  test("one rectangle at most per tile: a map of 6 tiles gives at most 6 rectangles", () => {
    const bytes = new Uint8Array(W * H + 4).fill(DENSITY.DENSE);
    const ctx = fakeCtx();
    DENSITIES_LAYER.draw(ctx, fakeCity({ bytes }), 4);
    assert.equal(ctx.rects.length, W * H);
  });
});
