// 2D coverage layer, pure part (docs/game-design-v09.md, "Couches de carte"): the kinds of coverage, the tint of
// each engine value (bucketed in four levels), the column-major walk over the tiles, and the view choice
// (module-owned state, read by map-layer-coverage.js). No DOM, so node:test can check it.
//
// The engine's coverage_layer(kind) is one byte per tile in engine order: index = x * height + y (column-major).
// Values 0..=255: how well the tile is covered by the service of the kind (0 not covered).
export const COVERAGE_KIND = Object.freeze({ EDUCATION: 0, HEALTH: 1, SAFETY: 2 });
export const KIND_COUNT = Object.keys(COVERAGE_KIND).length;

// Engine values run from 0 to VALUE_MAX; they fall in LEVELS buckets of equal width above 0.
export const VALUE_MAX = 255;
export const LEVELS = 4;
// Alpha of each level: level 1 is the palest, level LEVELS the strongest (proportional to the bucket).
export const ALPHA_STEP = 0.15;

// One colour per kind: education blue, health red-pink, safety purple (RGB components).
const RGB_OF_KIND = Object.freeze([
  Object.freeze([30, 136, 229]),
  Object.freeze([233, 30, 99]),
  Object.freeze([123, 31, 162]),
]);

// The bucket of a value: 0 for nothing, 1..LEVELS otherwise (LEVELS for the highest values).
// Null for a value outside 0..VALUE_MAX or not an integer.
export function levelOf(value) {
  if (!Number.isInteger(value) || value < 0 || value > VALUE_MAX) return null;
  return value === 0 ? 0 : Math.ceil((value * LEVELS) / (VALUE_MAX + 1));
}

// The tint of a value for a kind: an rgba string, or null for nothing, an unknown kind or a bad value.
export function tintOf(kind, value) {
  const level = levelOf(value);
  if (level === null || level === 0 || !isKind(kind)) return null;
  const [r, g, b] = RGB_OF_KIND[kind];
  return `rgba(${r}, ${g}, ${b}, ${(level * ALPHA_STEP).toFixed(2)})`;
}

export function isKind(kind) {
  return Number.isInteger(kind) && kind >= 0 && kind < KIND_COUNT;
}

// Calls visit(x, y, tint) for every tile with a tint, in engine order. The walk is bounded by the map size
// (width * height): bytes past it are ignored, and a shorter array only visits what it holds.
export function forEachTint(bytes, w, h, kind, visit) {
  if (!ArrayBuffer.isView(bytes) || !(w > 0) || !(h > 0) || !isKind(kind)) return;
  const n = Math.min(bytes.length, w * h);
  for (let i = 0; i < n; i++) {
    const tint = tintOf(kind, bytes[i]);
    if (tint !== null) visit(Math.floor(i / h), i % h, tint);
  }
}

// The view choice: the kind of coverage shown, or null for none. Module-owned state.
const view = { kind: null };

// Chooses the kind shown (null for none). Changes it and returns whether it changed.
// An unknown kind is an error (RangeError), not a silent «none».
export function setCoverageView(kind) {
  if (kind !== null && !isKind(kind)) throw new RangeError(`unknown coverage kind: ${kind}`);
  const changed = kind !== view.kind;
  view.kind = kind;
  return changed;
}

export function coverageViewState() {
  return { ...view };
}
