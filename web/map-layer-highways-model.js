// 2D highways layer, pure part (docs/game-design-v13.md): the walk that turns the engine's highway layer into the
// strokes to draw, and the «Voir les autoroutes» view toggle (module-owned state, read by map-layer-highways.js).
// No DOM, so node:test can check it.
//
// The engine's highway_layer() is one byte per tile in engine order: index = x * height + y (column-major).
// Value 1 is a highway tile, 0 anything else.
export const HIGHWAY = 1;

// Whether the tile (x, y) is a highway, inside the map. Bytes past the array count as no highway.
function isHighway(bytes, w, h, x, y) {
  return x >= 0 && y >= 0 && x < w && y < h && x * h + y < bytes.length && bytes[x * h + y] === HIGHWAY;
}

/**
 * Calls visit(x0, y0, x1, y1) for every stroke of the highways, in engine order: a link to the tile on the east and
 * one to the tile on the south when they are highways, and a point (x0 = x1, y0 = y1) for a highway tile with no
 * highway next to it. Each link is visited once. The walk is bounded by the map size (width * height).
 */
export function forEachHighwayStroke(bytes, w, h, visit) {
  if (!ArrayBuffer.isView(bytes) || !(w > 0) || !(h > 0)) return;
  const n = Math.min(bytes.length, w * h);
  for (let i = 0; i < n; i++) {
    if (bytes[i] !== HIGHWAY) continue;
    const x = Math.floor(i / h), y = i % h;
    const east = isHighway(bytes, w, h, x + 1, y);
    const south = isHighway(bytes, w, h, x, y + 1);
    if (east) visit(x, y, x + 1, y);
    if (south) visit(x, y, x, y + 1);
    const alone = !east && !south && !isHighway(bytes, w, h, x - 1, y) && !isHighway(bytes, w, h, x, y - 1);
    if (alone) visit(x, y, x, y);
  }
}

// The view toggle: whether «Voir les autoroutes» is asked. Changes it and returns whether it changed.
const view = { show: false };

export function setHighwaysView(on) {
  const next = Boolean(on);
  const changed = next !== view.show;
  view.show = next;
  return changed;
}

export function highwaysViewState() {
  return { ...view };
}
