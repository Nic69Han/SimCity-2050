// 2D densities layer, pure part (docs/game-design-v07.md, "Carte et 3D"): the tint of each value of the
// engine's density layer, the walk over its tiles, and the «Densités» view toggle (module-owned state, read
// by map-layer-densities.js). No DOM, so node:test can check it.
//
// The engine's density_layer() is one byte per tile in engine order: index = x * height + y (column-major).
// Values: 0 nothing, 1 light, 2 medium, 3 dense, 4 farm.
export const DENSITY = Object.freeze({ NONE: 0, LIGHT: 1, MEDIUM: 2, DENSE: 3, FARM: 4 });

// Translucent tints, by value (index 0 has none). Pale yellow, orange, red, farm green.
const TINT_OF_VALUE = Object.freeze([
  null,
  "rgba(255, 241, 118, 0.45)",
  "rgba(255, 152, 0, 0.5)",
  "rgba(229, 57, 53, 0.55)",
  "rgba(102, 187, 106, 0.55)",
]);

// The tint of a density value, or null for nothing and for any value the layer does not know.
export function tintOf(value) {
  return Number.isInteger(value) && value > 0 && value < TINT_OF_VALUE.length ? TINT_OF_VALUE[value] : null;
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

// The view toggle: whether the «Densités» view is asked. Changes it and returns whether it changed.
const view = { show: false };

export function setDensityView(on) {
  const next = Boolean(on);
  const changed = next !== view.show;
  view.show = next;
  return changed;
}

export function densityViewState() {
  return { ...view };
}
