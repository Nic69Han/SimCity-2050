// Tile art (presentation only, ARCHITECTURE.md rule 5). Each tile character is drawn procedurally
// into an offscreen atlas canvas; the renderer copies the cells. Nothing here decides game rules:
// the tile number says what a tile is (tile_chars.rs), the status bits say whether a zone has
// power (tile.rs). Road, rail and wire shapes come from the engine's own tables (connect.rs),
// shore shapes from the sample cities (the engine never makes them), zone layouts from zone.rs
// and tool.rs (3x3 blocks numbered row by row).
//
// Everything above createAtlas() is pure and importable without a DOM (node:test).
import { TILE_PX } from "./tools.js";

export const TILE_LIMIT = 1024;
const LOMASK = 0x03ff; // character bits (tile.rs LOMASK)
const ZONEBIT = 0x0400; // centre tile of a zone (tile.rs)
const PWRBIT = 0x8000; // tile has power (tile.rs)

// Shimmer: animated classes (water, fire, radiation) have SHIMMER_PHASES looks, changed every
// SHIMMER_MS. Driven by the clock of the frame that draws them, never by engine ticks.
export const SHIMMER_PHASES = 4;
export const SHIMMER_MS = 250;
// The atlas is a grid of ATLAS_COLS x ATLAS_COLS cells (every base character plus the variants).
const ATLAS_COLS = 64;

// Connection masks of the road, rail and wire shapes: N = 1, E = 2, S = 4, W = 8 (connect.rs).
// The shapes of the 11 tiles starting at ROADS (66), RAILS (226) and WIRES (210) follow this order.
const SEQ = [10, 5, 3, 6, 12, 9, 11, 7, 14, 13, 15];
export const N = 1, E = 2, S = 4, W = 8;

// Mask of a road-like tile (roads, road on power, road on rail, traffic), or 0 when none.
export function roadMask(c) {
  c &= LOMASK;
  if (c === 64) return E | W; // horizontal bridge
  if (c === 65) return N | S; // vertical bridge
  if (c >= 66 && c <= 76) return SEQ[c - 66];
  if (c === 77) return E | W; // road on power, horizontal
  if (c === 78) return N | S;
  if (c === 237) return E | W; // road on rail, horizontal
  if (c === 238) return N | S;
  if (c === 239) return N | S;
  if (c >= 80 && c <= 94) return trafficMask(c, 80);
  if (c >= 144 && c <= 158) return trafficMask(c, 144);
  return 0;
}

// Traffic tiles: LTRF 80+k and HTRF 144+k show the road shape SEQ[k-2] (k = 2 horizontal, 3
// vertical, 4 .. 12 the other shapes, 13 and 14 repeat horizontal and vertical).
function trafficMask(c, base) {
  const k = c - base;
  if (k === 0) return E | W;
  if (k === 1) return N | S;
  return SEQ[(k - 2) % 11];
}

// Mask of a rail tile (224..238), or 0.
export function railMask(c) {
  c &= LOMASK;
  if (c === 224 || c === 226) return E | W;
  if (c === 225 || c === 227) return N | S;
  if (c >= 226 && c <= 236) return SEQ[c - 226];
  if (c === 237) return E | W;
  if (c === 238) return N | S;
  return 0;
}

// Mask of a wire tile (208..222), or 0. 221 and 222 are rail and wire crossings.
export function wireMask(c) {
  c &= LOMASK;
  if (c === 208 || c === 210) return E | W;
  if (c === 209 || c === 211) return N | S;
  if (c >= 210 && c <= 220) return SEQ[c - 210];
  if (c === 221) return E | W;
  if (c === 222) return N | S;
  if (c === 77 || c === 78) return c === 77 ? E | W : N | S;
  if (c === 239) return E | W;
  return 0;
}

// Bridge tiles over water (road or rail decks; 79, 95 and the BRWXXX tiles are road bridges).
const BRIDGE_TILES = new Set([64, 65, 79, 95, 111, 127, 143, 159, 175, 191, 207, 828, 829, 830, 831, 948, 949, 950, 951]);
// Bridges whose deck runs east-west.
const HORIZONTAL_BRIDGES = new Set([64, 79, 111, 143, 175, 207, 828, 829, 830, 831]);

// What a tile character is drawn as. The classes are the drawing families of this module.
export function artClass(c) {
  c &= LOMASK;
  if (c === 0 || c === 223 || (c >= 884 && c <= 915)) return "dirt";
  if (c >= 2 && c <= 4) return "water";
  if (c >= 5 && c <= 20) return "shore";
  if (c >= 21 && c <= 36) return "tree";
  if (c >= 37 && c <= 43) return "woods";
  if (c >= 44 && c <= 47) return "rubble";
  if (c >= 48 && c <= 51) return "flood";
  if (c >= 52 && c <= 55) return "radiation";
  if (c >= 56 && c <= 63) return "fire";
  if (c === 64 || c === 65) return "bridge";
  if (c >= 66 && c <= 76) return "road";
  if (c === 77 || c === 78 || c === 239) return "road-wire";
  if (BRIDGE_TILES.has(c)) return "bridge";
  if ((c >= 80 && c <= 94) || (c >= 144 && c <= 158)) return "traffic";
  if (c >= 208 && c <= 220) return "wire";
  if (c === 221 || c === 222) return "rail-wire";
  if (c >= 224 && c <= 236) return "rail";
  if (c === 237 || c === 238) return "rail-road";
  if (zonePiece(c)) return "zone";
  if (c === 827) return "lightning";
  if (c >= 828 && c <= 831) return "bridge";
  if (c >= 832 && c <= 839) return "radar";
  if (c >= 840 && c <= 843) return "fountain";
  if (c >= 844 && c <= 851) return "tele";
  if (c >= 852 && c <= 859) return "smoke";
  if (c >= 860 && c <= 883) return "explosion";
  if (c >= 916 && c <= 931) return "smoke";
  if (c >= 932 && c <= 947) return "football";
  if (c >= 948 && c <= 951) return "bridge";
  if (c >= 952 && c <= 955) return "nuke-swirl";
  return "dirt";
}

// Animated classes: their look changes with the shimmer phase.
export function shimmers(c) {
  const cls = artClass(c);
  return cls === "water" || cls === "shore" || cls === "fire" || cls === "radiation";
}

// Zone pieces: a building is a block of size n x n whose tiles are numbered row by row from its
// base. zonePiece(c) gives the block, the piece's position in it and its density level (0..),
// or null for a tile that is not part of a 3x3, 4x4 or 6x6 block.
export function zonePiece(c) {
  c &= LOMASK;
  const block = (family, n, base, density = 0, index = 0) => {
    const z = c - base - index * 9;
    if (z < 0) return null;
    return { family, n, block: index, density, z, zx: z % n, zy: Math.floor(z / n) };
  };
  if (c >= 240 && c <= 248) return block("res-empty", 3, 240);
  if (c >= 249 && c <= 260) return { family: "house", n: 1, block: 0, density: c - 249, z: 0, zx: 0, zy: 0 };
  if (c >= 261 && c <= 404) {
    const k = Math.floor((c - 261) / 9);
    return block("res", 3, 261, k % 4, k);
  }
  if (c >= 405 && c <= 413) return block("hospital", 3, 405);
  if (c >= 414 && c <= 422) return block("church", 3, 414);
  if (c >= 423 && c <= 431) return block("com-empty", 3, 423);
  if (c >= 432 && c <= 609) {
    const k = Math.floor((c - 432) / 9);
    return block("com", 3, 432, k % 5, k);
  }
  if (c >= 612 && c <= 620) return block("ind-empty", 3, 612);
  if (c >= 621 && c <= 692) {
    const k = Math.floor((c - 621) / 9);
    return block("ind", 3, 621, k % 4, k);
  }
  if (c >= 693 && c <= 708) return block("port", 4, 693);
  if (c >= 709 && c <= 744) return block("airport", 6, 709);
  if (c >= 745 && c <= 760) return block("coal", 4, 745);
  if (c >= 761 && c <= 769) return block("fire-station", 3, 761);
  if (c >= 770 && c <= 778) return block("police", 3, 770);
  if (c >= 779 && c <= 794) return block("stadium", 4, 779);
  if (c >= 795 && c <= 810) return block("stadium-full", 4, 795);
  if (c >= 811 && c <= 826) return block("nuclear", 4, 811);
  if (c >= 956 && c <= 1018) {
    const i = Math.floor((c - 956) / 9);
    return block("church", 3, 956, 0, i);
  }
  return null;
}

// True for a zone centre (the middle piece of a 3x3 block, ZONEBIT set) with no power: the
// page draws a lightning icon there.
export function unpoweredCentre(tile) {
  return (tile & ZONEBIT) !== 0 && (tile & PWRBIT) === 0;
}

// Shimmer phase at time `now` (milliseconds, from the clock of the drawing frame).
export function shimmerPhase(now) {
  return Math.floor(now / SHIMMER_MS) % SHIMMER_PHASES;
}

// A small position hash, for the classes with a variant (plain dirt and woods): the same tile
// always gets the same variant, so the map does not change between frames.
export function variantOf(x, y) {
  let h = Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 7, 0x85ebca77);
  h ^= h >>> 15;
  return (h >>> 0) & 3;
}

// The atlas key of one tile: everything that changes its picture. Bits: character (10), power
// icon (1), shimmer phase (2), variant (2). Two tiles with the same key have the same pixels.
export function artKey(tile, x, y, phase) {
  const c = tile & LOMASK;
  const flags = VARIANT_FLAGS[c];
  let key = c;
  if ((tile & ZONEBIT) !== 0 && (tile & PWRBIT) === 0) key |= 1 << 10; // unpowered zone centre
  if (flags & 1) key |= (phase & 3) << 11; // shimmer
  if (flags & 2) key |= variantOf(x, y) << 13; // variant
  return key;
}

// Per character: bit 0 shimmers, bit 1 has a variant (plain dirt and woods). Built once.
const VARIANT_FLAGS = (() => {
  const flags = new Uint8Array(TILE_LIMIT);
  for (let c = 0; c < TILE_LIMIT; c++) {
    if (shimmers(c)) flags[c] |= 1;
    const cls = artClass(c);
    if (cls === "dirt" || cls === "woods") flags[c] |= 2;
  }
  return flags;
})();

// Decodes a key made by artKey().
export function decodeKey(key) {
  return {
    c: key & LOMASK,
    powerIcon: (key >> 10) & 1,
    phase: (key >> 11) & 3,
    variant: (key >> 13) & 3,
  };
}

// --- Colours (art only) ---------------------------------------------------------------------

const C = Object.freeze({
  dirt: "#b09a68",
  dirtDark: "#8f7c52",
  grass: "#6fa650",
  grassDark: "#4f8a3c",
  water: "#2d6ab3",
  waterLight: "#6b9fdc",
  sand: "#dcc48e",
  asphalt: "#4b4f55",
  asphaltEdge: "#3a3d42",
  mark: "#f2f2ee",
  ballast: "#8c7e66",
  sleeper: "#6e4f32",
  steel: "#c9ced6",
  pole: "#5a4a3a",
  wire: "#2a2a2a",
  tree: "#2e6b2e",
  treeDark: "#1f4d22",
  treeLight: "#4f9a3a",
  burnt: "#3b3026",
  flame: "#ff7a1a",
  flameHot: "#ffd23a",
  rubble: "#7d7068",
  rubbleLight: "#a39a92",
  floodMud: "#7a6a4a",
  floodWater: "#5c8fb8",
  rad: "#b6d53a",
  radDark: "#4d5a18",
  lot: { res: "#9cc77a", com: "#9fbfe0", ind: "#c9b771", empty: "#88aa64" },
  wallRes: "#f0e0bc",
  wallRes2: "#e2c9a0",
  roofRed: "#b4533c",
  roofBrown: "#7a4b35",
  window: "#34495e",
  windowLit: "#f6e7a6",
  glassBlue: "#4f8ac7",
  glassDark: "#2f5b8f",
  concrete: "#a9a9a6",
  steelGrey: "#8c8f96",
  factory: "#7d5a4a",
  smoke: "#8c8c8c",
  smokeDark: "#4a4a4a",
  hospital: "#f5f5f5",
  cross: "#d62828",
  church: "#f4f0e6",
  fireRed: "#b32d2d",
  policeBlue: "#2c4a8a",
  badge: "#f5c518",
  stadiumGrass: "#4f9a3a",
  stands: "#8a8f98",
  coal: "#55504b",
  nuclear: "#eeeeea",
  nuclearTop: "#f2c230",
  port: "#2c6f9e",
  crane: "#e07b2a",
  runway: "#50545a",
  terminal: "#d9d9d9",
  white: "#ffffff",
  black: "#101010",
  lightning: "#ffd700",
  fountain: "#7fd0ff",
});

// --- Pure geometry shared by the drawers (unit coordinates: 1 = one tile) -----------------

// Deterministic 0..1 numbers from a seed (an LCG): block variations never change between frames.
function rng(seed) {
  let s = (seed * 2654435761 + 12345) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Arms of a road or rail shape: the bars from the centre to every connected edge.
function arms(ctx, mask, half, color) {
  ctx.fillStyle = color;
  if (mask & N) ctx.fillRect(0.5 - half, 0, 2 * half, 0.5);
  if (mask & S) ctx.fillRect(0.5 - half, 0.5, 2 * half, 0.5);
  if (mask & E) ctx.fillRect(0.5, 0.5 - half, 0.5, 2 * half);
  if (mask & W) ctx.fillRect(0, 0.5 - half, 0.5, 2 * half);
  if (mask) ctx.fillRect(0.5 - half, 0.5 - half, 2 * half, 2 * half);
}

// Dashed lane marks along each arm of a road (not across a junction).
function laneMarks(ctx, mask) {
  ctx.save();
  ctx.strokeStyle = C.mark;
  ctx.lineWidth = 0.035;
  ctx.setLineDash([0.07, 0.07]);
  ctx.beginPath();
  if (mask & N) { ctx.moveTo(0.5, 0.5); ctx.lineTo(0.5, 0); }
  if (mask & S) { ctx.moveTo(0.5, 0.5); ctx.lineTo(0.5, 1); }
  if (mask & E) { ctx.moveTo(0.5, 0.5); ctx.lineTo(1, 0.5); }
  if (mask & W) { ctx.moveTo(0.5, 0.5); ctx.lineTo(0, 0.5); }
  ctx.stroke();
  ctx.restore();
}

// Sleepers and two steel rails along each arm of a railway.
function railArms(ctx, mask) {
  arms(ctx, mask, 0.2, C.ballast);
  ctx.save();
  ctx.fillStyle = C.sleeper;
  for (let t = 0.08; t < 0.5; t += 0.14) {
    if (mask & N) ctx.fillRect(0.5 - 0.22, t, 0.44, 0.05);
    if (mask & S) ctx.fillRect(0.5 - 0.22, 1 - t - 0.05, 0.44, 0.05);
    if (mask & E) ctx.fillRect(1 - t - 0.05, 0.5 - 0.22, 0.05, 0.44);
    if (mask & W) ctx.fillRect(t, 0.5 - 0.22, 0.05, 0.44);
  }
  ctx.strokeStyle = C.steel;
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  for (const d of [-0.1, 0.1]) {
    if (mask & N) { ctx.moveTo(0.5 + d, 0.5); ctx.lineTo(0.5 + d, 0); }
    if (mask & S) { ctx.moveTo(0.5 + d, 0.5); ctx.lineTo(0.5 + d, 1); }
    if (mask & E) { ctx.moveTo(0.5, 0.5 + d); ctx.lineTo(1, 0.5 + d); }
    if (mask & W) { ctx.moveTo(0.5, 0.5 + d); ctx.lineTo(0, 0.5 + d); }
  }
  ctx.stroke();
  ctx.restore();
}

// Overhead wires along each arm: two thin lines and a pole at the centre.
function wireArms(ctx, mask) {
  ctx.save();
  ctx.strokeStyle = C.wire;
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  for (const d of [-0.12, 0.12]) {
    if (mask & N) { ctx.moveTo(0.5 + d, 0.5); ctx.lineTo(0.5 + d, 0); }
    if (mask & S) { ctx.moveTo(0.5 + d, 0.5); ctx.lineTo(0.5 + d, 1); }
    if (mask & E) { ctx.moveTo(0.5, 0.5 + d); ctx.lineTo(1, 0.5 + d); }
    if (mask & W) { ctx.moveTo(0.5, 0.5 + d); ctx.lineTo(0, 0.5 + d); }
  }
  ctx.stroke();
  ctx.fillStyle = C.pole;
  ctx.fillRect(0.44, 0.44, 0.12, 0.12);
  ctx.restore();
}

// A small car on each lane of a busy road: `count` cars, coloured by position.
function cars(ctx, mask, count, seed) {
  const r = rng(seed);
  const colours = ["#d9534f", "#f0f0f0", "#4f7fd9", "#f0c040", "#333333"];
  const across = mask & (E | W) && mask & (N | S) ? null : mask & (E | W) ? "h" : "v";
  for (let i = 0; i < count; i++) {
    const side = r() < 0.5 ? -0.12 : 0.12;
    const t = 0.15 + r() * 0.7;
    const horizontal = across ?? (r() < 0.5 ? "h" : "v");
    ctx.fillStyle = colours[Math.floor(r() * colours.length)];
    if (horizontal === "h") ctx.fillRect(t - 0.07, 0.5 + side - 0.035, 0.14, 0.07);
    else ctx.fillRect(0.5 + side - 0.035, t - 0.07, 0.07, 0.14);
  }
}

function fill(ctx, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
}

// Water with its shore: sand on the land sides listed in `landSides`, and an animated wave line.
function waterTile(ctx, landSides, phase, deep = true) {
  fill(ctx, deep ? C.water : C.waterLight);
  if (landSides) {
    ctx.fillStyle = C.sand;
    const band = 0.26;
    if (landSides & N) ctx.fillRect(0, 0, 1, band);
    if (landSides & S) ctx.fillRect(0, 1 - band, 1, band);
    if (landSides & W) ctx.fillRect(0, 0, band, 1);
    if (landSides & E) ctx.fillRect(1 - band, 0, band, 1);
  }
  // shimmer: the wave line moves a quarter of a tile per phase
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    const y = ((0.2 + i * 0.5 + phase * 0.12) % 1) * 0.9 + 0.05;
    ctx.moveTo(0.15 + (phase % 2) * 0.1, y);
    ctx.quadraticCurveTo(0.35, y - 0.06, 0.55, y);
    ctx.quadraticCurveTo(0.75, y + 0.06, 0.9, y);
  }
  ctx.stroke();
}

// The shore table: tiles 5..20 come in pairs, one pair per set of land sides. Found in the
// sample cities: 5/6 land N, 7/8 N+E, 9/10 E, 11/12 E+S, 13/14 S, 15/16 S+W, 17/18 W, 19/20 W+N.
export function shoreLandSides(c) {
  const pairs = [N, N | E, E, E | S, S, S | W, W, W | N];
  return pairs[Math.floor((c - 5) / 2)];
}

// --- Tree and woods drawers --------------------------------------------------------------------

function trees(ctx, count, seed, spread = 0.36) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = 0.5 + (r() - 0.5) * 2 * spread;
    const y = 0.5 + (r() - 0.5) * 2 * spread;
    const s = 0.17 + r() * 0.08;
    ctx.fillStyle = C.treeDark;
    ctx.beginPath();
    ctx.arc(x + 0.02, y + 0.03, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = r() < 0.5 ? C.tree : C.treeLight;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Single-tile drawers -----------------------------------------------------------------------

function bolt(ctx, cx, cy, size) {
  ctx.fillStyle = C.lightning;
  ctx.strokeStyle = C.black;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(cx + 0.2 * size, cy - 0.5 * size);
  ctx.lineTo(cx - 0.25 * size, cy + 0.05 * size);
  ctx.lineTo(cx, cy + 0.05 * size);
  ctx.lineTo(cx - 0.2 * size, cy + 0.5 * size);
  ctx.lineTo(cx + 0.28 * size, cy - 0.1 * size);
  ctx.lineTo(cx + 0.02 * size, cy - 0.1 * size);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// A house of the low-density zone: walls and a pitched roof, in a box of w x h at (x, y).
function house(ctx, x, y, w, h, wall, roof) {
  ctx.fillStyle = wall;
  ctx.fillRect(x, y + h * 0.42, w, h * 0.58);
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.06, y + h * 0.44);
  ctx.lineTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 1.06, y + h * 0.44);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.window;
  ctx.fillRect(x + w * 0.42, y + h * 0.7, w * 0.16, h * 0.3);
}

// Windows of a facade: `cols` x `rows` small rectangles inside (x, y, w, h).
function windows(ctx, x, y, w, h, cols, rows, colour = C.window) {
  ctx.fillStyle = colour;
  const cw = w / cols;
  const rh = h / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      ctx.fillRect(x + i * cw + cw * 0.22, y + j * rh + rh * 0.25, cw * 0.56, rh * 0.5);
    }
  }
}

// --- Zone pictures: drawn over the footprint of a block (units: 1 = one tile) -----------------

// Each building picture is drawn in the coordinates of its footprint (n x n tiles) and then
// cut into the cells of its tiles, so a building has no seam between its tiles.
function drawBlock(ctx, piece, seed) {
  const { family, n, density } = piece;
  const r = rng(seed);
  const f = (x, y, w, h) => ctx.fillRect(x * n, y * n, w * n, h * n); // fractions of the footprint
  const lot = (color) => { ctx.fillStyle = color; ctx.fillRect(0, 0, n, n); };
  switch (family) {
    case "res-empty":
      lot(C.lot.empty);
      ctx.strokeStyle = "#e8e0c8";
      ctx.lineWidth = 0.05;
      ctx.strokeRect(0.12, 0.12, n - 0.24, n - 0.24);
      return;
    case "res": {
      lot(C.lot.res);
      const roof = r() < 0.5 ? C.roofRed : C.roofBrown;
      if (density === 0) {
        for (const [x, y] of [[0.2, 0.2], [1.6, 0.2], [0.2, 1.6], [1.6, 1.6]]) {
          house(ctx, x, y, 1.1, 0.9, r() < 0.5 ? C.wallRes : C.wallRes2, roof);
        }
      } else if (density === 1) {
        for (const y of [0.25, 1.65]) {
          f(0.1, y * 0.6 + 0.05, 0.8, 0.5);
          ctx.fillStyle = C.wallRes;
          f(0.1, y * 0.6 + 0.05, 0.8, 0.5);
          ctx.fillStyle = roof;
          f(0.08, y * 0.6 + 0.02, 0.84, 0.08);
          windows(ctx, 0.1 * n, (y * 0.6 + 0.1) * n, 0.8 * n, 0.4 * n, 4, 2);
        }
      } else if (density === 2) {
        ctx.fillStyle = C.wallRes2;
        f(0.14, 0.08, 0.72, 0.84);
        windows(ctx, 0.14 * n, 0.08 * n, 0.72 * n, 0.84 * n, 3, 5);
      } else {
        ctx.fillStyle = "#5b6470";
        f(0.12, 0.05, 0.36, 0.9);
        ctx.fillStyle = "#6d7785";
        f(0.52, 0.2, 0.38, 0.75);
        windows(ctx, 0.12 * n, 0.05 * n, 0.36 * n, 0.9 * n, 2, 6, C.windowLit);
        windows(ctx, 0.52 * n, 0.2 * n, 0.38 * n, 0.75 * n, 2, 5, C.windowLit);
      }
      return;
    }
    case "com-empty":
      lot(C.lot.com);
      ctx.strokeStyle = "#e6eef7";
      ctx.lineWidth = 0.05;
      ctx.strokeRect(0.12, 0.12, n - 0.24, n - 0.24);
      return;
    case "com": {
      lot(C.lot.com);
      if (density === 0) {
        ctx.fillStyle = "#e2d3b3";
        f(0.1, 0.45, 0.8, 0.45);
        ctx.fillStyle = r() < 0.5 ? "#c0392b" : "#2e86c1";
        f(0.1, 0.4, 0.8, 0.09);
        windows(ctx, 0.1 * n, 0.5 * n, 0.8 * n, 0.3 * n, 2, 1);
      } else if (density === 1) {
        ctx.fillStyle = "#d8c9a6";
        f(0.1, 0.1, 0.8, 0.8);
        windows(ctx, 0.1 * n, 0.1 * n, 0.8 * n, 0.8 * n, 3, 3, "#2f4f6f");
      } else if (density === 2) {
        ctx.fillStyle = C.glassBlue;
        f(0.15, 0.05, 0.7, 0.9);
        windows(ctx, 0.15 * n, 0.05 * n, 0.7 * n, 0.9 * n, 3, 6, "#cfe3f5");
      } else if (density === 3) {
        ctx.fillStyle = C.glassDark;
        f(0.2, 0.02, 0.6, 0.96);
        windows(ctx, 0.2 * n, 0.02 * n, 0.6 * n, 0.96 * n, 3, 9, "#a9d0f0");
      } else {
        ctx.fillStyle = "#3f6fa8";
        f(0.28, 0.0, 0.44, 1);
        ctx.fillStyle = C.steelGrey;
        f(0.46, -0.05, 0.08, 0.1);
        windows(ctx, 0.28 * n, 0, 0.44 * n, n, 2, 10, "#bfe0f7");
      }
      return;
    }
    case "ind-empty":
      lot(C.lot.ind);
      ctx.strokeStyle = "#e9dca8";
      ctx.lineWidth = 0.05;
      ctx.strokeRect(0.12, 0.12, n - 0.24, n - 0.24);
      return;
    case "ind": {
      lot(C.lot.ind);
      ctx.fillStyle = C.steelGrey;
      if (density <= 1) {
        // sawtooth-roofed shed, a chimney and its smoke
        f(0.1, 0.4, 0.8, 0.5);
        ctx.fillStyle = C.concrete;
        for (let i = 0; i < 4; i++) {
          const x0 = 0.1 + i * 0.2;
          ctx.beginPath();
          ctx.moveTo(x0 * n, 0.4 * n);
          ctx.lineTo((x0 + 0.2) * n, 0.4 * n);
          ctx.lineTo((x0 + 0.2) * n, 0.2 * n);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = C.factory;
        f(0.72, 0.05, 0.1, 0.4);
        ctx.fillStyle = C.smoke;
        ctx.beginPath();
        ctx.arc(0.77 * n, 0.12 * n, 0.09 * n, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = C.factory;
        f(0.08, 0.3, 0.84, 0.6);
        ctx.fillStyle = C.steelGrey;
        f(0.2, 0.12, 0.12, 0.2);
        f(0.5, 0.05, 0.12, 0.27);
        f(0.78, 0.2, 0.1, 0.12);
        ctx.fillStyle = C.smokeDark;
        ctx.beginPath();
        ctx.arc(0.26 * n, 0.08 * n, 0.07 * n, 0, Math.PI * 2);
        ctx.arc(0.56 * n, 0.02 * n, 0.08 * n, 0, Math.PI * 2);
        ctx.fill();
        windows(ctx, 0.1 * n, 0.4 * n, 0.8 * n, 0.4 * n, 5, 2, "#f1d98a");
      }
      return;
    }
    case "hospital":
      lot(C.lot.empty);
      ctx.fillStyle = C.hospital;
      f(0.08, 0.08, 0.84, 0.84);
      ctx.fillStyle = C.cross;
      f(0.4, 0.2, 0.2, 0.6);
      f(0.2, 0.4, 0.6, 0.2);
      windows(ctx, 0.08 * n, 0.08 * n, 0.84 * n, 0.84 * n, 4, 4, "#8fb5d6");
      return;
    case "church":
      lot(C.lot.empty);
      ctx.fillStyle = C.church;
      f(0.15, 0.4, 0.7, 0.6);
      ctx.beginPath();
      ctx.moveTo(0.4 * n, 0.4 * n);
      ctx.lineTo(0.5 * n, 0.06 * n);
      ctx.lineTo(0.6 * n, 0.4 * n);
      ctx.fill();
      ctx.fillStyle = C.roofBrown;
      f(0.48, 0.02, 0.04, 0.12);
      windows(ctx, 0.15 * n, 0.5 * n, 0.7 * n, 0.3 * n, 4, 1, "#7d8fa6");
      return;
    case "fire-station":
      lot(C.lot.com);
      ctx.fillStyle = C.fireRed;
      f(0.1, 0.25, 0.8, 0.7);
      ctx.fillStyle = "#3d2b26";
      f(0.18, 0.55, 0.26, 0.4);
      f(0.56, 0.55, 0.26, 0.4);
      ctx.fillStyle = "#e6e6e6";
      f(0.7, 0.05, 0.14, 0.22);
      return;
    case "police":
      lot(C.lot.com);
      ctx.fillStyle = C.policeBlue;
      f(0.1, 0.22, 0.8, 0.73);
      windows(ctx, 0.1 * n, 0.22 * n, 0.8 * n, 0.32 * n, 4, 1, "#c9d8f0");
      ctx.fillStyle = C.badge;
      ctx.beginPath();
      ctx.arc(0.5 * n, 0.7 * n, 0.12 * n, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "stadium":
      lot(C.lot.empty);
      ctx.fillStyle = C.stands;
      ctx.beginPath();
      ctx.ellipse(0.5 * n, 0.5 * n, 0.46 * n, 0.4 * n, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.stadiumGrass;
      ctx.beginPath();
      ctx.ellipse(0.5 * n, 0.5 * n, 0.32 * n, 0.26 * n, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "stadium-full":
      lot(C.lot.empty);
      ctx.fillStyle = C.stands;
      ctx.beginPath();
      ctx.ellipse(0.5 * n, 0.5 * n, 0.47 * n, 0.42 * n, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.stadiumGrass;
      ctx.beginPath();
      ctx.ellipse(0.5 * n, 0.5 * n, 0.33 * n, 0.27 * n, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e8d8b0";
      for (let i = 0; i < 18; i++) {
        ctx.fillRect((0.06 + r() * 0.88) * n, (0.06 + r() * 0.88) * n, 0.03 * n, 0.03 * n);
      }
      return;
    case "coal":
      lot(C.lot.ind);
      ctx.fillStyle = C.coal;
      f(0.05, 0.45, 0.9, 0.5);
      ctx.fillStyle = "#777";
      f(0.12, 0.1, 0.12, 0.45);
      f(0.4, 0.05, 0.12, 0.5);
      f(0.7, 0.15, 0.2, 0.35);
      ctx.fillStyle = C.smokeDark;
      ctx.beginPath();
      ctx.arc(0.18 * n, 0.05 * n, 0.08 * n, 0, Math.PI * 2);
      ctx.arc(0.46 * n, 0.0 * n, 0.09 * n, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "nuclear":
      lot(C.lot.ind);
      ctx.fillStyle = C.nuclear;
      ctx.beginPath();
      ctx.ellipse(0.5 * n, 0.55 * n, 0.4 * n, 0.4 * n, 0, Math.PI, 0);
      ctx.fill();
      f(0.1, 0.55, 0.8, 0.4);
      ctx.fillStyle = C.nuclearTop;
      f(0.44, 0.1, 0.12, 0.2);
      ctx.fillStyle = "#c7c7c2";
      f(0.1, 0.9, 0.8, 0.06);
      return;
    case "port":
      lot(C.water);
      ctx.fillStyle = "#c9b48a";
      f(0, 0, 1, 0.3);
      ctx.fillStyle = C.crane;
      f(0.15, 0.05, 0.06, 0.6);
      f(0.15, 0.05, 0.4, 0.06);
      ctx.fillStyle = "#c2552a";
      f(0.3, 0.6, 0.5, 0.18);
      ctx.fillStyle = "#e8e8e8";
      f(0.55, 0.45, 0.35, 0.15);
      return;
    case "airport":
      lot(C.lot.empty);
      ctx.fillStyle = C.runway;
      f(0.02, 0.4, 0.96, 0.22);
      ctx.fillStyle = C.mark;
      for (let i = 0; i < 6; i++) f(0.06 + i * 0.16, 0.5, 0.08, 0.02);
      ctx.fillStyle = C.terminal;
      f(0.1, 0.08, 0.5, 0.2);
      ctx.fillStyle = C.glassDark;
      f(0.12, 0.12, 0.46, 0.06);
      ctx.fillStyle = "#c9c9c9";
      f(0.7, 0.05, 0.12, 0.3);
      return;
    default:
      lot(C.grass);
  }
}

// One tile of a zone block: the piece of the block's picture (footprint coordinates) for this cell.
function drawPiece(ctx, piece, seed) {
  ctx.save();
  // the block is drawn in footprint coordinates; this cell shows its own tile of it
  ctx.translate(-piece.zx, -piece.zy);
  ctx.beginPath();
  ctx.rect(piece.zx, piece.zy, 1, 1);
  ctx.clip();
  drawBlock(ctx, piece, seed);
  ctx.restore();
}

// Single-tile pictures.
function drawSingle(ctx, c, cls, variant, phase) {
  switch (cls) {
    case "dirt": {
      fill(ctx, C.dirt);
      const r = rng(900 + variant * 37 + c);
      ctx.fillStyle = C.dirtDark;
      for (let i = 0; i < 6; i++) ctx.fillRect(r(), r(), 0.06, 0.06);
      return;
    }
    case "water":
      waterTile(ctx, 0, phase, c !== 3);
      return;
    case "shore":
      waterTile(ctx, shoreLandSides(c), phase, true);
      // the sand edge is drawn over the water, so the land side is clearly land
      return;
    case "tree":
      fill(ctx, C.grass);
      trees(ctx, 2 + (c - 21) % 3, c * 13, 0.3);
      return;
    case "woods":
      fill(ctx, C.grassDark);
      trees(ctx, 6 + (c - 37), c * 7 + variant, 0.42);
      return;
    case "rubble": {
      fill(ctx, C.dirt);
      const r = rng(c * 11);
      ctx.fillStyle = C.rubble;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.arc(0.15 + r() * 0.7, 0.15 + r() * 0.7, 0.08 + r() * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = C.rubbleLight;
      ctx.fillRect(0.3, 0.3, 0.07, 0.05);
      return;
    }
    case "flood":
      fill(ctx, C.floodMud);
      ctx.fillStyle = C.floodWater;
      ctx.fillRect(0, 0.2 + (c - 48) * 0.1, 1, 0.5);
      return;
    case "radiation": {
      fill(ctx, C.rad);
      ctx.save();
      ctx.translate(0.5, 0.5);
      ctx.rotate((phase * Math.PI) / 8);
      ctx.fillStyle = C.radDark;
      for (let i = 0; i < 3; i++) {
        ctx.rotate((Math.PI * 2) / 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 0.3, -0.5, 0.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      return;
    }
    case "fire": {
      fill(ctx, C.burnt);
      const heights = [0.6, 0.85, 0.7, 0.95];
      const h = heights[(phase + (c - 56)) % 4];
      for (const [x, s] of [[0.3, 0.8], [0.55, 1], [0.72, 0.6]]) {
        ctx.fillStyle = C.flame;
        ctx.beginPath();
        ctx.moveTo(x - 0.15 * s, 0.95);
        ctx.quadraticCurveTo(x, 0.95 - h * 0.6 * s, x + 0.05, 0.95 - h * s);
        ctx.quadraticCurveTo(x + 0.15 * s, 0.95 - h * 0.4 * s, x + 0.15 * s, 0.95);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = C.flameHot;
      ctx.beginPath();
      ctx.arc(0.5, 0.85, 0.09, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "road":
    case "road-wire": {
      fill(ctx, C.grass);
      const m = roadMask(c) || E | W;
      arms(ctx, m, 0.2, C.asphalt);
      if (cls === "road-wire") wireArms(ctx, wireMask(c));
      if (bitCount(m) < 3) laneMarks(ctx, m);
      return;
    }
    case "traffic": {
      fill(ctx, C.grass);
      const m = roadMask(c);
      arms(ctx, m, 0.2, C.asphalt);
      if (bitCount(m) < 3) laneMarks(ctx, m);
      cars(ctx, m, c < 144 ? 2 : 4, c * 17);
      return;
    }
    case "bridge": {
      const horizontal = HORIZONTAL_BRIDGES.has(c);
      waterTile(ctx, 0, phase, true);
      ctx.fillStyle = C.asphalt;
      if (horizontal) ctx.fillRect(0, 0.3, 1, 0.4);
      else ctx.fillRect(0.3, 0, 0.4, 1);
      ctx.strokeStyle = C.mark;
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(0, 0.32); ctx.lineTo(1, 0.32);
        ctx.moveTo(0, 0.68); ctx.lineTo(1, 0.68);
      } else {
        ctx.moveTo(0.32, 0); ctx.lineTo(0.32, 1);
        ctx.moveTo(0.68, 0); ctx.lineTo(0.68, 1);
      }
      ctx.stroke();
      return;
    }
    case "wire":
      fill(ctx, C.grass);
      wireArms(ctx, wireMask(c));
      return;
    case "rail-wire":
      fill(ctx, C.ballast);
      railArms(ctx, c === 221 ? E | W : N | S);
      wireArms(ctx, c === 221 ? E | W : N | S);
      return;
    case "rail":
      fill(ctx, C.grass);
      railArms(ctx, railMask(c));
      return;
    case "rail-road": {
      fill(ctx, C.grass);
      const m = c === 237 ? E | W : N | S;
      railArms(ctx, m);
      arms(ctx, m, 0.2, C.asphalt);
      laneMarks(ctx, m);
      return;
    }
    case "lightning":
      fill(ctx, C.dirt);
      bolt(ctx, 0.5, 0.5, 0.9);
      return;
    case "radar": {
      fill(ctx, C.grass);
      ctx.fillStyle = C.concrete;
      ctx.fillRect(0.46, 0.55, 0.08, 0.4);
      ctx.save();
      ctx.translate(0.5, 0.45);
      ctx.rotate(((c - 832) * Math.PI) / 4 + phase * 0.3);
      ctx.fillStyle = C.white;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.36, 0.14, 0, Math.PI, 0);
      ctx.fill();
      ctx.restore();
      return;
    }
    case "fountain":
      fill(ctx, C.grass);
      ctx.fillStyle = C.waterLight;
      ctx.beginPath();
      ctx.ellipse(0.5, 0.55, 0.38, 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.fountain;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(0.5, 0.5);
      ctx.lineTo(0.5, 0.2 + (c - 840) * 0.03);
      ctx.stroke();
      return;
    case "tele": {
      fill(ctx, C.grass);
      ctx.fillStyle = C.steelGrey;
      ctx.fillRect(0.47, 0.35, 0.06, 0.6);
      ctx.strokeStyle = C.steelGrey;
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.arc(0.5, 0.35, 0.12 + (c - 844) * 0.02, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    case "smoke": {
      fill(ctx, C.dirt);
      // exhaust puffs (coal smoke, 916..931) are small and dark; the smoke tiles grow with their number
      const coal = c >= 916;
      ctx.fillStyle = coal ? "rgba(70,70,70,0.85)" : "rgba(160,160,160,0.85)";
      ctx.beginPath();
      const radius = coal ? 0.1 + ((c - 916) % 4) * 0.03 : 0.18 + (c - 852) * 0.02;
      ctx.arc(0.5, 0.5, radius, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "explosion": {
      fill(ctx, C.dirt);
      ctx.fillStyle = C.flame;
      ctx.beginPath();
      ctx.arc(0.5, 0.5, 0.3 + ((c - 860) % 8) * 0.04, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.flameHot;
      ctx.beginPath();
      ctx.arc(0.5, 0.5, 0.14, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "football": {
      fill(ctx, C.stadiumGrass);
      ctx.strokeStyle = C.mark;
      ctx.lineWidth = 0.03;
      ctx.strokeRect(0.1, 0.1, 0.8, 0.8);
      ctx.fillStyle = (c - 932) % 2 ? "#d9534f" : "#4f7fd9";
      ctx.fillRect(0.3 + ((c - 932) % 4) * 0.1, 0.4, 0.08, 0.2);
      return;
    }
    case "nuke-swirl": {
      fill(ctx, C.rad);
      ctx.strokeStyle = C.radDark;
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.arc(0.5, 0.5, 0.3, (c - 952) * 0.8, (c - 952) * 0.8 + 4.2);
      ctx.stroke();
      return;
    }
    default:
      fill(ctx, C.dirt);
  }
}

function bitCount(m) {
  let n = 0;
  for (let v = m; v; v >>= 1) n += v & 1;
  return n;
}

// The seed of a zone block: the same for each of its tiles, so the building is one picture.
function blockSeed(piece) {
  let h = 0;
  for (const ch of piece.family) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h + piece.block * 7919) >>> 0;
}

// Draws the art of atlas key `key` into the unit square of `ctx` (already transformed).
export function paintKey(ctx, key) {
  const { c, powerIcon, phase, variant } = decodeKey(key);
  const cls = artClass(c);
  const piece = zonePiece(c);
  if (piece && piece.family !== "house") {
    drawPiece(ctx, piece, blockSeed(piece));
  } else if (piece && piece.family === "house") {
    fill(ctx, C.grass);
    const d = piece.density;
    house(ctx, 0.25, 0.3 + (d % 3) * 0.02, 0.5, 0.45, d % 2 ? C.wallRes : C.wallRes2, d % 3 ? C.roofRed : C.roofBrown);
  } else {
    drawSingle(ctx, c, cls, variant, phase);
  }
  if (powerIcon) {
    // no power: a dark disc with a lightning bolt on the zone centre
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.beginPath();
    ctx.arc(0.5, 0.5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    bolt(ctx, 0.5, 0.5, 0.7);
  }
}

// --- Atlas (browser only) ----------------------------------------------------------------------

// `createAtlas({ doc, px })` -> { cell(key) -> Uint32Array of px*px pixels (ABGR words, little
// endian), px }. The atlas canvas is built once: every base tile character at creation, the
// shimmer and power-icon variants when a tile first needs them. Cells are cached by key.
export function createAtlas({ doc = globalThis.document, px = TILE_PX } = {}) {
  const canvas = doc.createElement("canvas");
  canvas.width = ATLAS_COLS * px;
  canvas.height = ATLAS_COLS * px;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const cells = new Map();
  let next = 0;

  function build(key) {
    const index = next++;
    const cx = (index % ATLAS_COLS) * px;
    const cy = Math.floor(index / ATLAS_COLS) * px;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(cx, cy, px, px);
    ctx.setTransform(px, 0, 0, px, cx, cy);
    ctx.beginPath();
    ctx.rect(0, 0, 1, 1);
    ctx.clip();
    paintKey(ctx, key);
    ctx.restore();
    const data = ctx.getImageData(cx, cy, px, px).data;
    const words = new Uint32Array(data.buffer.slice(0));
    cells.set(key, words);
    return words;
  }

  const blank = new Uint32Array(px * px);
  const atlas = {
    px,
    // The cell of `key` (px * px ABGR words). Keys past the atlas budget show the base tile.
    cell(key) {
      const hit = cells.get(key);
      if (hit) return hit;
      if (next >= ATLAS_COLS * ATLAS_COLS) return cells.get(key & LOMASK) ?? blank;
      return build(key);
    },
    get size() {
      return cells.size;
    },
  };
  for (let c = 0; c < TILE_LIMIT; c++) atlas.cell(c); // every base tile character, once
  return atlas;
}
