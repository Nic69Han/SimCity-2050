// 2D map layer of the zone wealth (docs/game-design-v11.md). Shown while the «Voir la richesse» view is asked
// (setWealthView, from the economy panel). It paints a translucent tint over each tile the engine gives a wealth
// (modest brownish orange, middle yellow-green, wealthy deep green), one rectangle per tile. It draws what the
// engine reports and nothing else. Pure drawing: the pure part is in map-layer-wealth-model.js.
import { forEachWealthTint, wealthViewState } from "./map-layer-wealth-model.js";

// A missing engine method = nothing drawn (an older engine, or the page before the engine has the layer).
const hasWealth = (city) => typeof city?.wealth_layer === "function";

function draw(ctx, city, scale) {
  forEachWealthTint(city.wealth_layer(), city.width(), city.height(), (x, y, tint) => {
    ctx.fillStyle = tint;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  });
}

export const WEALTH_LAYER = Object.freeze({
  name: "wealth",
  visible: (city) => hasWealth(city) && wealthViewState().show,
  draw,
});
