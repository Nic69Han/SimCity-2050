// 2D map layer of the vehicles (docs/game-design-v03.md; contract in map-layers.js). Shown while the
// agent rules are on and the engine reports the vehicles and the traffic. It paints a faint tint
// over the busy tiles (orange, red in a jam), then each vehicle as a small rectangle elongated
// along its direction. It draws what the engine reports and nothing else.
// Pure drawing: the pure part is in map-layer-vehicles-model.js.
import {
  decodeVehicles, vehicleRect, loadColor, kindColor, MAX_DRAWN,
} from "./map-layer-vehicles-model.js";

const hasVehicles = (city) =>
  typeof city?.agent_rules === "function" &&
  typeof city?.vehicles === "function" &&
  typeof city?.traffic_load === "function";

function drawTraffic(ctx, city, scale) {
  const w = city.width();
  const load = city.traffic_load();
  if (!(w > 0) || !load) return;
  const n = Math.min(load.length, w * city.height());
  for (let i = 0; i < n; i++) {
    const color = loadColor(load[i]);
    if (color === null) continue;
    ctx.fillStyle = color;
    ctx.fillRect((i % w) * scale, Math.floor(i / w) * scale, scale, scale);
  }
}

function draw(ctx, city, scale) {
  if (!hasVehicles(city)) return;
  ctx.save();
  drawTraffic(ctx, city, scale);
  for (const v of decodeVehicles(city.vehicles(MAX_DRAWN))) {
    ctx.fillStyle = kindColor(v.kind);
    const [x, y, w, h] = vehicleRect(v, scale);
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

export const VEHICLES_LAYER = Object.freeze({
  name: "vehicles",
  visible: (city) => hasVehicles(city) && Boolean(city.agent_rules()),
  draw,
});
