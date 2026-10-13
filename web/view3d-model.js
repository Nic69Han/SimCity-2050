// 3D view, pure part (ARCHITECTURE.md rule 5): the terrain, roads, power lines, trees and zone
// volumes as plain numbers. No DOM, no Three.js, so node:test can check it. view3d.js turns these
// arrays into meshes. The engine decides everything: altitudes come from City.heights() (absent or
// of the wrong length: flat at sea level), tiles from City.tiles().
//
// Layout: tiles and altitudes are column-major like the engine, index = x * h + y.
// Units: 1 world unit = 1 tile. An altitude a (0..=63) is a height of a * STEP, so sea level (8) is 2.
// World X = tile x, world Z = tile y, world Y = height. Tile (x, y) covers X in [x, x+1], Z in [y, y+1].
import { artClass, roadMask, railMask, wireMask, zonePiece, N, E, S, W } from "./tiles.js";
import { tileEntry } from "./palette.js";

export const CHUNK = 16; // tiles per side of a terrain chunk
export const SLOTS = CHUNK * CHUNK; // instance slots per chunk (chunk-major, see slotOf)
export const SEA = 8; // altitude of the sea level
export const ALT_MAX = 63;
export const STEP = 0.25; // world units per altitude step
export const WATER_BED = SEA - 2; // a water tile's bed lies under the water plane
export const WATER_Y = SEA * STEP;
export const TREE_HEIGHT = 0.9;
export const BUILD_WIDTH = 0.78; // a volume fills most of its tile
export const WIRE_HEIGHT = 0.55;
export const WIRE_HALF = 0.035; // half thickness of a power line box
export const ROAD_HALF = 0.17; // half width of a road strip
export const RAIL_HALF = 0.1;
export const STRIP_LIFT = 0.03; // strips sit just above the ground
export const PICK_STEP = 0.05;
const MISSING_RGB = "#ff00ff"; // a tile no palette range covers (renderer's magenta)

// Zone kind of each zonePiece family (tiles.js). Empty zones have no volume.
const ZONE_OF = Object.freeze({
  "res-empty": "residential", res: "residential", house: "residential", hospital: "residential", church: "residential",
  "com-empty": "commercial", com: "commercial",
  "ind-empty": "industrial", ind: "industrial",
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// --- altitudes ----------------------------------------------------------------------------------

// Altitude of each tile (Uint8Array, index x * h + y). `heights` may be missing or of the wrong
// length: the terrain is then flat at sea level. A water tile lies at most at WATER_BED.
export function altitudesOf(tiles, heights, w, h) {
  const n = w * h;
  const out = new Uint8Array(n);
  const useHeights = heights != null && heights.length === n;
  for (let i = 0; i < n; i++) {
    let a = useHeights ? clamp(heights[i] | 0, 0, ALT_MAX) : SEA;
    if (artClass(tiles[i]) === "water") a = Math.min(a, WATER_BED);
    out[i] = a;
  }
  return out;
}

// Corner altitudes in altitude steps, (w + 1) x (h + 1), index vx * (h + 1) + vy: the mean of the
// tiles around each corner (the tiles x-1..x, y-1..y that exist).
export function cornerAltitudes(alt, w, h) {
  const H = h + 1;
  const out = new Float32Array((w + 1) * H);
  for (let vx = 0; vx <= w; vx++) {
    for (let vy = 0; vy <= h; vy++) {
      let sum = 0, n = 0;
      for (let x = vx - 1; x <= vx; x++) {
        for (let y = vy - 1; y <= vy; y++) {
          if (x >= 0 && x < w && y >= 0 && y < h) {
            sum += alt[x * h + y];
            n++;
          }
        }
      }
      out[vx * H + vy] = sum / n;
    }
  }
  return out;
}

// World height of a corner.
export function cornerY(corners, h, vx, vy) {
  return corners[vx * (h + 1) + vy] * STEP;
}

// Height at the centre of tile (x, y): the mean of its four corners.
export function tileCentreY(corners, h, x, y) {
  return (cornerY(corners, h, x, y) + cornerY(corners, h, x + 1, y) +
    cornerY(corners, h, x, y + 1) + cornerY(corners, h, x + 1, y + 1)) / 4;
}

// Height of the terrain at world point (X, Z), bilinear on the corner heights.
export function groundY(corners, w, h, X, Z) {
  const x = clamp(X, 0, w), z = clamp(Z, 0, h);
  const x0 = Math.min(Math.floor(x), w - 1), z0 = Math.min(Math.floor(z), h - 1);
  const fx = x - x0, fz = z - z0;
  const a = cornerY(corners, h, x0, z0) * (1 - fx) + cornerY(corners, h, x0 + 1, z0) * fx;
  const b = cornerY(corners, h, x0, z0 + 1) * (1 - fx) + cornerY(corners, h, x0 + 1, z0 + 1) * fx;
  return a * (1 - fz) + b * fz;
}

// Unit normal of the terrain at corner (vx, vy), from central differences of the corner heights.
export function cornerNormal(corners, w, h, vx, vy) {
  const H = h + 1;
  const xa = Math.max(vx - 1, 0), xb = Math.min(vx + 1, w);
  const za = Math.max(vy - 1, 0), zb = Math.min(vy + 1, h);
  const dydx = (corners[xb * H + vy] - corners[xa * H + vy]) * STEP / (xb - xa);
  const dydz = (corners[vx * H + zb] - corners[vx * H + za]) * STEP / (zb - za);
  const len = Math.hypot(dydx, 1, dydz);
  return [-dydx / len, 1 / len, -dydz / len];
}

// --- chunks and slots ---------------------------------------------------------------------------

export function chunkGrid(w, h) {
  const cw = Math.ceil(w / CHUNK), ch = Math.ceil(h / CHUNK);
  return { w, h, cw, ch, count: cw * ch };
}

export function chunkOf(x, y, grid) {
  return Math.floor(y / CHUNK) * grid.cw + Math.floor(x / CHUNK);
}

// Instance slot of tile (x, y). Chunk-major: the 256 slots of a chunk are contiguous, so a chunk
// is rewritten with one range. Slots of the padding past the map edge are never filled.
export function slotOf(x, y, grid) {
  return chunkOf(x, y, grid) * SLOTS + (x % CHUNK) * CHUNK + (y % CHUNK);
}

// Tile of a slot, or null for a padding slot.
export function tileOfSlot(slot, grid) {
  const chunk = Math.floor(slot / SLOTS), local = slot % SLOTS;
  const x = (chunk % grid.cw) * CHUNK + Math.floor(local / CHUNK);
  const y = Math.floor(chunk / grid.cw) * CHUNK + (local % CHUNK);
  return x < grid.w && y < grid.h ? { x, y } : null;
}

// Tile bounds of a chunk, end exclusive.
export function chunkBounds(grid, chunk) {
  const x0 = (chunk % grid.cw) * CHUNK, y0 = Math.floor(chunk / grid.cw) * CHUNK;
  return { x0, y0, x1: Math.min(x0 + CHUNK, grid.w), y1: Math.min(y0 + CHUNK, grid.h) };
}

// Chunks to rebuild between two snapshots { w, h, tiles, alt }. No previous snapshot, or another
// size: every chunk. A tile whose character, status bits or altitude changed dirties its own chunk
// and the chunks of its eight neighbours, since corner heights and normals depend on them.
export function dirtyChunks(prev, next, grid) {
  const all = () => Array.from({ length: grid.count }, (_, i) => i);
  if (!prev || prev.w !== next.w || prev.h !== next.h) return all();
  const { w, h } = next;
  const dirty = new Uint8Array(grid.count);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = x * h + y;
      if (prev.tiles[i] === next.tiles[i] && prev.alt[i] === next.alt[i]) continue;
      for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
        for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) {
          dirty[chunkOf(nx, ny, grid)] = 1;
        }
      }
    }
  }
  const out = [];
  for (let c = 0; c < grid.count; c++) if (dirty[c]) out.push(c);
  return out;
}

// --- classification -----------------------------------------------------------------------------

// Height (tiles) of a zone volume by its density (the piece's level in tiles.js).
function volumeHeight(piece) {
  const d = piece.density;
  switch (piece.family) {
    case "house": return 0.5 + 0.1 * d;
    case "res": return 0.9 + 0.5 * d;
    case "com": return 1.0 + 0.5 * d;
    case "ind": return 1.0 + 0.4 * d;
    case "hospital": return 1.2;
    case "church": return 1.0;
    default: return 0;
  }
}

// What a tile is drawn as:
//   kind   water | road | rail | wire | tree | building | land
//   zone   residential | commercial | industrial | null (zone tiles, empty or built)
//   height volume height in tiles (building, tree), else 0
//   ground dirt (bare earth colour under roads, power lines, buildings, shores) | palette
export function classify(tile) {
  const cls = artClass(tile);
  if (cls === "water") return { kind: "water", zone: null, height: 0, ground: "palette" };
  if (roadMask(tile)) return { kind: "road", zone: null, height: 0, ground: "dirt" };
  if (railMask(tile)) return { kind: "rail", zone: null, height: 0, ground: "dirt" };
  if (wireMask(tile)) return { kind: "wire", zone: null, height: 0, ground: "dirt" };
  if (cls === "tree") return { kind: "tree", zone: null, height: TREE_HEIGHT, ground: "palette" };
  const piece = zonePiece(tile);
  const zone = piece ? (ZONE_OF[piece.family] ?? null) : null;
  if (zone && !piece.family.endsWith("-empty")) {
    return { kind: "building", zone, height: volumeHeight(piece), ground: "dirt" };
  }
  return { kind: "land", zone, height: 0, ground: cls === "shore" ? "dirt" : "palette" };
}

// Connection mask (N E S W bits) of a road, rail or wire tile, or 0.
export function stripMask(tile, kind) {
  if (kind === "road") return roadMask(tile);
  if (kind === "rail") return railMask(tile);
  if (kind === "wire") return wireMask(tile);
  return 0;
}

// Colour as [r, g, b] in 0..1 from a hex colour.
export function rgbOf(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// Colour of the ground of a tile, [r, g, b]. Bare earth is the palette's "Terrain nu".
export function groundRgb(tile, c) {
  const entry = c.ground === "dirt" ? tileEntry(0) : tileEntry(tile);
  return rgbOf(entry ? entry.color : MISSING_RGB);
}

// Colour of a tile's own shape (road, rail, power line, volume), [r, g, b].
export function shapeRgb(tile) {
  const entry = tileEntry(tile);
  return rgbOf(entry ? entry.color : MISSING_RGB);
}

// --- geometry of a chunk ------------------------------------------------------------------------

// Builds the terrain, strips, power lines and volumes of one chunk.
// Returns { positions, normals, colours, indices } (typed arrays of the chunk's mesh) and
// `volumes`: [{ slot, kind, x, y, base, sx, sy, sz, rgb }] for the instanced meshes, where `kind`
// is a zone kind or "tree" and `slot` is the global instance slot. `tops` (Float32Array, one per
// tile, index x * h + y) receives the top of each tile's column (ground, or its volume): the
// picking walks down onto these.
export function buildChunk({ grid, chunk, tiles, alt, corners, tops }) {
  const { w, h } = grid;
  const b = chunkBounds(grid, chunk);
  const pos = [], nor = [], col = [], idx = [];
  const volumes = [];

  const vertex = (X, Y, Z, n, rgb) => {
    pos.push(X, Y, Z);
    nor.push(n[0], n[1], n[2]);
    col.push(rgb[0], rgb[1], rgb[2]);
    return pos.length / 3 - 1;
  };
  const quad = (a, b2, c2, d) => idx.push(a, b2, c2, a, c2, d);

  for (let x = b.x0; x < b.x1; x++) {
    for (let y = b.y0; y < b.y1; y++) {
      const i = x * h + y;
      const tile = tiles[i];
      const c = classify(tile);
      const ground = groundRgb(tile, c);

      // terrain: one quad per tile, 4 own vertices (flat colour per tile, smooth normals)
      const gA = cornerY(corners, h, x, y), gB = cornerY(corners, h, x + 1, y);
      const gC = cornerY(corners, h, x + 1, y + 1), gD = cornerY(corners, h, x, y + 1);
      const A = vertex(x, gA, y, cornerNormal(corners, w, h, x, y), ground);
      const B = vertex(x + 1, gB, y, cornerNormal(corners, w, h, x + 1, y), ground);
      const C = vertex(x + 1, gC, y + 1, cornerNormal(corners, w, h, x + 1, y + 1), ground);
      const D = vertex(x, gD, y + 1, cornerNormal(corners, w, h, x, y + 1), ground);
      // counter-clockwise seen from above: A, D, C and A, C, B
      idx.push(A, D, C, A, C, B);

      const cy = tileCentreY(corners, h, x, y);
      tops[i] = cy + (c.kind === "building" || c.kind === "tree" ? c.height : 0);
      const slot = slotOf(x, y, grid);
      if (c.kind === "building") {
        volumes.push({ slot, kind: c.zone, x, y, base: cy, sx: BUILD_WIDTH, sy: c.height, sz: BUILD_WIDTH, rgb: shapeRgb(tile) });
      } else if (c.kind === "tree") {
        volumes.push({ slot, kind: "tree", x, y, base: cy, sx: 1, sy: 1, sz: 1, rgb: shapeRgb(tile) });
      }

      if (c.kind === "road" || c.kind === "rail") {
        const mask = stripMask(tile, c.kind);
        const half = c.kind === "road" ? ROAD_HALF : RAIL_HALF;
        const rgb = shapeRgb(tile);
        const up = [0, 1, 0];
        // a bridge deck stays above the water plane
        const bridge = artClass(tile) === "bridge";
        const deck = (X, Z) => {
          const g = groundY(corners, w, h, X, Z);
          return bridge ? Math.max(g, WATER_Y) + 0.12 : g + STRIP_LIFT;
        };
        const cx = x + 0.5, cz = y + 0.5;
        for (const [bit, dx, dz] of [[N, 0, -1], [E, 1, 0], [S, 0, 1], [W, -1, 0]]) {
          if (!(mask & bit)) continue;
          const ex = cx + dx * 0.5, ez = cz + dz * 0.5;
          const px = -dz * half, pz = dx * half;
          const p0 = [cx - px, cz - pz], p1 = [cx + px, cz + pz];
          const p2 = [ex + px, ez + pz], p3 = [ex - px, ez - pz];
          const v = [p0, p1, p2, p3].map(([X, Z]) => vertex(X, deck(X, Z), Z, up, rgb));
          quad(v[0], v[1], v[2], v[3]);
        }
      }

      if (c.kind === "wire") {
        const mask = stripMask(tile, "wire");
        const rgb = shapeRgb(tile);
        const cx = x + 0.5, cz = y + 0.5;
        const yb = groundY(corners, w, h, cx, cz) + WIRE_HEIGHT;
        const t = WIRE_HALF;
        if (mask & E) pushBox(cx, cx + 0.5, yb - t, yb + t, cz - t, cz + t, rgb);
        if (mask & W) pushBox(cx - 0.5, cx, yb - t, yb + t, cz - t, cz + t, rgb);
        if (mask & S) pushBox(cx - t, cx + t, yb - t, yb + t, cz, cz + 0.5, rgb);
        if (mask & N) pushBox(cx - t, cx + t, yb - t, yb + t, cz - 0.5, cz, rgb);
      }
    }
  }

  // An axis-aligned box, each face with its outward normal and counter-clockwise order.
  function pushBox(x0, x1, y0, y1, z0, z1, rgb) {
    const faces = [
      [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]],
      [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]],
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]],
      [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
    ];
    for (const f of faces) {
      const v = f.slice(0, 4).map((p) => vertex(p[0], p[1], p[2], f[4], rgb));
      quad(v[0], v[1], v[2], v[3]);
    }
  }

  return {
    geometry: {
      positions: Float32Array.from(pos),
      normals: Float32Array.from(nor),
      colours: Float32Array.from(col),
      indices: Uint32Array.from(idx),
    },
    volumes,
  };
}

// Instance matrix (column-major 4 x 4) of a volume at (x + 0.5, base, y + 0.5), scaled by (sx, sy, sz).
// Written at `out[offset..offset + 16)`.
export function writeVolumeMatrix(out, offset, v) {
  out.fill(0, offset, offset + 16);
  out[offset] = v.sx;
  out[offset + 5] = v.sy;
  out[offset + 10] = v.sz;
  out[offset + 12] = v.x + 0.5;
  out[offset + 13] = v.base;
  out[offset + 14] = v.y + 0.5;
  out[offset + 15] = 1;
  return out;
}

// Top of a footprint [x0, y0, w, h] clipped to the map, with its tile bounds: the outline sits on it.
export function footprintTop(tops, grid, fp) {
  const [fx, fy, fw, fh] = fp;
  const x0 = clamp(fx, 0, grid.w), y0 = clamp(fy, 0, grid.h);
  const x1 = clamp(fx + fw, 0, grid.w), y1 = clamp(fy + fh, 0, grid.h);
  let top = -Infinity;
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) top = Math.max(top, tops[x * grid.h + y]);
  return { x0, y0, x1, y1, top: Number.isFinite(top) ? top : 0 };
}

// --- picking ------------------------------------------------------------------------------------

// The tile under a ray: the ray (origin and direction, [x, y, z] in world units) walks forward
// and stops at the first point below the top of the column it is over (the ground, or a volume
// standing on it). `maxTop` bounds every column top. Returns { x, y } or null.
export function pickTile(origin, dir, grid, tops, maxTop, step = PICK_STEP) {
  const { w, h } = grid;
  const lo = [0, 0, 0], hi = [w, maxTop, h];
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const o = origin[k], d = dir[k];
    if (Math.abs(d) < 1e-12) {
      if (o < lo[k] || o > hi[k]) return null;
      continue;
    }
    let a = (lo[k] - o) / d, b = (hi[k] - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  const at = (t) => [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  const tileAt = (X, Z) => ({
    x: clamp(Math.floor(X), 0, w - 1),
    y: clamp(Math.floor(Z), 0, h - 1),
  });
  const below = (p) => {
    const t = tileAt(p[0], p[2]);
    return p[1] <= tops[t.x * h + t.y];
  };
  let prev = t0;
  for (let t = t0; ; t += step) {
    const tt = Math.min(t, t1);
    if (below(at(tt))) {
      let a = prev, b = tt;
      for (let k = 0; k < 10; k++) {
        const mid = (a + b) / 2;
        if (below(at(mid))) b = mid;
        else a = mid;
      }
      const p = at(b);
      return tileAt(p[0], p[2]);
    }
    prev = tt;
    if (tt >= t1) return null;
  }
}
