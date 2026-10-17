// The layers of the 3D view (docs/game-design.md, "Points d'extension"). Each module exports
// createLayer(), which returns an object with optional mount(ctx), update(ctx, change),
// frame(ctx, seconds) and dispose(ctx). view3d.js mounts them in this order.
import * as models from "./view3d-models.js";
import * as ambiance from "./view3d-ambiance.js";
import * as camera from "./view3d-camera.js";

// `heavy` layers cost the most to draw (many triangles, a running animation loop).
export const LAYERS = Object.freeze([
  Object.freeze({ name: "models", module: models, heavy: true }),
  Object.freeze({ name: "ambiance", module: ambiance, heavy: true }),
  Object.freeze({ name: "camera", module: camera, heavy: false }),
]);

// The layer modules for a page address: with `?lite=1` (the simple 3D view, for weak devices and
// for the tests that do not look at the scenery) the heavy layers are left out.
export function layersFor(search) {
  const lite = new URLSearchParams(search ?? "").get("lite") === "1";
  return LAYERS.filter((l) => !(lite && l.heavy)).map((l) => l.module);
}
