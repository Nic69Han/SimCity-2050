// The layers of the 3D view (docs/game-design.md, "Points d'extension"). Each module exports
// createLayer(), which returns an object with optional mount(ctx), update(ctx, change),
// frame(ctx, seconds) and dispose(ctx). view3d.js mounts them in this order.
import * as models from "./view3d-models.js";
import * as ambiance from "./view3d-ambiance.js";
import * as camera from "./view3d-camera.js";

export const LAYERS = Object.freeze([models, ambiance, camera]);
