// 3D view, building models, pure part (ARCHITECTURE.md rule 5, docs/regles-de-code.md rule 2): which
// model a volume gets, how it is scaled and placed, and which instance index it takes. No DOM, no
// Three.js, so node:test can check it. view3d-models.js loads the .glb files and draws with this.
//
// Volumes come from view3d-model.js buildChunk: { slot, kind, x, y, base, sx, sy, sz, rgb } where
// `kind` is residential | commercial | industrial | tree, `slot` is unique per tile, (x, y) the tile
// and `base` the ground height at its centre. Everything here is deterministic (no random).

import { roadMask } from "./tiles.js";
import { classify } from "./view3d-model.js";

// Models of the Kenney City Kits (CC0, docs/credits.md): id -> file under web/models/.
export const MODEL_FILES = Object.freeze({
  "sub-h": "suburban/building-type-h.glb",
  "sub-i": "suburban/building-type-i.glb",
  "sub-c": "suburban/building-type-c.glb",
  "sub-a": "suburban/building-type-a.glb",
  "sub-k": "suburban/building-type-k.glb",
  "sub-l": "suburban/building-type-l.glb",
  "sub-r": "suburban/building-type-r.glb",
  "sub-o": "suburban/building-type-o.glb",
  "sub-s": "suburban/building-type-s.glb",
  "sub-tree-large": "suburban/tree-large.glb",
  "sub-tree-small": "suburban/tree-small.glb",
  "com-a": "commercial/building-a.glb",
  "com-b": "commercial/building-b.glb",
  "com-c": "commercial/building-c.glb",
  "com-d": "commercial/building-d.glb",
  "com-f": "commercial/building-f.glb",
  "com-h": "commercial/building-h.glb",
  "com-sky-a": "commercial/building-skyscraper-a.glb",
  "com-sky-c": "commercial/building-skyscraper-c.glb",
  "com-sky-e": "commercial/building-skyscraper-e.glb",
  "ind-h": "industrial/building-h.glb",
  "ind-i": "industrial/building-i.glb",
  "ind-k": "industrial/building-k.glb",
  "ind-o": "industrial/building-o.glb",
  "ind-d": "industrial/building-d.glb",
  "ind-g": "industrial/building-g.glb",
  "ind-j": "industrial/building-j.glb",
  "ind-n": "industrial/building-n.glb",
  "ind-e": "industrial/building-e.glb",
  "ind-f": "industrial/building-f.glb",
});

// Model ids of each kind by density level (index 0 low, 1 medium, 2 high). Trees have one level.
export const CATALOG = Object.freeze({
  residential: [["sub-h", "sub-i", "sub-c", "sub-a"], ["sub-k", "sub-l", "sub-r", "sub-o", "sub-s"], ["com-a", "com-h"]],
  commercial: [["com-b", "com-c", "com-d"], ["com-f", "com-h"], ["com-sky-a", "com-sky-c", "com-sky-e"]],
  industrial: [["ind-h", "ind-i", "ind-k", "ind-o"], ["ind-d", "ind-g", "ind-j", "ind-n"], ["ind-e", "ind-f"]],
  tree: [["sub-tree-large", "sub-tree-small"]],
});

// Brightness factor of the model materials. The Kenney colour maps are mid and dark slate tones
// (the mean texel of the buildings is about 0.45 of white) and the scene draws the sRGB values as
// they are, so the models came out darker than the terrain; this puts them at its brightness.
export const MODEL_GAIN = 1.5;
export const TREE_GAIN = 1.0; // the tree models are already bright green

// Brightness factor of the model `id` (see MODEL_GAIN).
export const gainOf = (id) => (CATALOG.tree.flat().includes(id) ? TREE_GAIN : MODEL_GAIN);

export const KINDS = Object.freeze(Object.keys(CATALOG));

// Instances one model can hold (per sub-mesh). A 120 x 100 map has 12 000 tiles; the variants of a
// level share them by a hash, so 4096 is ample. Past it, the volumes of that model are not drawn.
export const MODEL_CAPACITY = 4096;

export const LEVEL_HEIGHTS = Object.freeze([1.2, 1.75]); // volume height (tiles) where level 1 and 2 begin
export const FOOTPRINT = 0.96; // longest side of a building model, in tiles
export const MAX_UPSCALE = 1.2; // a small model is not enlarged past this
export const STRETCH_MIN = 0.75; // vertical stretch that makes a model match its volume height, bounds
export const STRETCH_MAX = 1.5;
export const TREE_FIT_HEIGHT = 1.0; // a tree model is this tall (tiles) at volume scale 1

// Density level of a volume of `kind` and `height` (tiles): 0, 1 or 2 (trees: 0).
export function levelOf(kind, height) {
  if (kind === "tree") return 0;
  let level = 0;
  for (const limit of LEVEL_HEIGHTS) if (height >= limit) level++;
  return level;
}

// Deterministic 32-bit hash of a tile position (integer mixing, no Math.random).
export function tileHash(x, y) {
  let h = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

export const FACING_REACH = 2; // a road up to this many tiles away (across zone tiles) is "the road" of a building

// Sides to look at, as [dx, dy, quarter]: the quarter turn that points the front of a model (its +Z
// axis, the Kenney convention) at that side: south (+y) 0, east (+x) 1, north (-y) 2, west (-x) 3.
const SIDES = Object.freeze([[0, 1, 0], [1, 0, 1], [0, -1, 2], [-1, 0, 3]]);

// Quarter turn (0..3) that makes the building on tile (x, y) face its road, or -1 when no road is
// within reach. From the tile, each side is followed across zone tiles (the rest of its own zone) up
// to FACING_REACH tiles; a road found there makes the side a candidate, the nearest side wins and a
// tie goes to the tile hash (deterministic). `tiles` are the engine's tile words, index x * h + y.
// Zone tiles change only with the tiles within FACING_REACH, which the chunk diffing of
// view3d-model.js (REACH) already redraws.
export function facingQuarter(tiles, w, h, x, y) {
  let best = FACING_REACH + 1;
  const near = [];
  for (const [dx, dy, quarter] of SIDES) {
    let d = 0;
    for (let step = 1; step <= FACING_REACH; step++) {
      const tx = x + dx * step, ty = y + dy * step;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) break;
      const word = tiles[tx * h + ty];
      if (roadMask(word)) {
        d = step;
        break;
      }
      if (classify(word).zone === null) break; // not the zone, not a road: nothing on this side
    }
    if (d === 0 || d > best) continue;
    if (d < best) near.length = 0;
    best = d;
    near.push(quarter);
  }
  return near.length ? near[tileHash(x, y) % near.length] : -1;
}

// The model of a volume: { id, quarter } where quarter (0..3) is its yaw in quarter turns. The
// level picks the list, the tile position picks the variant. `facing` (a quarter, or -1) is the
// yaw towards the road (facingQuarter); without it, and for trees, the yaw comes from the hash.
// Null when the catalog has no model.
export function chooseModel(catalog, v, facing = -1) {
  const levels = catalog[v.kind];
  if (!levels) return null;
  const list = levels[Math.min(levelOf(v.kind, v.sy), levels.length - 1)];
  if (!list || list.length === 0) return null;
  const h = tileHash(v.x, v.y);
  const quarter = facing >= 0 && v.kind !== "tree" ? facing & 3 : (h >>> 24) & 3;
  return { id: list[h % list.length], quarter };
}

// Kinds whose models can be drawn, and the catalog restricted to the ids that loaded: a kind is
// usable when every level still has a model. A failed file only thins its levels out.
export function usableCatalog(catalog, loadedIds) {
  const loaded = new Set(loadedIds);
  const out = {};
  for (const kind of Object.keys(catalog)) {
    const levels = catalog[kind].map((list) => list.filter((id) => loaded.has(id)));
    if (levels.every((list) => list.length > 0)) out[kind] = levels;
  }
  return out;
}

// Scale { sx, sy, sz } of a model of size dims { w, h, d } (tiles at scale 1) for volume v. A
// building keeps its proportions in the footprint (the longest side, whatever the yaw), then is
// stretched in height towards the volume height within [STRETCH_MIN, STRETCH_MAX]. A tree is fitted
// to a height, scaled by the volume's own scale.
export function fitScale(dims, v) {
  if (v.kind === "tree") {
    const s = (TREE_FIT_HEIGHT * v.sy) / Math.max(dims.h, 1e-6);
    return { sx: s, sy: s, sz: s };
  }
  const s = Math.min(FOOTPRINT / Math.max(dims.w, dims.d, 1e-6), MAX_UPSCALE);
  const stretch = Math.min(STRETCH_MAX, Math.max(STRETCH_MIN, v.sy / Math.max(dims.h * s, 1e-6)));
  return { sx: s, sy: s * stretch, sz: s };
}

const COS = [1, 0, -1, 0];
const SIN = [0, 1, 0, -1];

// Writes the column-major 4 x 4 matrix of a model standing at the centre of tile (v.x, v.y) on
// v.base, turned by `quarter` quarter turns about Y and scaled by `scale`, at out[offset..offset+16).
// The model's geometry is centred on X and Z with its feet at Y = 0 (view3d-models.js).
export function writePlacement(out, offset, v, quarter, scale) {
  const c = COS[quarter & 3], s = SIN[quarter & 3];
  out.fill(0, offset, offset + 16);
  out[offset] = c * scale.sx;
  out[offset + 2] = 0 - s * scale.sx; // (0 - x, not -x: no negative zero)
  out[offset + 5] = scale.sy;
  out[offset + 8] = s * scale.sz;
  out[offset + 10] = c * scale.sz;
  out[offset + 12] = v.x + 0.5;
  out[offset + 13] = v.base;
  out[offset + 14] = v.y + 0.5;
  out[offset + 15] = 1;
  return out;
}

// --- instance slots -----------------------------------------------------------------------------

// The instance indexes of one model: keys (volume slots) packed in 0..count-1, so the instanced mesh
// draws `count` instances. add() gives a key an index (or -1 when full); remove() frees it by moving
// the last key into the hole, and returns that move so the caller copies the matrix too.
export function createSlotTable(capacity) {
  const keys = [];
  const index = new Map();
  return {
    capacity,
    get count() { return keys.length; },
    indexOf: (key) => index.get(key) ?? -1,
    keyAt: (i) => keys[i],
    add(key) {
      const known = index.get(key);
      if (known !== undefined) return known;
      if (keys.length >= capacity) return -1;
      keys.push(key);
      index.set(key, keys.length - 1);
      return keys.length - 1;
    },
    // Returns null when the key is absent, else { from, to } (from === to: nothing moved).
    remove(key) {
      const i = index.get(key);
      if (i === undefined) return null;
      const last = keys.length - 1;
      index.delete(key);
      if (i !== last) {
        keys[i] = keys[last];
        index.set(keys[i], i);
      }
      keys.pop();
      return { from: last, to: i };
    },
    clear() {
      keys.length = 0;
      index.clear();
    },
  };
}
