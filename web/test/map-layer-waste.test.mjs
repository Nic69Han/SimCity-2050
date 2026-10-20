// The 2D waste layer and its pure part: levels and tints, the column-major walk, the view toggle.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WASTE_LAYER } from "../map-layer-waste.js";
import {
  WASTE_LEVELS, WASTE_MAX, levelOf, tintOf, forEachTint, setWasteView, wasteViewState,
} from "../map-layer-waste-model.js";

const W = 3, H = 2;

// A 2D context that records the rectangles it fills, with the colour in force.
function fakeCtx() {
  return {
    fillStyle: null,
    rects: [],
    fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, style: this.fillStyle }); },
  };
}

// A city with the waste engine the test controls.
function fakeCity({ rules = true, bytes = new Uint8Array(W * H) } = {}) {
  return {
    width: () => W,
    height: () => H,
    waste_rules: () => rules,
    waste_layer: () => bytes,
  };
}

// Puts `value` on the tile (x, y), with the engine's column-major index x * height + y.
function setTile(bytes, x, y, value) {
  bytes[x * H + y] = value;
}

describe("the view toggle (module-owned state)", () => {
  test("starts off; setWasteView reports whether it changed", () => {
    setWasteView(false);
    assert.deepEqual(wasteViewState(), { show: false });
    assert.equal(setWasteView(true), true);
    assert.equal(setWasteView(true), false, "unchanged");
    assert.deepEqual(wasteViewState(), { show: true });
    assert.equal(setWasteView(0), true);
    assert.equal(setWasteView(undefined), false, "a falsy value is off");
    assert.deepEqual(wasteViewState(), { show: false });
  });

  test("wasteViewState returns a copy", () => {
    setWasteView(false);
    wasteViewState().show = true;
    assert.equal(wasteViewState().show, false);
  });
});

describe("levels", () => {
  test("WASTE_MAX is 255 and there are four levels starting at 1, 64, 128 and 192", () => {
    assert.equal(WASTE_MAX, 255);
    assert.deepEqual(WASTE_LEVELS.map((l) => l.min), [1, 64, 128, 192]);
  });

  test("the alpha grows with the level", () => {
    const alphas = WASTE_LEVELS.map((l) => l.alpha);
    for (let i = 1; i < alphas.length; i++) assert.ok(alphas[i] > alphas[i - 1]);
  });

  test("0 has no level; the boundaries of each level are exact", () => {
    assert.equal(levelOf(0), -1);
    assert.equal(levelOf(1), 0);
    assert.equal(levelOf(63), 0);
    assert.equal(levelOf(64), 1);
    assert.equal(levelOf(127), 1);
    assert.equal(levelOf(128), 2);
    assert.equal(levelOf(191), 2);
    assert.equal(levelOf(192), 3);
    assert.equal(levelOf(255), 3);
  });

  test("a value the layer does not hold has no level", () => {
    for (const v of [-1, 256, 1.5, NaN, undefined, "1", null]) assert.equal(levelOf(v), -1, String(v));
  });

  test("tintOf: no tint for 0, a tint per level, the same tint inside a level", () => {
    assert.equal(tintOf(0), null);
    const tints = [1, 64, 128, 192].map(tintOf);
    assert.equal(new Set(tints).size, 4, "four different tints");
    for (const t of tints) assert.match(t, /^rgba\(121, 85, 72, [0-9.]+\)$/);
    assert.equal(tintOf(10), tintOf(1), "one level, one tint");
    assert.equal(tintOf(200), tintOf(192));
  });

  test("tintOf: a value the layer does not hold has no tint", () => {
    for (const v of [256, -3, 0.5, NaN]) assert.equal(tintOf(v), null, String(v));
  });
});

describe("forEachTint: the column-major walk", () => {
  test("a value at index x * height + y is visited at tile (x, y)", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 1, 0, 200);
    setTile(bytes, 2, 1, 5);
    const seen = [];
    forEachTint(bytes, W, H, (x, y, tint) => seen.push([x, y, tint]));
    assert.deepEqual(seen, [[1, 0, tintOf(200)], [2, 1, tintOf(5)]]);
  });

  test("index 2 is tile (1, 0), not (0, 2): the order is column-major", () => {
    const bytes = new Uint8Array(W * H);
    bytes[2] = 70;
    const seen = [];
    forEachTint(bytes, W, H, (x, y) => seen.push([x, y]));
    assert.deepEqual(seen, [[1, 0]]);
  });

  test("the tints of a column of tiles follow their levels", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 0, 0, 1);
    setTile(bytes, 0, 1, 255);
    const seen = [];
    forEachTint(bytes, W, H, (x, y, tint) => seen.push([x, y, tint]));
    assert.deepEqual(seen, [[0, 0, tintOf(1)], [0, 1, tintOf(255)]]);
  });

  test("bytes past width * height are ignored; a shorter array visits what it holds", () => {
    const long = new Uint8Array(W * H + 2);
    long[W * H] = 255;
    long[W * H + 1] = 255;
    let n = 0;
    forEachTint(long, W, H, () => n++);
    assert.equal(n, 0, "past the map");
    const short = Uint8Array.from([255]);
    const seen = [];
    forEachTint(short, W, H, (x, y) => seen.push([x, y]));
    assert.deepEqual(seen, [[0, 0]]);
  });

  test("nothing visited for a missing array, a non-typed array, or an empty map", () => {
    let n = 0;
    forEachTint(null, W, H, () => n++);
    forEachTint([255, 255, 255, 255, 255, 255], W, H, () => n++);
    forEachTint(new Uint8Array(W * H).fill(255), 0, H, () => n++);
    forEachTint(new Uint8Array(W * H).fill(255), W, 0, () => n++);
    assert.equal(n, 0);
  });

  test("at most one visit per tile, however full the map", () => {
    let n = 0;
    forEachTint(new Uint8Array(W * H + 4).fill(255), W, H, () => n++);
    assert.equal(n, W * H);
  });
});

describe("the layer", () => {
  test("named waste, with the draw and visible functions", () => {
    assert.equal(WASTE_LAYER.name, "waste");
    assert.equal(typeof WASTE_LAYER.draw, "function");
    assert.equal(typeof WASTE_LAYER.visible, "function");
  });

  test("visible only when the engine has the API, the rule is on and the view is asked", () => {
    setWasteView(true);
    assert.equal(WASTE_LAYER.visible(fakeCity()), true);
    assert.equal(WASTE_LAYER.visible(fakeCity({ rules: false })), false, "rule off");
    setWasteView(false);
    assert.equal(WASTE_LAYER.visible(fakeCity()), false, "view not asked");
    setWasteView(true);
    assert.equal(WASTE_LAYER.visible({}), false, "an engine without waste");
    assert.equal(WASTE_LAYER.visible({ waste_rules: () => true }), false, "no waste_layer");
    assert.equal(WASTE_LAYER.visible({ waste_layer: () => new Uint8Array(1) }), false, "no waste_rules");
    setWasteView(false);
  });

  test("draws one rectangle per tile with garbage, at (x * scale, y * scale), in its tint", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 0, 0, 1);
    setTile(bytes, 1, 0, 0);
    setTile(bytes, 2, 1, 130);
    const ctx = fakeCtx();
    WASTE_LAYER.draw(ctx, fakeCity({ bytes }), 8);
    assert.deepEqual(ctx.rects, [
      { x: 0, y: 0, w: 8, h: 8, style: tintOf(1) },
      { x: 16, y: 8, w: 8, h: 8, style: tintOf(130) },
    ]);
  });

  test("one rectangle at most per tile: a map of 6 tiles gives at most 6 rectangles", () => {
    const bytes = new Uint8Array(W * H + 4).fill(255);
    const ctx = fakeCtx();
    WASTE_LAYER.draw(ctx, fakeCity({ bytes }), 4);
    assert.equal(ctx.rects.length, W * H);
  });
});
