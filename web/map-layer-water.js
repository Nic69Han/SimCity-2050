// 2D map layer of the water network (docs/game-design-v02.md; contract in map-layers.js). Shown
// while the water rules are on and either a water tool is chosen or the «Voir le réseau» view is
// on. It draws what the engine reports and nothing else: pipes as blue lines (pale grey-blue when
// no pump feeds them), pumps as discs, and a red tint over the zones that have no water.
// Pure: no DOM, so node:test can check it with a fake context.
import { networkShapes } from "./water-model.js";

const COLORS = Object.freeze({
  pipe: "#1e88e5",
  dry: "#9fb3c8",
  pump: "#00bcd4",
  pumpEdge: "#004d66",
  tint: "rgba(217, 48, 37, 0.38)",
});

// What the layer is told by water-ui.js: the view toggle and whether a water tool is chosen.
// This module owns it (no other module keeps a copy).
const view = { show: false, tool: false };

// Changes the view state; returns whether it changed (the page then redraws).
export function setWaterView({ show = view.show, tool = view.tool } = {}) {
  const changed = show !== view.show || tool !== view.tool;
  view.show = Boolean(show);
  view.tool = Boolean(tool);
  return changed;
}

export function waterViewState() {
  return { ...view };
}

const hasWater = (city) =>
  typeof city?.water_rules === "function" && typeof city?.water_layer === "function";

function strokeSegments(ctx, segments, scale, color, width) {
  if (segments.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segments) {
    ctx.moveTo((x1 + 0.5) * scale, (y1 + 0.5) * scale);
    ctx.lineTo((x2 + 0.5) * scale, (y2 + 0.5) * scale);
  }
  ctx.stroke();
}

function draw(ctx, city, scale) {
  const w = city.width(), h = city.height();
  // dry zones first, so the pipes stay readable on top of the tint
  const dry = city.water_dry_zones();
  ctx.fillStyle = COLORS.tint;
  for (let i = 0; i + 1 < dry.length; i += 2) {
    ctx.fillRect((dry[i] - 1) * scale, (dry[i + 1] - 1) * scale, 3 * scale, 3 * scale);
  }
  const shapes = networkShapes(city.water_layer(), w, h);
  ctx.save();
  ctx.lineCap = "round";
  const line = Math.max(1, scale / 4);
  strokeSegments(ctx, shapes.dry, scale, COLORS.dry, line);
  strokeSegments(ctx, shapes.fed, scale, COLORS.pipe, line);
  for (const [x, y, fed] of shapes.dots) {
    ctx.fillStyle = fed ? COLORS.pipe : COLORS.dry;
    ctx.fillRect(x * scale + scale * 0.375, y * scale + scale * 0.375, scale * 0.25, scale * 0.25);
  }
  ctx.fillStyle = COLORS.pump;
  ctx.strokeStyle = COLORS.pumpEdge;
  ctx.lineWidth = Math.max(1, scale / 8);
  for (const [x, y] of shapes.pumps) {
    ctx.beginPath();
    ctx.arc((x + 0.5) * scale, (y + 0.5) * scale, scale * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export const WATER_LAYER = Object.freeze({
  name: "water",
  visible: (city) => hasWater(city) && city.water_rules() && (view.show || view.tool),
  draw,
});
