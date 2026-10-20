// 3D extended buildings, pure part (ARCHITECTURE.md rule 5; docs/game-design-v04.md, "Calque 3D"): the
// records of City.structures() as plain numbers, and where each volume goes. No DOM, no Three.js, so
// node:test can check it. view3d-structures.js turns the placements into one instanced mesh per shape.
//
// A record is 6 integers [genre, x, y, width, height, state]: x, y the top-left tile, state bit 0
// powered, bit 1 watered (not drawn yet). World X = tile x, Z = tile y, Y = height (view3d-model.js).
// Genres: 1 urban park (flat slab with trees), 2 public square (flat slab with a fountain),
// 3 monument (stone base with a tall obelisk), 30-36 public services (docs/game-design-v09.md: school,
// college, library with columns, museum, clinic and hospital with a red cross, prison with a low wall);
// any other genre is a plain grey block.
// Only the kinds below are meshes: the thin pieces of a building (roof, walls, columns, cross arms) are
// "slab" boxes, its bodies are "block" boxes.
import { tileCentreY } from "./view3d-model.js";

export const RECORD = 6;
export const GENRE = Object.freeze({
  PARK: 1, SQUARE: 2, MONUMENT: 3,
  SCHOOL: 30, COLLEGE: 31, LIBRARY: 32, MUSEUM: 33, CLINIC: 34, HOSPITAL: 35, PRISON: 36,
});
export const SHAPES = Object.freeze({ SLAB: "slab", TREE: "tree", FOUNTAIN: "fountain", OBELISK: "obelisk", BLOCK: "block" });
export const KINDS = Object.freeze(Object.values(SHAPES));

// Instances per mesh. Past it, placements are dropped and counted, never written out of bounds.
export const CAPACITY = Object.freeze({ slab: 512, tree: 4096, fountain: 256, obelisk: 256, block: 256 });

// Largest footprint side accepted: a bigger record from the engine is clamped (the game's are 1 to 3).
export const MAX_SIDE = 8;

export const SLAB_HEIGHT = 0.05; // park and square slabs
export const TREES_PER_TILE = 4;
export const TREE = Object.freeze({ radius: 0.12, height: 0.35 }); // dark-green cones, 4 per tile
export const FOUNTAIN = Object.freeze({ radius: 0.15, height: 0.25 });
export const MONUMENT = Object.freeze({ base: 0.15, width: 0.4, height: 2.5 });
export const BLOCK_HEIGHT = 0.8;

// Services (genres 30-36). Heights in world units (a tile is 1 unit wide).
export const SCHOOL = Object.freeze({ height: 0.9, roof: 0.08 }); // beige block, red roof slab
export const COLLEGE = Object.freeze({ height: 1.5 }); // larger beige block
export const LIBRARY = Object.freeze({ height: 0.8, inset: 0.1, columnsPerTile: 2, column: 0.12 });
export const MUSEUM = Object.freeze({ height: 0.6 }); // wide white block
export const CLINIC = Object.freeze({ height: 0.7, cross: Object.freeze({ arm: 0.5, thick: 0.16, height: 0.04 }) });
export const HOSPITAL = Object.freeze({ height: 1.8, cross: Object.freeze({ arm: 1.0, thick: 0.3, height: 0.05 }) });
export const PRISON = Object.freeze({ height: 0.9, inset: 0.25, wall: Object.freeze({ height: 0.35, thick: 0.1 }) });

export const COLORS = Object.freeze({
  park: "#5cb85c", tree: "#1b5e20", square: "#e8dcc0", fountain: "#90caf9",
  stone: "#8a8f96", obelisk: "#b8bec6", block: "#9e9e9e",
  beige: "#e6d3a8", roof: "#c62828", white: "#f5f5f0", libraryStone: "#a59f94", column: "#d8d3c8",
  cross: "#d32f2f", prison: "#4f5358", prisonWall: "#7a7e85",
});

// Colour of a hex string as 0..1 components (the instance colour format).
export function rgbOfHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Footprint side clamped to 1..MAX_SIDE; anything that is not an integer counts as 1.
export function clampSide(v) {
  return Number.isInteger(v) ? Math.min(Math.max(v, 1), MAX_SIDE) : 1;
}

// Records of a read as objects. Only whole records are kept (a trailing partial one is ignored).
export function decodeStructures(data) {
  if (!data || typeof data.length !== "number") return [];
  const out = [];
  for (let i = 0; i + RECORD <= data.length; i += RECORD) {
    out.push({
      genre: data[i], x: data[i + 1], y: data[i + 2],
      w: clampSide(data[i + 3]), h: clampSide(data[i + 4]), state: data[i + 5],
    });
  }
  return out;
}

// Map width in tiles, from the corner array ((w + 1) * (h + 1) corners); 0 when the array does not fit.
export function mapWidth(corners, h) {
  if (!corners || !(h > 0)) return 0;
  const cols = corners.length / (h + 1) - 1;
  return Number.isInteger(cols) && cols > 0 ? cols : 0;
}

// Whether the footprint lies entirely on the map (a record past the edge is skipped, not drawn).
export function insideMap(s, w, h) {
  return Number.isInteger(s.x) && Number.isInteger(s.y) && s.x >= 0 && s.y >= 0 &&
    s.x + s.w <= w && s.y + s.h <= h;
}

// Height of the footprint: the mean of its tile centres (the terrain under its middle).
export function groundAt(corners, h, s) {
  let sum = 0, n = 0;
  for (let dx = 0; dx < s.w; dx++) {
    for (let dy = 0; dy < s.h; dy++) {
      sum += tileCentreY(corners, h, s.x + dx, s.y + dy);
      n++;
    }
  }
  return sum / n;
}

// One box-like placement: centre, full size, colour. Shapes are unit meshes scaled by these sizes.
function place(x, y, z, sx, sy, sz, hex) {
  return { x, y, z, sx, sy, sz, rgb: rgbOfHex(hex) };
}

// A flat slab covering the footprint, standing on `base`; returns the placement and the top height.
function slab(s, base, height, hex) {
  return { p: place(s.x + s.w / 2, base + height / 2, s.y + s.h / 2, s.w, height, s.h, hex), top: base + height };
}

// The trees of a park: TREES_PER_TILE cones per tile, on a quarter grid inside each tile.
function trees(s, top) {
  const out = [];
  const reach = TREE.height / 2;
  for (let dx = 0; dx < s.w; dx++) {
    for (let dy = 0; dy < s.h; dy++) {
      for (let k = 0; k < TREES_PER_TILE; k++) {
        const cx = s.x + dx + (k & 1 ? 0.75 : 0.25);
        const cz = s.y + dy + (k & 2 ? 0.75 : 0.25);
        out.push(place(cx, top + reach, cz, TREE.radius * 2, TREE.height, TREE.radius * 2, COLORS.tree));
      }
    }
  }
  return out;
}

const cx = (s) => s.x + s.w / 2;
const cz = (s) => s.y + s.h / 2;

// Each builder returns [shape, placement] pairs for one structure, standing on `base`.
const BUILDERS = Object.freeze({
  [GENRE.PARK](s, base) {
    const { p, top } = slab(s, base, SLAB_HEIGHT, COLORS.park);
    return [[SHAPES.SLAB, p], ...trees(s, top).map((t) => [SHAPES.TREE, t])];
  },
  [GENRE.SQUARE](s, base) {
    const { p, top } = slab(s, base, SLAB_HEIGHT, COLORS.square);
    const f = place(cx(s), top + FOUNTAIN.height / 2, cz(s), FOUNTAIN.radius * 2, FOUNTAIN.height, FOUNTAIN.radius * 2, COLORS.fountain);
    return [[SHAPES.SLAB, p], [SHAPES.FOUNTAIN, f]];
  },
  [GENRE.MONUMENT](s, base) {
    const { p, top } = slab(s, base, MONUMENT.base, COLORS.stone);
    const o = place(cx(s), top + MONUMENT.height / 2, cz(s), MONUMENT.width, MONUMENT.height, MONUMENT.width, COLORS.obelisk);
    return [[SHAPES.SLAB, p], [SHAPES.OBELISK, o]];
  },
});

// Any genre without a builder: a grey block over the footprint.
function block(s, base) {
  return [[SHAPES.BLOCK, place(cx(s), base + BLOCK_HEIGHT / 2, cz(s), s.w, BLOCK_HEIGHT, s.h, COLORS.block)]];
}

// A box over the footprint, standing on `base`, inset from its edges: the placement and the height of its top.
function body(s, base, height, hex, inset = 0) {
  const w = s.w - 2 * inset, d = s.h - 2 * inset;
  return { p: place(cx(s), base + height / 2, cz(s), w, height, d, hex), top: base + height };
}

// Two thin boxes crossing over the footprint, standing on `top`: the red cross of a clinic or hospital.
function crossOn(s, top, { arm, thick, height }) {
  const x = cx(s), z = cz(s), y = top + height / 2;
  return [
    [SHAPES.SLAB, place(x, y, z, thick, height, arm, COLORS.cross)],
    [SHAPES.SLAB, place(x, y, z, arm, height, thick, COLORS.cross)],
  ];
}

// Columns along the front (north) edge: COLUMNS_PER_TILE per tile of width, `height` tall. The count is
// bounded by the footprint width, which is clamped to MAX_SIDE.
function columns(s, base, height) {
  const w = clampSide(s.w);
  const n = w * LIBRARY.columnsPerTile;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = s.x + ((i + 0.5) * w) / n;
    const z = s.y + LIBRARY.column / 2;
    out.push([SHAPES.SLAB, place(x, base + height / 2, z, LIBRARY.column, height, LIBRARY.column, COLORS.column)]);
  }
  return out;
}

// A low wall of thin boxes around the footprint, standing on `base`.
function walls(s, base) {
  const { height, thick } = PRISON.wall;
  const y = base + height / 2;
  const hex = COLORS.prisonWall;
  return [
    [SHAPES.SLAB, place(cx(s), y, s.y + thick / 2, s.w, height, thick, hex)],
    [SHAPES.SLAB, place(cx(s), y, s.y + s.h - thick / 2, s.w, height, thick, hex)],
    [SHAPES.SLAB, place(s.x + thick / 2, y, cz(s), thick, height, s.h, hex)],
    [SHAPES.SLAB, place(s.x + s.w - thick / 2, y, cz(s), thick, height, s.h, hex)],
  ];
}

// The services (genres 30-36): a beige school with a red roof slab, a larger beige college, a stone library
// with columns, a wide white museum, a white clinic and a white hospital with a red cross, a dark prison
// with a low wall around its yard.
const SERVICE_BUILDERS = Object.freeze({
  [GENRE.SCHOOL](s, base) {
    const b = body(s, base, SCHOOL.height, COLORS.beige);
    const roof = body(s, b.top, SCHOOL.roof, COLORS.roof);
    return [[SHAPES.BLOCK, b.p], [SHAPES.SLAB, roof.p]];
  },
  [GENRE.COLLEGE](s, base) {
    return [[SHAPES.BLOCK, body(s, base, COLLEGE.height, COLORS.beige).p]];
  },
  [GENRE.LIBRARY](s, base) {
    const b = body(s, base, LIBRARY.height, COLORS.libraryStone, LIBRARY.inset);
    return [[SHAPES.BLOCK, b.p], ...columns(s, base, LIBRARY.height)];
  },
  [GENRE.MUSEUM](s, base) {
    return [[SHAPES.BLOCK, body(s, base, MUSEUM.height, COLORS.white).p]];
  },
  [GENRE.CLINIC](s, base) {
    const b = body(s, base, CLINIC.height, COLORS.white);
    return [[SHAPES.BLOCK, b.p], ...crossOn(s, b.top, CLINIC.cross)];
  },
  [GENRE.HOSPITAL](s, base) {
    const b = body(s, base, HOSPITAL.height, COLORS.white);
    return [[SHAPES.BLOCK, b.p], ...crossOn(s, b.top, HOSPITAL.cross)];
  },
  [GENRE.PRISON](s, base) {
    const b = body(s, base, PRISON.height, COLORS.prison, PRISON.inset);
    return [[SHAPES.BLOCK, b.p], ...walls(s, base)];
  },
});

const BUILDERS_ALL = Object.freeze({ ...BUILDERS, ...SERVICE_BUILDERS });

export function partsOf(s, base) {
  const build = BUILDERS_ALL[s.genre] ?? block;
  return build(s, base);
}

// Placements of the structures, by shape. `records` are decoded ones (decodeStructures); `corners`
// and `h` are the terrain. A record off the map is skipped. Returns { items, structures, dropped }:
// `structures` counts the records drawn, `dropped` the instances past the capacity of their shape.
export function placementsFor(records, corners, h, caps = CAPACITY) {
  const items = Object.fromEntries(KINDS.map((k) => [k, []]));
  const w = mapWidth(corners, h);
  let structures = 0, dropped = 0;
  for (const s of records) {
    if (!w || !insideMap(s, w, h)) continue;
    structures++;
    const base = groundAt(corners, h, s);
    for (const [shape, p] of partsOf(s, base)) {
      if (items[shape].length < caps[shape]) items[shape].push(p);
      else dropped++;
    }
  }
  return { items, structures, dropped };
}

// Writes the column-major matrix of a placement (translation and scale, no rotation) at out[offset].
export function writeMatrix(out, offset, p) {
  out.fill(0, offset, offset + 16);
  out[offset] = p.sx;
  out[offset + 5] = p.sy;
  out[offset + 10] = p.sz;
  out[offset + 12] = p.x;
  out[offset + 13] = p.y;
  out[offset + 14] = p.z;
  out[offset + 15] = 1;
}

// FNV-1a over the bytes: a cheap fingerprint to tell whether the layer changed since the last frame.
export function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  return h;
}

// Bytes of a typed array (the engine's Int32Array records), without copying.
export function bytesOf(data) {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

// What decides the drawing: the bytes of the records (fingerprint and length), the rule flag and the
// corner array (view3d.js replaces it when the terrain changes). Two keys equal means nothing to rebuild.
export function layerKey(data, rules, corners) {
  const has = data !== null && data !== undefined;
  return {
    rules: Boolean(rules),
    hash: has ? hashBytes(bytesOf(data)) : null,
    length: has ? data.length : 0,
    corners,
  };
}

export function sameKey(a, b) {
  return Boolean(a && b) && a.corners === b.corners && a.rules === b.rules &&
    a.hash === b.hash && a.length === b.length;
}
