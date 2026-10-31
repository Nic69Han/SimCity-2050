// Gesture model of the 2D map (web/touch-model.js): taps, drags, pinch, clamps and the pointer cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_POINTERS, ZOOM_MIN, ZOOM_MAX, TAP_SLOP, PINCH_MIN_SPAN, VIEW_START,
  clampZoom, clampView, zoomView, panView, applyGesture,
  createGesture, pointerDown, pointerMove, pointerUp,
} from "../touch-model.js";

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} ${a} != ${b}`);

test("the constants: two pointers, zoom from 1 to 4, a tap slop of 10 px", () => {
  assert.equal(MAX_POINTERS, 2);
  assert.equal(ZOOM_MIN, 1);
  assert.equal(ZOOM_MAX, 4);
  assert.equal(TAP_SLOP, 10);
  assert.ok(PINCH_MIN_SPAN > 0);
  assert.deepEqual(VIEW_START, { scale: 1, x: 0, y: 0 });
});

test("clampZoom keeps the factor in [ZOOM_MIN, ZOOM_MAX] and reads a non-number as no zoom", () => {
  assert.equal(clampZoom(0.2), ZOOM_MIN);
  assert.equal(clampZoom(1), 1);
  assert.equal(clampZoom(2.5), 2.5);
  assert.equal(clampZoom(9), ZOOM_MAX);
  assert.equal(clampZoom(Number.NaN), ZOOM_MIN);
  assert.equal(clampZoom(Infinity), ZOOM_MIN);
});

test("clampView: the scale is clamped and the offsets keep the scaled map over the frame", () => {
  assert.deepEqual(clampView({ scale: 1, x: 30, y: -30 }, 300, 200), { scale: 1, x: 0, y: 0 });
  // scale 2 on a 300 x 200 frame: the map is 600 x 400, so x and y lie in [-300, 0] and [-200, 0]
  assert.deepEqual(clampView({ scale: 2, x: -100, y: -50 }, 300, 200), { scale: 2, x: -100, y: -50 });
  assert.deepEqual(clampView({ scale: 2, x: -999, y: 40 }, 300, 200), { scale: 2, x: -300, y: 0 });
  assert.deepEqual(clampView({ scale: 9, x: 0, y: 0 }, 300, 200), { scale: ZOOM_MAX, x: 0, y: 0 });
});

test("clampView: a frame with no size gives the start view; a non-number offset counts as 0", () => {
  assert.deepEqual(clampView({ scale: 3, x: -5, y: -5 }, 0, 200), VIEW_START);
  assert.deepEqual(clampView({ scale: 2, x: Number.NaN, y: undefined }, 300, 200), { scale: 2, x: 0, y: 0 });
});

test("zoomView keeps the anchored frame point in place", () => {
  const view = { scale: 1, x: 0, y: 0 };
  const z = zoomView(view, 2, 100, 50, 300, 200);
  assert.equal(z.scale, 2);
  // the map point under (100, 50) was at (100, 50); after the zoom it is still there
  close((100 - z.x) / z.scale, 100, "content x under the anchor");
  close((50 - z.y) / z.scale, 50, "content y under the anchor");
});

test("zoomView anchored away from the origin keeps that point too", () => {
  const view = { scale: 2, x: -120, y: -60 };
  const z = zoomView(view, 1.5, 150, 90, 300, 200);
  const before = { x: (150 - view.x) / view.scale, y: (90 - view.y) / view.scale };
  close(150 - z.x, before.x * z.scale, "anchor x");
  close(90 - z.y, before.y * z.scale, "anchor y");
});

test("zoomView clamps the scale to ZOOM_MAX and ZOOM_MIN, and ignores a bad factor", () => {
  assert.equal(zoomView({ scale: 3.5, x: 0, y: 0 }, 2, 0, 0, 300, 200).scale, ZOOM_MAX);
  assert.equal(zoomView({ scale: 1.2, x: 0, y: 0 }, 0.1, 0, 0, 300, 200).scale, ZOOM_MIN);
  assert.deepEqual(zoomView({ scale: 2, x: -10, y: -10 }, Number.NaN, 0, 0, 300, 200), { scale: 2, x: -10, y: -10 });
  assert.deepEqual(zoomView({ scale: 2, x: -10, y: -10 }, -3, 0, 0, 300, 200), { scale: 2, x: -10, y: -10 });
});

test("panView moves the map and stops at the frame edges", () => {
  assert.deepEqual(panView({ scale: 2, x: -100, y: -50 }, 30, -20, 300, 200), { scale: 2, x: -70, y: -70 });
  assert.deepEqual(panView({ scale: 2, x: -100, y: -50 }, 900, 900, 300, 200), { scale: 2, x: 0, y: 0 });
  assert.deepEqual(panView({ scale: 1, x: 0, y: 0 }, 40, 40, 300, 200), { scale: 1, x: 0, y: 0 });
});

test("applyGesture: a drag pans, a pinch zooms about the previous midpoint then pans, others keep the view", () => {
  const view = { scale: 1, x: 0, y: 0 };
  assert.deepEqual(applyGesture({ scale: 2, x: -100, y: -50 }, { type: "drag", dx: -20, dy: 10 }, 300, 200), {
    scale: 2, x: -120, y: -40,
  });
  const pinched = applyGesture(view, { type: "pinch", factor: 2, cx: 100, cy: 50, dx: 0, dy: 0 }, 300, 200);
  assert.equal(pinched.scale, 2);
  const moved = applyGesture(view, { type: "pinch", factor: 1, cx: 150, cy: 100, dx: 10, dy: -5 }, 300, 200);
  assert.deepEqual(moved, { scale: 1, x: 0, y: 0 }, "no zoom at scale 1: the pan is clamped away");
  assert.deepEqual(applyGesture(view, { type: "tap", x: 1, y: 1 }, 300, 200), view);
  assert.deepEqual(applyGesture(view, undefined, 300, 200), view);
});

test("a press that does not move past the slop is no drag; once past it the drag starts from the press", () => {
  const g = createGesture();
  assert.equal(pointerDown(g, 1, 100, 100), true);
  assert.equal(pointerMove(g, 1, 103, 104), null, "5 px: still a tap");
  assert.equal(pointerMove(g, 1, 100 + TAP_SLOP, 100), null, "exactly the slop: still a tap");
  // beyond the slop the drag is measured from the press, not from the last tiny move
  assert.deepEqual(pointerMove(g, 1, 115, 100), { type: "drag", dx: 15, dy: 0 });
  assert.deepEqual(pointerMove(g, 1, 118, 96), { type: "drag", dx: 3, dy: -4 });
});

test("a tap: one point down and up without moving past the slop", () => {
  const g = createGesture();
  pointerDown(g, 7, 40, 60);
  pointerMove(g, 7, 42, 61);
  assert.deepEqual(pointerUp(g, 7), { type: "tap", x: 40, y: 60 }, "the tap is at the press position");
  assert.equal(g.points.size, 0);
});

test("a drag is no tap", () => {
  const g = createGesture();
  pointerDown(g, 1, 0, 0);
  pointerMove(g, 1, 50, 0);
  assert.equal(pointerUp(g, 1), null);
});

test("a pinch gives a zoom step; its span ratio is the factor", () => {
  const g = createGesture();
  pointerDown(g, 1, 100, 100);
  pointerDown(g, 2, 200, 100); // span 100, midpoint (150, 100)
  const step = pointerMove(g, 2, 300, 100); // span 200, midpoint (200, 100)
  assert.equal(step.type, "pinch");
  close(step.factor, 2, "factor");
  assert.equal(step.cx, 150);
  assert.equal(step.cy, 100);
  assert.equal(step.dx, 50);
  assert.equal(step.dy, 0);
});

test("a pinch with fingers closer than PINCH_MIN_SPAN gives no zoom step", () => {
  const g = createGesture();
  pointerDown(g, 1, 100, 100);
  pointerDown(g, 2, 101, 100);
  const step = pointerMove(g, 2, 102, 100);
  assert.equal(step.factor, 1);
});

test("the pinch's midpoint is kept between steps, so a second move is measured from the first", () => {
  const g = createGesture();
  pointerDown(g, 1, 100, 100);
  pointerDown(g, 2, 200, 100);
  pointerMove(g, 1, 80, 100); // span 120
  const step = pointerMove(g, 1, 60, 100); // span 140
  close(step.factor, 140 / 120, "second step ratio");
  assert.equal(step.cx, 140, "the previous midpoint of the first step (80..200 -> 140)");
});

test("a pinch is never a tap, even after one finger lifts", () => {
  const g = createGesture();
  pointerDown(g, 1, 10, 10);
  pointerDown(g, 2, 60, 10);
  assert.equal(pointerUp(g, 2), null, "the second finger lifts: no tap");
  assert.equal(pointerUp(g, 1), null, "the first lifts: still no tap");
  assert.equal(g.multi, false, "the gesture is reset when the last point lifts");
});

test("after a pinch one finger drags from where it is now", () => {
  const g = createGesture();
  pointerDown(g, 1, 100, 100);
  pointerDown(g, 2, 200, 100);
  pointerMove(g, 2, 260, 100);
  pointerUp(g, 2);
  assert.deepEqual(pointerMove(g, 1, 110, 100), { type: "drag", dx: 10, dy: 0 }, "from the last point, not the press");
});

test("the pointer cap: a third point is ignored, its moves and its lift do nothing", () => {
  const g = createGesture();
  assert.equal(pointerDown(g, 1, 0, 0), true);
  assert.equal(pointerDown(g, 2, 50, 0), true);
  assert.equal(pointerDown(g, 3, 25, 25), false);
  assert.equal(pointerMove(g, 3, 30, 30), null);
  assert.equal(pointerUp(g, 3), null);
  assert.equal(g.points.size, 2);
});

test("a pointer id already down, an unknown id and a non-number position are refused", () => {
  const g = createGesture();
  pointerDown(g, 1, 0, 0);
  assert.equal(pointerDown(g, 1, 9, 9), false, "the same id twice");
  assert.equal(pointerDown(g, 2, Number.NaN, 0), false, "no position");
  assert.equal(pointerMove(g, 99, 5, 5), null, "unknown id");
  assert.equal(pointerMove(g, 1, Number.NaN, 5), null, "bad position");
  assert.equal(pointerUp(g, 99), null);
});
