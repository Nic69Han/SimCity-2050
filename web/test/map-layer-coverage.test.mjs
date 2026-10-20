// The 2D coverage layer and its pure part: kinds, levels and tints, the column-major walk, the view choice.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { COVERAGE_LAYER } from "../map-layer-coverage.js";
import {
  COVERAGE_KIND, KIND_COUNT, VALUE_MAX, LEVELS, levelOf, tintOf, forEachTint, setCoverageView, coverageViewState,
} from "../map-layer-coverage-model.js";

const W = 3, H = 2;

// A 2D context that records the rectangles it fills, with the colour in force.
function fakeCtx() {
  return {
    fillStyle: null,
    rects: [],
    fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, style: this.fillStyle }); },
  };
}

// A city with the service engine the test controls: the rule flag and one coverage array per kind.
function fakeCity({ rules = true, bytes = new Uint8Array(W * H) } = {}) {
  return {
    width: () => W,
    height: () => H,
    service_rules: () => rules,
    coverage_layer: (kind) => (kind === undefined ? null : bytes),
  };
}

// Puts `value` on the tile (x, y), with the engine's column-major index x * height + y.
function setTile(bytes, x, y, value) {
  bytes[x * H + y] = value;
}

const EDU = COVERAGE_KIND.EDUCATION, HEALTH = COVERAGE_KIND.HEALTH, SAFETY = COVERAGE_KIND.SAFETY;

describe("the kinds and the view choice (module-owned state)", () => {
  test("three kinds: education 0, health 1, safety 2", () => {
    assert.deepEqual(COVERAGE_KIND, { EDUCATION: 0, HEALTH: 1, SAFETY: 2 });
    assert.equal(KIND_COUNT, 3);
  });

  test("starts with no kind; setCoverageView reports whether it changed", () => {
    setCoverageView(null);
    assert.deepEqual(coverageViewState(), { kind: null });
    assert.equal(setCoverageView(EDU), true);
    assert.equal(setCoverageView(EDU), false, "unchanged");
    assert.deepEqual(coverageViewState(), { kind: EDU });
    assert.equal(setCoverageView(HEALTH), true, "another kind is a change");
    assert.equal(setCoverageView(null), true, "none is a change");
    assert.equal(setCoverageView(null), false);
    assert.deepEqual(coverageViewState(), { kind: null });
  });

  test("an unknown kind is an error, and the view keeps its kind", () => {
    setCoverageView(SAFETY);
    for (const bad of [3, -1, 1.5, "0", NaN, undefined, true]) {
      assert.throws(() => setCoverageView(bad), RangeError, String(bad));
    }
    assert.deepEqual(coverageViewState(), { kind: SAFETY });
    setCoverageView(null);
  });

  test("coverageViewState returns a copy", () => {
    setCoverageView(null);
    coverageViewState().kind = EDU;
    assert.deepEqual(coverageViewState(), { kind: null });
  });
});

describe("levels: the engine values in four buckets", () => {
  test("0 is no level; 1 is the lowest level; 255 is the top level", () => {
    assert.equal(levelOf(0), 0);
    assert.equal(levelOf(1), 1);
    assert.equal(levelOf(VALUE_MAX), LEVELS);
    assert.equal(LEVELS, 4);
  });

  test("the bucket edges are 64, 128 and 192", () => {
    assert.deepEqual([64, 65, 128, 129, 192, 193].map(levelOf), [1, 2, 2, 3, 3, 4]);
  });

  test("levels never decrease as the value grows", () => {
    let last = 0;
    for (let v = 0; v <= VALUE_MAX; v++) {
      const l = levelOf(v);
      assert.ok(l >= last, `value ${v}`);
      last = l;
    }
  });

  test("a value outside 0..=255 or not an integer has no level", () => {
    for (const v of [256, -1, 1.5, NaN, undefined, "1", null]) assert.equal(levelOf(v), null, String(v));
  });
});

describe("tints: one colour per kind, alpha by level", () => {
  test("nothing has no tint", () => {
    for (const k of [EDU, HEALTH, SAFETY]) assert.equal(tintOf(k, 0), null);
  });

  test("education is blue, health red-pink, safety purple", () => {
    assert.equal(tintOf(EDU, 255), "rgba(30, 136, 229, 0.60)");
    assert.equal(tintOf(HEALTH, 255), "rgba(233, 30, 99, 0.60)");
    assert.equal(tintOf(SAFETY, 255), "rgba(123, 31, 162, 0.60)");
  });

  test("alpha grows with the level: 0.15, 0.30, 0.45, 0.60", () => {
    assert.deepEqual([1, 64, 65, 128, 129, 192, 193, 255].map((v) => tintOf(EDU, v)), [
      "rgba(30, 136, 229, 0.15)", "rgba(30, 136, 229, 0.15)",
      "rgba(30, 136, 229, 0.30)", "rgba(30, 136, 229, 0.30)",
      "rgba(30, 136, 229, 0.45)", "rgba(30, 136, 229, 0.45)",
      "rgba(30, 136, 229, 0.60)", "rgba(30, 136, 229, 0.60)",
    ]);
  });

  test("an unknown kind, a bad value or a kind without colour has no tint", () => {
    assert.equal(tintOf(3, 255), null);
    assert.equal(tintOf(-1, 255), null);
    assert.equal(tintOf(EDU, 256), null);
    assert.equal(tintOf(EDU, 1.5), null);
  });
});

describe("forEachTint: the column-major walk", () => {
  test("a value at index x * height + y is visited at tile (x, y)", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 1, 0, 200);
    setTile(bytes, 2, 1, 10);
    const seen = [];
    forEachTint(bytes, W, H, HEALTH, (x, y, tint) => seen.push([x, y, tint]));
    assert.deepEqual(seen, [[1, 0, tintOf(HEALTH, 200)], [2, 1, tintOf(HEALTH, 10)]]);
  });

  test("index 2 is tile (1, 0), not (0, 2): the order is column-major", () => {
    const bytes = new Uint8Array(W * H);
    bytes[2] = 100;
    const seen = [];
    forEachTint(bytes, W, H, EDU, (x, y) => seen.push([x, y]));
    assert.deepEqual(seen, [[1, 0]]);
  });

  test("bytes past width * height are ignored; a shorter array visits what it holds", () => {
    const long = new Uint8Array(W * H + 2);
    long[W * H] = 255;
    long[W * H + 1] = 255;
    let n = 0;
    forEachTint(long, W, H, SAFETY, () => n++);
    assert.equal(n, 0, "past the map");
    const short = Uint8Array.from([255]);
    const seen = [];
    forEachTint(short, W, H, SAFETY, (x, y) => seen.push([x, y]));
    assert.deepEqual(seen, [[0, 0]]);
  });

  test("the walk visits at most width * height tiles, however long the array", () => {
    const long = new Uint8Array(W * H * 10).fill(255);
    let n = 0;
    forEachTint(long, W, H, EDU, () => n++);
    assert.equal(n, W * H);
  });

  test("nothing visited for a missing array, a non-typed array, an unknown kind or an empty map", () => {
    let n = 0;
    forEachTint(null, W, H, EDU, () => n++);
    forEachTint([255, 255, 255, 255, 255, 255], W, H, EDU, () => n++);
    forEachTint(new Uint8Array(W * H).fill(255), W, H, 7, () => n++);
    forEachTint(new Uint8Array(W * H).fill(255), 0, H, EDU, () => n++);
    forEachTint(new Uint8Array(W * H).fill(255), W, 0, EDU, () => n++);
    assert.equal(n, 0);
  });
});

describe("the layer", () => {
  test("named coverage, with the draw and visible functions", () => {
    assert.equal(COVERAGE_LAYER.name, "coverage");
    assert.equal(typeof COVERAGE_LAYER.draw, "function");
    assert.equal(typeof COVERAGE_LAYER.visible, "function");
  });

  test("visible only when the engine has the API, the rules are on and a kind is chosen", () => {
    setCoverageView(EDU);
    assert.equal(COVERAGE_LAYER.visible(fakeCity()), true);
    assert.equal(COVERAGE_LAYER.visible(fakeCity({ rules: false })), false, "rules off");
    setCoverageView(null);
    assert.equal(COVERAGE_LAYER.visible(fakeCity()), false, "no kind chosen");
    setCoverageView(HEALTH);
    assert.equal(COVERAGE_LAYER.visible({}), false, "an engine without services");
    assert.equal(COVERAGE_LAYER.visible({ service_rules: () => true }), false, "no coverage_layer");
    assert.equal(COVERAGE_LAYER.visible({ coverage_layer: () => null }), false, "no service_rules");
    setCoverageView(null);
  });

  test("draws one rectangle per covered tile, at (x * scale, y * scale), in the tint of the chosen kind", () => {
    const bytes = new Uint8Array(W * H);
    setTile(bytes, 0, 0, 10);
    setTile(bytes, 1, 0, 0);
    setTile(bytes, 2, 1, 255);
    setCoverageView(HEALTH);
    const ctx = fakeCtx();
    COVERAGE_LAYER.draw(ctx, fakeCity({ bytes }), 8);
    setCoverageView(null);
    assert.deepEqual(ctx.rects, [
      { x: 0, y: 0, w: 8, h: 8, style: tintOf(HEALTH, 10) },
      { x: 16, y: 8, w: 8, h: 8, style: tintOf(HEALTH, 255) },
    ]);
  });

  test("the layer asks the engine for the chosen kind", () => {
    const asked = [];
    const city = {
      width: () => W,
      height: () => H,
      service_rules: () => true,
      coverage_layer: (kind) => { asked.push(kind); return new Uint8Array(W * H).fill(255); },
    };
    setCoverageView(SAFETY);
    const ctx = fakeCtx();
    COVERAGE_LAYER.draw(ctx, city, 4);
    setCoverageView(null);
    assert.deepEqual(asked, [SAFETY]);
    assert.equal(ctx.rects.length, W * H);
  });

  test("one rectangle at most per tile: a map of 6 tiles gives at most 6 rectangles", () => {
    const bytes = new Uint8Array(W * H + 4).fill(255);
    setCoverageView(EDU);
    const ctx = fakeCtx();
    COVERAGE_LAYER.draw(ctx, fakeCity({ bytes }), 4);
    setCoverageView(null);
    assert.equal(ctx.rects.length, W * H);
  });

  test("draws nothing when it is not visible", () => {
    setCoverageView(null);
    const ctx = fakeCtx();
    COVERAGE_LAYER.draw(ctx, fakeCity({ bytes: new Uint8Array(W * H).fill(255) }), 4);
    assert.equal(ctx.rects.length, 0);
  });
});
