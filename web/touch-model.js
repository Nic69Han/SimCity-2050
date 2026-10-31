// Touch gestures of the flat 2D map (docs/game-design-v1.md, workstream mobile). Pure: no DOM, no
// engine. web/touch.js feeds it the pointer events of touch pointers, in frame pixels, and applies
// what it returns. One finger drags (a pan when no tool is selected); two fingers pinch: the zoom
// is anchored on their midpoint, and the midpoint's own move pans. At most MAX_POINTERS touch
// points are tracked; a third one is ignored.
//
// The view is { scale, x, y }: the map is drawn at `scale` times its size, its top-left corner at
// (x, y) in frame pixels. x and y are never positive and the scaled map always covers the frame.

export const MAX_POINTERS = 2; // touch points tracked at once (one finger, or the two of a pinch)
export const ZOOM_MIN = 1; // the map at its own size: no zoom out past it
export const ZOOM_MAX = 4; // the largest enlargement of the map
export const TAP_SLOP = 10; // px: a press that stays this close to where it began is a tap, not a drag
export const PINCH_MIN_SPAN = 8; // px: fingers closer than this give no zoom step (no division by ~0)
export const VIEW_START = Object.freeze({ scale: 1, x: 0, y: 0 });

const num = (v) => (Number.isFinite(v) ? v : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finitePoint = (x, y) => Number.isFinite(x) && Number.isFinite(y);

// The zoom factor of the map, kept in [ZOOM_MIN, ZOOM_MAX]; a value that is not a number means no zoom.
export function clampZoom(scale) {
  return clamp(Number.isFinite(scale) ? scale : ZOOM_MIN, ZOOM_MIN, ZOOM_MAX);
}

// The view kept inside its frame of w x h px: the scale is clamped, and the offsets keep the
// scaled map over the whole frame (no empty border shows). A frame with no size gets the start view.
export function clampView(view, w, h) {
  if (!(w > 0) || !(h > 0)) return { ...VIEW_START };
  const scale = clampZoom(view.scale);
  return {
    scale,
    x: clamp(num(view.x), w * (1 - scale), 0),
    y: clamp(num(view.y), h * (1 - scale), 0),
  };
}

// Enlarges (factor > 1) or reduces the map by `factor`, keeping the frame point (cx, cy) in place.
// A factor that is not a positive number leaves the view as it is (only clamped).
export function zoomView(view, factor, cx, cy, w, h) {
  const v = clampView(view, w, h);
  if (!(factor > 0) || !Number.isFinite(factor)) return v;
  const scale = clampZoom(v.scale * factor);
  const k = scale / v.scale;
  return clampView({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, w, h);
}

// Moves the map by (dx, dy) frame pixels, kept inside the frame.
export function panView(view, dx, dy, w, h) {
  return clampView({ scale: view.scale, x: view.x + num(dx), y: view.y + num(dy) }, w, h);
}

// The view after one gesture action (see pointerMove): a drag pans, a pinch zooms about the
// previous midpoint and then pans with the midpoint's move. Any other action keeps the view.
export function applyGesture(view, action, w, h) {
  if (action?.type === "drag") return panView(view, action.dx, action.dy, w, h);
  if (action?.type === "pinch") {
    const zoomed = zoomView(view, action.factor, action.cx, action.cy, w, h);
    return panView(zoomed, action.dx, action.dy, w, h);
  }
  return clampView(view, w, h);
}

// The gesture state: the touch points down (at most MAX_POINTERS), whether two of them were down
// during this gesture (`multi`: never a tap), and the last midpoint and span of a pinch (`pinch`).
export function createGesture() {
  return { points: new Map(), multi: false, pinch: null };
}

// Midpoint and span of the two tracked points (only called with two points down).
function summary(g) {
  const [a, b] = g.points.values();
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}

// A touch point goes down at (x, y). Returns false when it is not tracked (a third point, or an id
// already down, or a position that is not a number).
export function pointerDown(g, id, x, y) {
  if (g.points.has(id) || g.points.size >= MAX_POINTERS || !finitePoint(x, y)) return false;
  g.points.set(id, { x, y, startX: x, startY: y, moved: false });
  if (g.points.size === MAX_POINTERS) {
    g.multi = true;
    g.pinch = summary(g);
  }
  return true;
}

// A tracked point moves to (x, y). One point: returns { type: "drag", dx, dy } once the point has
// left the TAP_SLOP area of its press (null before, so a tap moves nothing). Two points: returns
// { type: "pinch", factor, cx, cy, dx, dy }: the span ratio since the last step (1 when the fingers
// are too close), the previous midpoint and the midpoint's move. Untracked points give null.
export function pointerMove(g, id, x, y) {
  const p = g.points.get(id);
  if (!p || !finitePoint(x, y)) return null;
  if (g.points.size === 1) return dragStep(p, x, y);
  p.x = x;
  p.y = y;
  for (const q of g.points.values()) q.moved = true;
  return pinchStep(g);
}

function dragStep(p, x, y) {
  if (!p.moved && Math.hypot(x - p.startX, y - p.startY) <= TAP_SLOP) return null;
  p.moved = true;
  const action = { type: "drag", dx: x - p.x, dy: y - p.y };
  p.x = x;
  p.y = y;
  return action;
}

function pinchStep(g) {
  const prev = g.pinch;
  const next = summary(g);
  g.pinch = next;
  const wide = prev.dist >= PINCH_MIN_SPAN && next.dist >= PINCH_MIN_SPAN;
  return {
    type: "pinch",
    factor: wide ? next.dist / prev.dist : 1,
    cx: prev.cx,
    cy: prev.cy,
    dx: next.cx - prev.cx,
    dy: next.cy - prev.cy,
  };
}

// A touch point lifts. Returns { type: "tap", x, y } when it was the only point of a gesture that
// never moved past TAP_SLOP, else null. The point leaves the gesture; the last one resets it.
export function pointerUp(g, id) {
  const p = g.points.get(id);
  if (!p) return null;
  const tap = g.points.size === 1 && !g.multi && !p.moved ? { type: "tap", x: p.x, y: p.y } : null;
  g.points.delete(id);
  if (g.points.size === 0) {
    g.multi = false;
    g.pinch = null;
  }
  return tap;
}
