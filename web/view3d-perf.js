// 3D view layer: adaptive render resolution (docs/game-design-v14.md, "Fluidité"). The decisions are
// in view3d-perf-model.js (pure); this layer only measures the time between two frames, applies the
// pixel ratio with ctx.renderer.setPixelRatio when it changes, and owns the checkbox
// «Qualité automatique» (on by default) in #view3d-controls. Unchecked: the starting ratio is restored
// and the layer stops adapting. The test hook canvas.perfStats() returns { pixelRatio, frameMs, auto }
// while the layer is mounted.
import * as model from "./view3d-perf-model.js";

const AUTO_LABEL = "Qualité automatique";
// The text shown in the strip: short, so the strip stays small on a phone (the full name is the box's
// accessible name and the label's tooltip).
const AUTO_SHORT = "Auto";

// options (for the tests): now() in ms, devicePixelRatio() in device pixels per CSS pixel.
export function createLayer(options = {}) {
  const clock = options.now ?? (() => globalThis.performance.now());
  const deviceRatio = options.devicePixelRatio ?? (() => globalThis.devicePixelRatio);
  let s = null;
  return {
    mount(ctx) {
      s = start(ctx, clock, deviceRatio);
    },
    // one call per drawn frame (before the render): the gap since the previous call is the frame time
    frame() {
      const now = s.clock();
      const gap = s.last === null ? null : now - s.last;
      s.last = now;
      if (gap === null) return;
      s.frameMs = gap;
      if (!s.auto) return;
      const next = model.decide(s.state, gap, now, s.deviceRatio());
      if (next.pixelRatio !== s.state.pixelRatio) s.renderer.setPixelRatio(next.pixelRatio);
      s.state = next;
    },
    dispose() {
      if (!s) return;
      s.control.input.removeEventListener("change", s.onChange);
      s.control.label.remove();
      if (s.host.childElementCount === 0) s.host.hidden = s.hostWasHidden;
      delete s.canvas.perfStats;
      s = null;
    },
  };
}

// The state of the layer while mounted. Nothing here grows with the frames (the window is bounded).
function start(ctx, clock, deviceRatio) {
  const doc = ctx.canvas.ownerDocument;
  const host = doc.getElementById("view3d-controls");
  if (!host) throw new Error("perf: #view3d-controls is missing from the page");
  const control = autoControl(doc);
  const hostWasHidden = host.hidden;
  host.hidden = false;
  host.append(control.label);
  const startRatio = ctx.renderer.getPixelRatio();
  const st = {
    host, hostWasHidden, control, canvas: ctx.canvas, renderer: ctx.renderer, clock,
    deviceRatio: () => {
      const r = deviceRatio();
      return r > 0 ? r : 1;
    },
    startRatio, state: model.initial(startRatio), auto: true, last: null, frameMs: null,
    onChange: () => setAuto(st, control.input.checked),
  };
  control.input.addEventListener("change", st.onChange);
  ctx.canvas.perfStats = () => ({ pixelRatio: st.state.pixelRatio, frameMs: st.frameMs, auto: st.auto });
  return st;
}

// Turns the adaptation on (from the current ratio) or off (back to the starting ratio).
function setAuto(st, on) {
  st.auto = on;
  if (!on) st.renderer.setPixelRatio(st.startRatio);
  st.state = model.initial(on ? st.renderer.getPixelRatio() : st.startRatio);
}

// The checkbox «Qualité automatique», styled with the classes of the camera and ambiance controls.
function autoControl(doc) {
  const label = doc.createElement("label");
  label.className = "view3d-cycle";
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.className = "view3d-cycle-box";
  input.checked = true;
  input.setAttribute?.("aria-label", AUTO_LABEL);
  label.title = AUTO_LABEL;
  label.append(input, ` ${AUTO_SHORT}`);
  return { label, input };
}
