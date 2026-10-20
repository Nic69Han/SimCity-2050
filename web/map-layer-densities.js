// 2D map layer of the zoning densities and farms (docs/game-design-v07.md; contract in map-layers.js).
// Shown while the density rules are on and the «Densités» view is asked. It paints a translucent tint over
// each tile the engine gives a density (pale yellow light, orange medium, red dense, green farm), one
// rectangle per tile. It draws what the engine reports and nothing else.
// Pure drawing: the pure part is in map-layer-densities-model.js.
import { forEachTint, densityViewState } from "./map-layer-densities-model.js";

// A missing engine method = nothing drawn (an older engine, or the page before the engine has the rule).
const hasDensities = (city) =>
  typeof city?.density_rules === "function" && typeof city?.density_layer === "function";

function draw(ctx, city, scale) {
  forEachTint(city.density_layer(), city.width(), city.height(), (x, y, tint) => {
    ctx.fillStyle = tint;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  });
}

export const DENSITIES_LAYER = Object.freeze({
  name: "densities",
  visible: (city) => hasDensities(city) && Boolean(city.density_rules()) && densityViewState().show,
  draw,
});
