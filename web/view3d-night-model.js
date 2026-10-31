// 3D night lights, pure part (docs/game-design-v14.md, "Nuit"): how strong the night is, where the lit
// windows of the zone volumes and of the extended buildings go, and where the street lamps go. No DOM, no
// Three.js, so node:test can check it. view3d-night.js turns the placements into instanced glowing boxes.
//
// Units: 1 world unit = 1 tile. World X = tile x, Z = tile y, Y = height (view3d-model.js). A placement is
// a box centre and its scale, as writeMatrix (view3d-structures-model.js) expects.
// Everything is deterministic: the windows of a tile come from a hash of its coordinates, never from chance.
import { classify, groundY } from "./view3d-model.js";
import { GENRE, groundAt, insideMap } from "./view3d-structures-model.js";

export const POWERED_BIT = 1; // bit 0 of a structure record's state: powered
export const DAYLIGHT_ABSENT = 1; // no daylight written: it is day, so no night light
export const LEVEL_HEIGHT = 0.3; // a storey is at least this high (world units)
export const MAX_LEVELS = 6; // lit storeys of one volume, at most
export const WINDOWS_BASE = 2; // windows of a one-storey volume
export const WINDOWS_PER_LEVEL = 2; // windows added per storey above the first
export const MAX_WINDOWS_PER_VOLUME = 12;
export const SIDES = 4; // north, east, south, west
export const WINDOW = Object.freeze({ width: 0.1, height: 0.12, thick: 0.02 });
export const ZONE_KINDS = Object.freeze(["residential", "commercial", "industrial"]);
// Parks, squares and monuments have no walls: they stay dark.
export const UNLIT_GENRES = Object.freeze([GENRE.PARK, GENRE.SQUARE, GENRE.MONUMENT]);
export const STRUCTURE_WINDOWS_PER_TILE = 2; // lit windows per tile of a facade
export const STRUCTURE_WINDOW_Y = 0.25; // height of the lit row above the ground of an extended building
export const WINDOW_CAPACITY = 16384; // instances of the windows mesh; past it, dropped and counted
export const LAMP_SPACING = 6; // a lamp on every LAMP_SPACING-th road tile
export const LAMP_CAPACITY = 2048; // lamps (posts and heads); past it, dropped and counted
export const LAMP = Object.freeze({ offset: 0.3, post: 0.04, height: 0.5, head: 0.1 });
export const WINDOW_DIM = 0x3a3320; // a window at intensity 0 (hidden anyway)
export const WINDOW_LIT = 0xffd65a; // a lit window
export const LAMP_POST_COLOUR = 0x3d3d3d;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Night light of a daylight value (0 at night .. 1 at full day): 1 - daylight, clamped. An absent or
// non-finite value counts as full day, so nothing lights up.
export function intensityOf(daylight) {
  const d = Number.isFinite(daylight) ? daylight : DAYLIGHT_ABSENT;
  return clamp01(1 - d);
}

// Deterministic 32-bit hash of a tile (x, y) and a slot k: integer mixing, no randomness.
export function tileHash(x, y, k) {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(k + 1, 0xc2b2ae3d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

// Lit storeys of a volume of height sy: at least 1, at most MAX_LEVELS.
export function levelsOf(sy) {
  return Math.min(MAX_LEVELS, Math.max(1, Math.floor(sy / LEVEL_HEIGHT)));
}

// Windows of a volume with `levels` storeys: WINDOWS_BASE, plus WINDOWS_PER_LEVEL per storey above the first.
export function windowCountOf(levels) {
  return Math.min(MAX_WINDOWS_PER_VOLUME, WINDOWS_BASE + WINDOWS_PER_LEVEL * (levels - 1));
}

// One window on a face of the rectangle `rect` ({ x0, x1, z0, z1 }), at height yc (centre), at fraction u
// along the face. Sides: 0 north (z0), 1 east (x1), 2 south (z1), 3 west (x0). The box stands on the face,
// its outer half out of the wall.
export function facePlacement(rect, side, u, yc, size = WINDOW) {
  const half = size.thick / 2;
  const alongX = rect.x0 + u * (rect.x1 - rect.x0);
  const alongZ = rect.z0 + u * (rect.z1 - rect.z0);
  switch (side) {
    case 0: return box(alongX, yc, rect.z0 - half, size.width, size.height, size.thick);
    case 2: return box(alongX, yc, rect.z1 + half, size.width, size.height, size.thick);
    case 1: return box(rect.x1 + half, yc, alongZ, size.thick, size.height, size.width);
    default: return box(rect.x0 - half, yc, alongZ, size.thick, size.height, size.width);
  }
}

const box = (x, y, z, sx, sy, sz) => ({ x, y, z, sx, sy, sz });

// The windows of one zone volume ({ x, y, base, sx, sy, sz } from view3d-model.js buildChunk): spread over its
// four sides and its storeys, from a hash of its tile. A taller volume has more windows (bounded).
export function volumeWindows(v) {
  const levels = levelsOf(v.sy);
  const rect = { x0: v.x + 0.5 - v.sx / 2, x1: v.x + 0.5 + v.sx / 2, z0: v.y + 0.5 - v.sz / 2, z1: v.y + 0.5 + v.sz / 2 };
  const out = [];
  for (let k = 0; k < windowCountOf(levels); k++) {
    const r = tileHash(v.x, v.y, k);
    const side = r & (SIDES - 1);
    const u = 0.2 + 0.6 * (((r >>> 2) & 1023) / 1023); // inside the middle of the face
    const row = Math.floor(k / SIDES) % levels;
    const yc = v.base + ((row + 0.5) * v.sy) / levels;
    out.push(facePlacement(rect, side, u, yc));
  }
  return out;
}

// Whether a record of City.structures() ({ genre, x, y, w, h, state }) is lit: powered, a building with walls, on the map.
export function isLitStructure(s, w, h) {
  return (s.state & POWERED_BIT) !== 0 && !UNLIT_GENRES.includes(s.genre) && insideMap(s, w, h);
}

// The lit windows of an extended building: STRUCTURE_WINDOWS_PER_TILE per tile of each facade, on its
// footprint. At most 2 * (w + h) * STRUCTURE_WINDOWS_PER_TILE per record (the sides are clamped to MAX_SIDE).
export function structureWindows(s, corners, h) {
  const base = groundAt(corners, h, s);
  const rect = { x0: s.x, x1: s.x + s.w, z0: s.y, z1: s.y + s.h };
  const out = [];
  for (let side = 0; side < SIDES; side++) {
    const n = (side % 2 === 0 ? s.w : s.h) * STRUCTURE_WINDOWS_PER_TILE;
    for (let i = 0; i < n; i++) {
      out.push(facePlacement(rect, side, (i + 0.5) / n, base + STRUCTURE_WINDOW_Y));
    }
  }
  return out;
}

// Adds `item` to `items` while under `cap`, else counts it as dropped. Returns the new dropped count.
function addCapped(items, item, cap, dropped) {
  if (items.length < cap) {
    items.push(item);
    return dropped;
  }
  return dropped + 1;
}

// Every lit window: the zone volumes of `volumeLists` (one list per chunk) and the lit extended buildings
// of `records` (decoded). `w`, `h` the map, `corners` the terrain. Returns { items, dropped } with at most `cap`
// items; the trees are not buildings and get no window.
export function windowPlacements({ volumeLists, records, corners, w, h }, cap = WINDOW_CAPACITY) {
  const items = [];
  let dropped = 0;
  for (const list of volumeLists) {
    for (const v of list) {
      if (!ZONE_KINDS.includes(v.kind)) continue;
      for (const p of volumeWindows(v)) dropped = addCapped(items, p, cap, dropped);
    }
  }
  for (const s of records) {
    if (!isLitStructure(s, w, h)) continue;
    for (const p of structureWindows(s, corners, h)) dropped = addCapped(items, p, cap, dropped);
  }
  return { items, dropped };
}

// Indices (x * h + y, the engine's order) of the road tiles that get a lamp: every `spacing`-th road tile,
// counted in that order from the first one. Walks at most w * h tiles.
export function lampTiles(tiles, w, h, spacing = LAMP_SPACING) {
  if (!Number.isInteger(spacing) || spacing < 1) throw new RangeError(`night: lamp spacing must be an integer >= 1, got ${spacing}`);
  const out = [];
  let roads = 0;
  const n = Math.min(tiles.length, w * h);
  for (let i = 0; i < n; i++) {
    if (classify(tiles[i]).kind !== "road") continue;
    if (roads % spacing === 0) out.push(i);
    roads++;
  }
  return out;
}

// The lamps of the map: a post and a glowing head per lamp tile, the lamp set into the tile by LAMP.offset.
// Returns { posts, heads, dropped }: at most `cap` of each, `dropped` the lamps past the cap.
export function lampPlacements(tiles, corners, w, h, cap = LAMP_CAPACITY) {
  const posts = [], heads = [];
  let dropped = 0;
  for (const i of lampTiles(tiles, w, h)) {
    if (posts.length >= cap) {
      dropped++;
      continue;
    }
    const X = Math.floor(i / h) + 0.5 + LAMP.offset;
    const Z = (i % h) + 0.5 + LAMP.offset;
    const ground = groundY(corners, w, h, X, Z);
    posts.push(box(X, ground + LAMP.height / 2, Z, LAMP.post, LAMP.height, LAMP.post));
    heads.push(box(X, ground + LAMP.height + LAMP.head / 2, Z, LAMP.head, LAMP.head, LAMP.head));
  }
  return { posts, heads, dropped };
}
