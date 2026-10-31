// Tests for the adaptive resolution layer (web/view3d-perf.js) with a fake DOM, renderer and clock:
// the checkbox «Qualité automatique» in #view3d-controls, the ratio applied on slow and fast frames,
// the restore on uncheck, and the canvas.perfStats() hook while mounted.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../view3d-perf.js";
import * as model from "../view3d-perf-model.js";

// A minimal DOM: elements with children, hidden, listeners; and getElementById.
function fakeDocument() {
  const byId = new Map();
  return {
    createElement() {
      const listeners = new Map();
      return {
        children: [], parent: null, hidden: false, type: "", checked: false, className: "", text: "",
        get childElementCount() { return this.children.length; },
        append(...nodes) {
          for (const n of nodes) {
            if (typeof n === "string") { this.text += n; continue; }
            n.parent = this;
            this.children.push(n);
          }
        },
        remove() {
          if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
          this.parent = null;
        },
        addEventListener(type, fn) { listeners.set(type, fn); },
        removeEventListener(type) { listeners.delete(type); },
        dispatch(type) { listeners.get(type)?.(); },
      };
    },
    getElementById(id) { return byId.get(id) ?? null; },
    add(id, el) { byId.set(id, el); },
  };
}

// The context a layer gets from view3d.js: a canvas in a page with #view3d-controls, and a renderer
// that records its pixel ratio.
function fakeContext({ withHost = true, ratio = 2 } = {}) {
  const doc = fakeDocument();
  const host = doc.createElement();
  host.hidden = true;
  if (withHost) doc.add("view3d-controls", host);
  const renderer = {
    ratio, calls: [],
    getPixelRatio() { return this.ratio; },
    setPixelRatio(v) { this.ratio = v; this.calls.push(v); },
  };
  const canvas = { ownerDocument: doc };
  return { ctx: { canvas, renderer }, doc, host, renderer, canvas };
}

// A layer with a clock the test moves: tick(gap) advances the time by gap ms and draws one frame.
function clockedLayer(dpr = 2) {
  let now = 1000;
  const layer = createLayer({ now: () => now, devicePixelRatio: () => dpr });
  const tick = (gap, count = 1) => {
    for (let i = 0; i < count; i++) {
      now += gap;
      layer.frame();
    }
  };
  return { layer, tick };
}

const SLOW = model.FRAME_BUDGET_MS + 50;
const FAST = model.FRAME_BUDGET_MS * model.RECOVER_FRACTION - 20;

describe("the «Qualité automatique» control", () => {
  test("mount adds one checkbox to the shared container, checked by default; dispose removes it", () => {
    const { ctx, host, doc } = fakeContext();
    host.append(doc.createElement());
    const { layer } = clockedLayer();
    layer.mount(ctx);
    assert.equal(host.hidden, false);
    assert.equal(host.children.length, 2);
    const label = host.children[1];
    assert.equal(label.children[0].type, "checkbox");
    assert.equal(label.children[0].checked, true);
    assert.equal(label.text.trim(), "Qualité automatique");
    layer.dispose(ctx);
    assert.equal(host.children.length, 1, "only our checkbox goes");
    assert.equal(host.hidden, false, "the container stays shown while another control is in it");
  });

  test("dispose hides the container again when it is left empty", () => {
    const { ctx, host } = fakeContext();
    const { layer } = clockedLayer();
    layer.mount(ctx);
    layer.dispose(ctx);
    assert.equal(host.children.length, 0);
    assert.equal(host.hidden, true);
  });

  test("mount fails with a clear error when the page has no #view3d-controls", () => {
    const { ctx } = fakeContext({ withHost: false });
    assert.throws(() => clockedLayer().layer.mount(ctx), /#view3d-controls is missing/);
  });
});

describe("adapting the pixel ratio", () => {
  test("slow frames lower the ratio with setPixelRatio; fast frames raise it again", () => {
    const { ctx, renderer } = fakeContext({ ratio: 2 });
    const { layer, tick } = clockedLayer(2);
    layer.mount(ctx);
    tick(SLOW, model.ADAPT_MIN_FRAMES + 1);
    assert.equal(renderer.ratio, 2 - model.PIXEL_RATIO_STEP);
    tick(FAST, model.ADAPT_MIN_FRAMES * 2 + model.ADAPT_INTERVAL_MS / FAST);
    assert.equal(renderer.ratio, 2, "back up after the hysteresis");
    layer.dispose(ctx);
  });

  test("the renderer is touched only when the ratio changes", () => {
    const { ctx, renderer } = fakeContext({ ratio: 1 });
    const { layer, tick } = clockedLayer(2);
    layer.mount(ctx);
    tick(model.FRAME_BUDGET_MS * 0.9, model.FRAME_WINDOW * 2);
    assert.deepEqual(renderer.calls, [], "a steady mean in the band changes nothing");
    layer.dispose(ctx);
  });

  test("the first frame only starts the clock (no sample, no change)", () => {
    const { ctx, renderer } = fakeContext({ ratio: 2 });
    const { layer } = clockedLayer(2);
    layer.mount(ctx);
    layer.frame();
    assert.deepEqual(renderer.calls, []);
    layer.dispose(ctx);
  });
});

describe("canvas.perfStats()", () => {
  test("exists while mounted, reports the ratio, the last frame time and auto; gone after dispose", () => {
    const { ctx, canvas, renderer } = fakeContext({ ratio: 2 });
    const { layer, tick } = clockedLayer(2);
    layer.mount(ctx);
    assert.deepEqual(canvas.perfStats(), { pixelRatio: 2, frameMs: null, auto: true });
    tick(70, 2);
    assert.deepEqual(canvas.perfStats(), { pixelRatio: 2, frameMs: 70, auto: true });
    tick(SLOW, model.ADAPT_MIN_FRAMES);
    assert.equal(canvas.perfStats().pixelRatio, renderer.ratio);
    layer.dispose(ctx);
    assert.equal(canvas.perfStats, undefined);
  });
});

describe("unchecking «Qualité automatique»", () => {
  test("restores the starting ratio and stops adapting; checking again resumes", () => {
    const { ctx, renderer, host, canvas } = fakeContext({ ratio: 2 });
    const { layer, tick } = clockedLayer(2);
    layer.mount(ctx);
    const input = host.children[0].children[0];
    tick(SLOW, model.ADAPT_MIN_FRAMES + 1);
    assert.equal(renderer.ratio, 2 - model.PIXEL_RATIO_STEP);

    input.checked = false;
    input.dispatch("change");
    assert.equal(renderer.ratio, 2, "back to the starting ratio");
    assert.equal(canvas.perfStats().auto, false);
    tick(SLOW, model.ADAPT_MIN_FRAMES * 3);
    assert.equal(renderer.ratio, 2, "no adapting while off");

    input.checked = true;
    input.dispatch("change");
    assert.equal(canvas.perfStats().auto, true);
    tick(SLOW, model.ADAPT_MIN_FRAMES + 1);
    assert.equal(renderer.ratio, 2 - model.PIXEL_RATIO_STEP, "adapting again");
    layer.dispose(ctx);
  });
});
