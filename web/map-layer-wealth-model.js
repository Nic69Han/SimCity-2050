// 2D wealth layer, pure part (docs/game-design-v11.md, "Carte"): the tint of each value of the engine's
// wealth layer, the walk over its tiles, and the «Voir la richesse» view toggle (module-owned state, read by
// map-layer-wealth.js and set by the economy panel through setWealthView). No DOM, so node:test can check it.
//
// The engine's wealth_layer() is one byte per tile in engine order: index = x * height + y (column-major).
// Values: 0 nothing, 1 modest, 2 middle, 3 wealthy (the wealth of the zone that covers the tile).
export const WEALTH = Object.freeze({ NONE: 0, MODEST: 1, MIDDLE: 2, WEALTHY: 3 });

// Translucent tints, by value (index 0 has none): modest brownish orange, middle yellow-green, wealthy deep green.
export const WEALTH_TINT_MODEST = "rgba(191, 110, 40, 0.45)";
export const WEALTH_TINT_MIDDLE = "rgba(170, 200, 60, 0.45)";
export const WEALTH_TINT_WEALTHY = "rgba(0, 100, 40, 0.6)";

const TINT_OF_VALUE = Object.freeze([
  null,
  WEALTH_TINT_MODEST,
  WEALTH_TINT_MIDDLE,
  WEALTH_TINT_WEALTHY,
]);

// The tint of a wealth value, or null for nothing and for any value the layer does not know.
export function wealthTintOf(value) {
  return Number.isInteger(value) && value > 0 && value < TINT_OF_VALUE.length ? TINT_OF_VALUE[value] : null;
}

// True when the bytes are a usable wealth layer for a map of w x h: a typed array of exactly w * h bytes.
// Any other length (a short or long array, an older engine's answer) is refused as a whole, not clipped.
export function isWealthLayerOf(bytes, w, h) {
  return ArrayBuffer.isView(bytes) && w > 0 && h > 0 && bytes.length === w * h;
}

// Calls visit(x, y, tint) for every tile with a tint, in engine order. Nothing is visited when the layer
// does not match the map (see isWealthLayerOf). The walk is bounded by the map size (w * h).
export function forEachWealthTint(bytes, w, h, visit) {
  if (!isWealthLayerOf(bytes, w, h)) return;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const tint = wealthTintOf(bytes[i]);
    if (tint !== null) visit(Math.floor(i / h), i % h, tint);
  }
}

// The view toggle: whether the «Voir la richesse» view is asked. Hidden by default.
const view = { show: false };

// Changes the view and returns whether it changed.
export function setWealthView(on) {
  const next = Boolean(on);
  const changed = next !== view.show;
  view.show = next;
  return changed;
}

export function wealthViewState() {
  return { ...view };
}
