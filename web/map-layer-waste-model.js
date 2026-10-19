// 2D waste layer, pure part (docs/game-design-v08.md, "Couche et 3D"): the brown tint of each level of
// the engine's accumulated garbage, the walk over its tiles, and the «Déchets» view toggle (module-owned
// state, read by map-layer-waste.js). No DOM, so node:test can check it.
//
// The engine's waste_layer() is one byte per tile in engine order: index = x * height + y (column-major).
// Values 0..=255: the garbage accumulated on the tile; 0 has no tint.
export const WASTE_MAX = 255;

// Four levels, each named by the least value it covers: a faint brown from 1, then stronger from 64, 128
// and 192. The alpha grows with the level.
export const WASTE_LEVELS = Object.freeze([
  Object.freeze({ min: 1, alpha: 0.2 }),
  Object.freeze({ min: 64, alpha: 0.35 }),
  Object.freeze({ min: 128, alpha: 0.5 }),
  Object.freeze({ min: 192, alpha: 0.65 }),
]);

const BROWN = "121, 85, 72";
const TINT_OF_LEVEL = Object.freeze(WASTE_LEVELS.map((l) => `rgba(${BROWN}, ${l.alpha})`));

// The level of a value (an index into WASTE_LEVELS), or -1 for nothing and for a value the layer
// does not hold (a non-integer, below 1 or above WASTE_MAX).
export function levelOf(value) {
  if (!Number.isInteger(value) || value < 1 || value > WASTE_MAX) return -1;
  let level = 0;
  for (let i = 1; i < WASTE_LEVELS.length; i++) {
    if (value >= WASTE_LEVELS[i].min) level = i;
  }
  return level;
}

// The tint of a value, or null when the tile has none.
export function tintOf(value) {
  const level = levelOf(value);
  return level < 0 ? null : TINT_OF_LEVEL[level];
}

// Calls visit(x, y, tint) for every tile with a tint, in engine order. The walk is bounded by the map size
// (width * height): bytes past it are ignored, and a shorter array only visits what it holds.
export function forEachTint(bytes, w, h, visit) {
  if (!ArrayBuffer.isView(bytes) || !(w > 0) || !(h > 0)) return;
  const n = Math.min(bytes.length, w * h);
  for (let i = 0; i < n; i++) {
    const tint = tintOf(bytes[i]);
    if (tint !== null) visit(Math.floor(i / h), i % h, tint);
  }
}

// The view toggle: whether the «Déchets» view is asked. Changes it and returns whether it changed.
const view = { show: false };

export function setWasteView(on) {
  const next = Boolean(on);
  const changed = next !== view.show;
  view.show = next;
  return changed;
}

export function wasteViewState() {
  return { ...view };
}
