// The 2D wealth layer and its pure part: tints by value, the column-major walk, the length check, the view toggle.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WEALTH_LAYER } from "../map-layer-wealth.js";
import {
  WEALTH, WEALTH_TINT_MODEST, WEALTH_TINT_MIDDLE, WEALTH_TINT_WEALTHY, wealthTintOf, isWealthLayerOf,
  forEachWealthTint, setWealthView, wealthViewState,
} from "../map-layer-wealth-model.js";

const W = 3, H = 2;

// A 2D context that records the rectangles it fills, with the colour in force.
function fakeCtx() {
  return {
    fillStyle: null,
    rects: [],
    fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, style: this.fillStyle }); },
  };
}

// A city with the wealth engine API the test controls. `bytes` is what wealth_layer() returns.
function fakeCity({ bytes = new Uint8Array(W * H), w = W, h = H, api = true } = {}) {
  const city = { width: () => w, height: () => h };
  if (api) city.wealth_layer = () => bytes;
  return city;
}

// Puts `value` on the tile (x, y), with the engine's column-major index x * height + y.
function setTile(bytes, x, y, value) {
  bytes[x * H + y] = value;
}

describe("the view toggle (module-owned state)", () => {
  test("hidden by default; setWealthView reports whether it changed", () => {
    setWealthView(false);
    assert.deepEqual(wealthViewState(), { show: false });
    assert.equal(setWealthView(true), true);
    assert.equal(setWealthView(true), false, "unchanged");
    assert.deepEqual(wealthViewState(), { show: true });
    assert.equal(setWealthView(0), true);
    assert.equal(setWealthView(undefined), false, "a falsy value is off");
    assert.deepEqual(wealthViewState(), { show: false });
  });

  test("wealthViewState returns a copy", () => {
    setWealthView(false);
    wealthViewState().show = true;
    assert.equal(wealthViewState().show, false);
  });
});

describe("values and tints", () => {
  test("the wealth values are 0 nothing, 1 modest, 2 middle, 3 wealthy", () => {
    assert.deepEqual(WEALTH, { NONE: 0, MODEST: 1, MIDDLE: 2, WEALTHY: 3 });
  });

  test("nothing has no tint; modest, middle and wealthy each have their named tint", () => {
    assert.equal(wealthTintOf(WEALTH.NONE), null);
    assert.equal(wealthTintOf(WEALTH.MODEST), WEALTH_TINT_MODEST);
    assert.equal(wealthTintOf(WEALTH.MIDDLE), WEALTH_TINT_MIDDLE);
    assert.equal(wealthTintOf(WEALTH.WEALTHY), WEALTH_TINT_WEALTHY);
    assert.equal(new Set([WEALTH_TINT_MODEST, WEALTH_TINT_MIDDLE, WEALTH_TINT_WEALTHY]).size, 3);
  });

  test("the three tints are the named colours: brownish orange, yellow-green, deep green, translucent", () => {
    assert.equal(WEALTH_TINT_MODEST, "rgba(191, 110, 40, 0.45)");
    assert.equal(WEALTH_TINT_MIDDLE, "rgba(170, 200, 60, 0.45)");
    assert.equal(WEALTH_TINT_WEALTHY, "rgba(0, 100, 40, 0.6)");
  });

  test("a value the layer does not know, or a non-integer, has no tint", () => {
    for (const v of [4, 255, -1, 1.5, NaN, undefined, "1", null]) assert.equal(wealthTintOf(v), null, String(v));
  });
});

describe("isWealthLayerOf: the length check", () => {
  test("accepts a typed array of exactly width * height bytes", () => {
    assert.equal(isWealthLayerOf(new Uint8Array(W * H), W, H), true);
    assert.equal(isWealthLayerOf(new Uint8Array(4), 2, 2), true);
  });

  test("refuses a short or long array, a plain array, a missing one, and an empty map", () => {
    assert.equal(isWealthLayerOf(new Uint8Array(W * H - 1), W, H), false, "short");
    assert.equal(isWealthLayerOf(new Uint8Array(W * H + 1), W, H), false, "long");
    assert.equal(isWealthLayerOf([1, 1, 1, 1, 1, 1], W, H), false, "not typed");
    assert.equal(isWealthLayerOf(null, W, H), false, "missing");
    assert.equal(isWealthLayerOf(new Uint8Array(W * H), 0, H), false, "no width");
    assert.equal(isWealthLayerOf(new Uint8Array(W * H), W, 0), false, "no height");
  });
});

describe("forEachWealthTint: the column-major walk", () => {
  test("a value at index x * height + y is visited at tile (x, y), with its tint", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 1, 0, WEALTH.WEALTHY);
    setTile(bytes, 2, 1, WEALTH.MODEST);
    const seen = [];
    forEachWealthTint(bytes, W, H, (x, y, tint) => seen.push([x, y, tint]));
    assert.deepEqual(seen, [[1, 0, WEALTH_TINT_WEALTHY], [2, 1, WEALTH_TINT_MODEST]]);
  });

  test("index 2 is tile (1, 0), not (0, 2): the order is column-major", () => {
    const bytes = new Uint8Array(W * H);
    bytes[2] = WEALTH.MIDDLE;
    const seen = [];
    forEachWealthTint(bytes, W, H, (x, y) => seen.push([x, y]));
    assert.deepEqual(seen, [[1, 0]]);
  });

  test("every tile of a full map is visited once, in engine order, with its index", () => {
    const bytes = Uint8Array.from([1, 2, 3, 1, 2, 3]);
    const seen = [];
    forEachWealthTint(bytes, W, H, (x, y) => seen.push(`${x},${y}`));
    assert.deepEqual(seen, ["0,0", "0,1", "1,0", "1,1", "2,0", "2,1"]);
  });

  test("nothing is visited for a wrong length, even a longer one whose head is valid", () => {
    let n = 0;
    forEachWealthTint(new Uint8Array(W * H + 2).fill(3), W, H, () => n++);
    forEachWealthTint(Uint8Array.from([3]), W, H, () => n++);
    assert.equal(n, 0);
  });

  test("nothing is visited for a missing array, a non-typed array, or an empty map", () => {
    let n = 0;
    forEachWealthTint(null, W, H, () => n++);
    forEachWealthTint([3, 3, 3, 3, 3, 3], W, H, () => n++);
    forEachWealthTint(new Uint8Array(W * H).fill(3), 0, H, () => n++);
    forEachWealthTint(new Uint8Array(W * H).fill(3), W, 0, () => n++);
    assert.equal(n, 0);
  });

  test("a map of N tiles visits at most N tiles, even when every tile has a wealth", () => {
    const bytes = new Uint8Array(W * H).fill(WEALTH.WEALTHY);
    let n = 0;
    forEachWealthTint(bytes, W, H, () => n++);
    assert.equal(n, W * H);
  });
});

describe("the layer", () => {
  test("named wealth, with the draw and visible functions", () => {
    assert.equal(WEALTH_LAYER.name, "wealth");
    assert.equal(typeof WEALTH_LAYER.draw, "function");
    assert.equal(typeof WEALTH_LAYER.visible, "function");
  });

  test("hidden by default, even with the engine API", () => {
    setWealthView(false);
    assert.equal(WEALTH_LAYER.visible(fakeCity()), false);
  });

  test("visible only when the engine has the API and the view is asked; toggling changes it", () => {
    setWealthView(true);
    assert.equal(WEALTH_LAYER.visible(fakeCity()), true);
    setWealthView(false);
    assert.equal(WEALTH_LAYER.visible(fakeCity()), false, "view not asked");
    setWealthView(true);
    assert.equal(WEALTH_LAYER.visible(fakeCity({ api: false })), false, "an engine without wealth_layer");
    assert.equal(WEALTH_LAYER.visible({}), false, "an engine without anything");
    setWealthView(false);
  });

  test("draws one rectangle per tinted tile, at (x * scale, y * scale), in its tint", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 0, 0, WEALTH.MODEST);
    setTile(bytes, 1, 0, WEALTH.NONE);
    setTile(bytes, 2, 1, WEALTH.WEALTHY);
    const ctx = fakeCtx();
    WEALTH_LAYER.draw(ctx, fakeCity({ bytes }), 8);
    assert.deepEqual(ctx.rects, [
      { x: 0, y: 0, w: 8, h: 8, style: WEALTH_TINT_MODEST },
      { x: 16, y: 8, w: 8, h: 8, style: WEALTH_TINT_WEALTHY },
    ]);
  });

  test("the middle tint is used for value 2", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 1, 1, WEALTH.MIDDLE);
    const ctx = fakeCtx();
    WEALTH_LAYER.draw(ctx, fakeCity({ bytes }), 4);
    assert.deepEqual(ctx.rects, [{ x: 4, y: 4, w: 4, h: 4, style: WEALTH_TINT_MIDDLE }]);
  });

  test("a wrong length draws nothing at all", () => {
    const ctx = fakeCtx();
    WEALTH_LAYER.draw(ctx, fakeCity({ bytes: new Uint8Array(W * H + 1).fill(3) }), 4);
    WEALTH_LAYER.draw(ctx, fakeCity({ bytes: new Uint8Array(1).fill(3) }), 4);
    WEALTH_LAYER.draw(ctx, fakeCity({ bytes: [3, 3, 3, 3, 3, 3] }), 4);
    assert.deepEqual(ctx.rects, []);
  });

  test("one rectangle at most per tile: a full map gives W * H rectangles", () => {
    const bytes = new Uint8Array(W * H).fill(WEALTH.MIDDLE);
    const ctx = fakeCtx();
    WEALTH_LAYER.draw(ctx, fakeCity({ bytes }), 4);
    assert.equal(ctx.rects.length, W * H);
  });

  test("draw sets the fill colour before each rectangle and never draws a nothing tile", () => {
    const bytes = Uint8Array.from([0, 1, 0, 2, 0, 3]);
    const ctx = fakeCtx();
    WEALTH_LAYER.draw(ctx, fakeCity({ bytes }), 2);
    assert.deepEqual(ctx.rects.map((r) => r.style), [WEALTH_TINT_MODEST, WEALTH_TINT_MIDDLE, WEALTH_TINT_WEALTHY]);
    assert.deepEqual(ctx.rects.map((r) => [r.x, r.y]), [[0, 2], [2, 2], [4, 2]]);
  });
});
