// 2D map layer of the public services coverage (docs/game-design-v09.md; contract in map-layers.js).
// Shown while the service rules are on and a kind of coverage is chosen (education, health or safety). It
// paints a translucent tint over each tile the engine gives a coverage value, one rectangle per tile. It draws
// what the engine reports and nothing else.
// Pure drawing: the pure part is in map-layer-coverage-model.js.
import { forEachTint, coverageViewState } from "./map-layer-coverage-model.js";

// A missing engine method = nothing drawn (an older engine, or the page before the engine has the rules).
const hasCoverage = (city) =>
  typeof city?.service_rules === "function" && typeof city?.coverage_layer === "function";

function visible(city) {
  return hasCoverage(city) && Boolean(city.service_rules()) && coverageViewState().kind !== null;
}

function draw(ctx, city, scale) {
  if (!visible(city)) return;
  const { kind } = coverageViewState();
  forEachTint(city.coverage_layer(kind), city.width(), city.height(), kind, (x, y, tint) => {
    ctx.fillStyle = tint;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  });
}

export const COVERAGE_LAYER = Object.freeze({ name: "coverage", visible, draw });
