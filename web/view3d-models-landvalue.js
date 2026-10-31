// 3D view building models, land value and density, pure part (docs/game-design-v14.md): the land value
// tier of a tile, the density cap of a tile, and a cheap key per terrain chunk that changes when one of
// them changes, so the layer redraws only those chunks. No DOM, no Three.js; node:test checks it.
//
// Land value: city.overlay(1) cells with city.overlay_layout(1) = [block, cols, rows]; cells are in
// column order (index = cx * rows + cy) and a cell covers block x block tiles.
// Density: city.density_layer(), one byte per tile, index = x * height + y; 1 light, 2 medium,
// 3 dense, 4 farm, 0 nothing. Read only while city.density_rules() is true.
import { chunkBounds } from "./view3d-model.js";

export const LV_MID = 60; // land value below: modest tier
export const LV_HIGH = 120; // land value below (and from LV_MID): middle tier; else wealthy
export const LV_OVERLAY = 1; // the engine overlay that holds the land value
export const TIER = Object.freeze({ MODEST: 0, MIDDLE: 1, WEALTHY: 2 });
export const TIER_NONE = -1; // no land value known: the variant comes from the hash alone
export const CAP_NONE = -1; // no density cap

// Tier of a land value; a non-number gives TIER_NONE.
export function tierOfValue(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return TIER_NONE;
  if (value < LV_MID) return TIER.MODEST;
  return value < LV_HIGH ? TIER.MIDDLE : TIER.WEALTHY;
}

// Highest density level (0 low, 1 medium) allowed by a density byte; CAP_NONE for dense, farm, none
// and any unknown value.
export function capOfDensity(value) {
  if (value === 1) return 0;
  if (value === 2) return 1;
  return CAP_NONE;
}

const isCount = (n) => Number.isInteger(n) && n > 0;

// The land value of a city as { cells, block, cols, rows }, or null when the engine has no such
// overlay or its data is inconsistent (wrong layout, or a length other than cols * rows).
export function readLandValue(city) {
  if (typeof city?.overlay !== "function" || typeof city?.overlay_layout !== "function") return null;
  const layout = city.overlay_layout(LV_OVERLAY);
  const cells = city.overlay(LV_OVERLAY);
  if (!layout || layout.length < 3 || !cells || typeof cells.length !== "number") return null;
  const [block, cols, rows] = layout;
  if (!isCount(block) || !isCount(cols) || !isCount(rows) || cells.length !== cols * rows) return null;
  return { cells, block, cols, rows };
}

// The density bytes of a city, or null when there is no density API, the rule is off, or the length
// is not w * h.
export function readDensity(city, w, h) {
  if (typeof city?.density_rules !== "function" || typeof city?.density_layer !== "function") return null;
  if (!city.density_rules()) return null;
  const bytes = city.density_layer();
  return ArrayBuffer.isView(bytes) && bytes.length === w * h ? bytes : null;
}

// Tier of tile (x, y), TIER_NONE without land value or outside its cells.
export function tierAt(lv, x, y) {
  if (!lv) return TIER_NONE;
  const cx = Math.floor(x / lv.block), cy = Math.floor(y / lv.block);
  if (x < 0 || y < 0 || cx >= lv.cols || cy >= lv.rows) return TIER_NONE;
  return tierOfValue(lv.cells[cx * lv.rows + cy]);
}

// Density cap of tile (x, y) in a map h tiles high, CAP_NONE without density data.
export function capAt(density, h, x, y) {
  if (!density) return CAP_NONE;
  return capOfDensity(density[x * h + y]);
}

// What chooseModel needs about a tile: { tier, cap }.
export function siteAt(lv, density, h, x, y) {
  return { tier: tierAt(lv, x, y), cap: capAt(density, h, x, y) };
}

const KEY_BASIS = 0x811c9dc5;
const KEY_PRIME = 0x01000193;
export const TIER_CODES = 4; // tier -1..2 as 0..3
export const CAP_CODES = 3; // cap -1..1 as 0..2

// One small integer for the (tier, cap) pair of a tile.
export const siteCode = (tier, cap) => (tier + 1) * CAP_CODES + (cap + 1);

// Key of chunk `chunk` of `grid` (view3d-model.js chunkGrid): a 32-bit FNV-style fold of the site
// codes of its tiles. Two equal keys mean "no change" (a collision, 1 in 2^32, would only skip a
// redraw until the next change). The loop is bounded by the chunk size (CHUNK x CHUNK tiles).
export function chunkKey(grid, chunk, lv, density) {
  const { x0, y0, x1, y1 } = chunkBounds(grid, chunk);
  let key = KEY_BASIS;
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      key = Math.imul(key ^ siteCode(tierAt(lv, x, y), capAt(density, grid.h, x, y)), KEY_PRIME);
    }
  }
  return key >>> 0;
}

// Keys of every chunk of the grid: an array of grid.count integers.
export function chunkKeys(grid, lv, density) {
  const keys = new Array(grid.count);
  for (let c = 0; c < grid.count; c++) keys[c] = chunkKey(grid, c, lv, density);
  return keys;
}

// Chunks whose key differs between two arrays (null or another length: all chunks of `next`).
export function changedChunks(prev, next) {
  const out = [];
  const same = Array.isArray(prev) && prev.length === next.length;
  for (let c = 0; c < next.length; c++) if (!same || prev[c] !== next[c]) out.push(c);
  return out;
}
