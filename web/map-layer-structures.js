// 2D map layer of the extended buildings (docs/game-design-v04.md; contract in map-layers.js). Shown
// while the structure rules are on and the engine reports the structures. Each structure is a
// rectangle of its genre's colour over its footprint, a darker 1px frame, and a small red mark in the
// top-right corner when it needs power and has none. It draws what the engine reports and nothing else.
// Pure drawing: the pure part is in map-layer-structures-model.js.
import {
  decodeStructures, decodeCatalog, rectOf, colorOf, needsPower, isPowered, MAX_DRAWN,
  OUTLINE_COLOR, POWER_MARK_COLOR,
} from "./map-layer-structures-model.js";

const hasStructures = (city) =>
  typeof city?.structure_rules === "function" && typeof city?.structures === "function";

// The catalog is optional: an engine without it gives no power mark, the rest is drawn the same.
function readCatalog(city) {
  return typeof city.structure_catalog === "function"
    ? decodeCatalog(city.structure_catalog())
    : decodeCatalog(null);
}

// The four 1px sides of the frame, drawn inside the footprint [x, y, w, h].
function drawFrame(ctx, [x, y, w, h]) {
  ctx.fillStyle = OUTLINE_COLOR;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

// A square mark of about a quarter tile, in the top-right corner of the footprint.
function drawPowerMark(ctx, [x, y, w, h], scale) {
  const size = Math.min(Math.max(2, Math.floor(scale / 4)), w, h);
  ctx.fillStyle = POWER_MARK_COLOR;
  ctx.fillRect(x + w - size, y, size, size);
}

function drawStructure(ctx, record, catalog, scale) {
  const rect = rectOf(record, scale);
  ctx.fillStyle = colorOf(record.genre);
  ctx.fillRect(...rect);
  drawFrame(ctx, rect);
  if (!isPowered(record) && needsPower(catalog, record.genre)) drawPowerMark(ctx, rect, scale);
}

function draw(ctx, city, scale) {
  if (!hasStructures(city)) return;
  const catalog = readCatalog(city);
  ctx.save();
  for (const record of decodeStructures(city.structures(), MAX_DRAWN)) {
    drawStructure(ctx, record, catalog, scale);
  }
  ctx.restore();
}

export const STRUCTURES_LAYER = Object.freeze({
  name: "structures",
  visible: (city) => hasStructures(city) && Boolean(city.structure_rules()),
  draw,
});
