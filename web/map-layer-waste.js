// 2D map layer of the accumulated garbage (docs/game-design-v08.md; contract in map-layers.js). Shown while
// the waste rules are on and the «Déchets» view is asked. It paints a brown tint over each tile that holds
// garbage, its strength growing with the amount (four levels), one rectangle per tile. It draws what the
// engine reports and nothing else.
// Pure drawing: the pure part is in map-layer-waste-model.js.
import { forEachTint, wasteViewState } from "./map-layer-waste-model.js";

// A missing engine method = nothing drawn (an older engine, or the page before the engine has the rule).
const hasWaste = (city) =>
  typeof city?.waste_rules === "function" && typeof city?.waste_layer === "function";

function draw(ctx, city, scale) {
  forEachTint(city.waste_layer(), city.width(), city.height(), (x, y, tint) => {
    ctx.fillStyle = tint;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  });
}

export const WASTE_LAYER = Object.freeze({
  name: "waste",
  visible: (city) => hasWaste(city) && Boolean(city.waste_rules()) && wasteViewState().show,
  draw,
});
