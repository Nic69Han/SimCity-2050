// 2D map layer of the highways (docs/game-design-v13.md; contract in map-layers.js). Shown while the highways rule
// is on and «Voir les autoroutes» is asked. It strokes a wide orange-red band along the highway tiles, from tile
// centre to tile centre. It draws what the engine reports and nothing else.
// Pure drawing: the pure part is in map-layer-highways-model.js.
import { forEachHighwayStroke, highwaysViewState } from "./map-layer-highways-model.js";

export const HIGHWAY_COLOR = "rgb(230, 81, 0)"; // orange-red
// The band's width, in tiles (a stroke is at least 2 canvas pixels wide).
export const HIGHWAY_WIDTH_TILES = 0.6;
const MIN_WIDTH_PX = 2;

// A missing engine method = nothing drawn (an older engine, or the page before the engine has the rule).
const hasHighways = (city) =>
  typeof city?.highway_rules === "function" && typeof city?.highway_layer === "function";

function draw(ctx, city, scale) {
  const centre = (t) => (t + 0.5) * scale;
  ctx.save();
  ctx.strokeStyle = HIGHWAY_COLOR;
  ctx.lineWidth = Math.max(MIN_WIDTH_PX, scale * HIGHWAY_WIDTH_TILES);
  ctx.lineCap = "round";
  ctx.beginPath();
  forEachHighwayStroke(city.highway_layer(), city.width(), city.height(), (x0, y0, x1, y1) => {
    ctx.moveTo(centre(x0), centre(y0));
    ctx.lineTo(centre(x1), centre(y1));
  });
  ctx.stroke();
  ctx.restore();
}

export const HIGHWAYS_LAYER = Object.freeze({
  name: "highways",
  visible: (city) => hasHighways(city) && Boolean(city.highway_rules()) && highwaysViewState().show,
  draw,
});
