// 3D view layer: camera presets (docs/game-design.md, "Caméra"): quarter turns, zoom levels and
// recentring, as buttons in #view3d-controls and as keys (, . = - Home). It moves the orbit controls
// that view3d.js owns; the maths is in view3d-camera-model.js.
//
// This layer has no frame(): a layer with frame() would keep the view's animation loop running for as
// long as the view is shown. Each action is applied at once and rendered.
//
// Read-only hook (for the tests): canvas.cameraState() returns { azimuth, polar, distance, target,
// position, map } as plain numbers, or map null before the terrain exists. Removed at dispose().
import {
  CAMERA_KEYS, nextQuarterTurn, zoomStep, homeDistance, centreTarget, cameraPosition, orbitOf,
} from "./view3d-camera-model.js";

const BUTTONS = Object.freeze([
  { label: "↺", title: "Quart de tour à gauche (touche ,)", aria: "Tourner la vue vers la gauche", action: "turnLeft" },
  { label: "↻", title: "Quart de tour à droite (touche .)", aria: "Tourner la vue vers la droite", action: "turnRight" },
  { label: "⌂", title: "Recentrer sur toute la carte (touche Début)", aria: "Recentrer sur toute la carte", action: "home" },
  { label: "+", title: "Zoom avant (touche =)", aria: "Zoom avant", action: "zoomIn" },
  { label: "−", title: "Zoom arrière (touche -)", aria: "Zoom arrière", action: "zoomOut" },
]);

const ACTIONS = Object.freeze({
  turnLeft: (ctx) => turn(ctx, -1),
  turnRight: (ctx) => turn(ctx, 1),
  zoomIn: (ctx) => zoom(ctx, true),
  zoomOut: (ctx) => zoom(ctx, false),
  home: (ctx) => recentre(ctx),
});

export function createLayer() {
  let mounted = null; // { ctx, container, wrap, wasHidden, abort }, while the view is shown
  return {
    mount(ctx) {
      const container = document.getElementById("view3d-controls");
      if (!container) throw new Error("view3d-camera: #view3d-controls is missing from the page");
      const abort = new AbortController();
      const wrap = document.createElement("div");
      wrap.className = "view3d-camera";
      for (const b of BUTTONS) wrap.append(button(b, ctx));
      const wasHidden = container.hidden;
      container.append(wrap);
      container.hidden = false;
      ctx.canvas.cameraState = () => readState(ctx);
      document.addEventListener("keydown", (ev) => onKey(ev, ctx), { signal: abort.signal });
      mounted = { ctx, container, wrap, wasHidden, abort };
    },
    dispose() {
      if (!mounted) return;
      const m = mounted;
      mounted = null;
      m.abort.abort();
      m.wrap.remove();
      // the strip is shared with other layers: it is hidden again only if this layer showed it
      if (m.wasHidden) m.container.hidden = true;
      delete m.ctx.canvas.cameraState;
    },
  };
}

function button({ label, title, aria, action }, ctx) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.title = title;
  b.setAttribute("aria-label", aria);
  b.addEventListener("click", () => ACTIONS[action](ctx));
  return b;
}

// Keys act only while the 3D view is shown (the listener is removed at dispose) and never while
// the focus is in a field where the key is typed.
function onKey(ev, ctx) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (!Object.hasOwn(CAMERA_KEYS, ev.key) || typingIn(ev.target)) return;
  ev.preventDefault();
  ACTIONS[CAMERA_KEYS[ev.key]](ctx);
}

function typingIn(t) {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));
}

function turn(ctx, dir) {
  const orbit = orbitOf(ctx.camera.position, ctx.controls.target);
  applyOrbit(ctx, { ...orbit, azimuth: nextQuarterTurn(orbit.azimuth, dir) });
}

function zoom(ctx, zoomIn) {
  const g = ctx.grid();
  if (!g) return;
  const orbit = orbitOf(ctx.camera.position, ctx.controls.target);
  applyOrbit(ctx, { ...orbit, distance: zoomStep(orbit.distance, zoomIn, Math.max(g.w, g.h)) });
}

// Target back to the middle of the map and the opening zoom; the orientation is kept.
function recentre(ctx) {
  const g = ctx.grid();
  if (!g) return;
  const orbit = orbitOf(ctx.camera.position, ctx.controls.target);
  applyOrbit(ctx, { ...orbit, distance: homeDistance(Math.max(g.w, g.h)) }, centreTarget(g.w, g.h));
}

// Moves the camera to the orbit around `target`, lets the controls clamp it, and renders.
function applyOrbit(ctx, orbit, target = ctx.controls.target) {
  ctx.controls.target.set(target.x, target.y, target.z);
  const p = cameraPosition(target, orbit);
  ctx.camera.position.set(p.x, p.y, p.z);
  ctx.controls.update();
  ctx.requestRender();
}

function readState(ctx) {
  const target = ctx.controls.target;
  const p = ctx.camera.position;
  const g = ctx.grid();
  return {
    ...orbitOf(p, target),
    target: { x: target.x, y: target.y, z: target.z },
    position: { x: p.x, y: p.y, z: p.z },
    map: g ? { w: g.w, h: g.h } : null,
  };
}
