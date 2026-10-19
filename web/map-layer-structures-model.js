// The pure part of the 2D structures layer (map-layer-structures.js; docs/game-design-v04.md): decoding
// the engine's structure records and catalog, the rectangle of a structure, the colours of the genres,
// and whether a genre needs power. No DOM, no globals: node:test checks it directly.

// Most structures read from the engine and drawn in one frame.
export const MAX_DRAWN = 512;

// Most catalog entries read from the engine.
export const MAX_CATALOG = 64;

// Integers per record: structures [genre, x, y, largeur, hauteur, etat], catalog
// [genre, largeur, hauteur, cout, entretien, drapeaux, rayon, effet].
export const STRUCTURE_SIZE = 6;
export const CATALOG_SIZE = 8;

// Bit 0 of `etat` (state): powered by the electricity network.
export const STATE_POWERED = 1;
// Bit 0 of `drapeaux` (flags) in the catalog: the genre needs electricity.
export const FLAG_NEEDS_POWER = 1;

// Genres of the milestone: 1 park, 2 public square, 3 monument.
export const GENRE_COLORS = Object.freeze({
  1: "#6fb35a", // parc urbain: green
  2: "#e3d3ad", // place publique: beige
  3: "#9e9a94", // monument: stone grey
});
export const UNKNOWN_GENRE_COLOR = "#9e9e9e";

// A darker 1px frame around each footprint, and the red mark of a structure without power.
export const OUTLINE_COLOR = "#4a4a4a";
export const POWER_MARK_COLOR = "#d93025";

// Decodes the records of `city.structures()` into {genre, x, y, w, h, state}, with x and y the
// top-left tile. At most `max` records are read; a trailing incomplete record, and a record whose
// footprint is empty, are ignored. A missing or non-array input gives no structure.
export function decodeStructures(arr, max = MAX_DRAWN) {
  const out = [];
  if (!arr || typeof arr.length !== "number") return out;
  const count = Math.min(Math.floor(arr.length / STRUCTURE_SIZE), max);
  for (let r = 0; r < count; r++) {
    const i = r * STRUCTURE_SIZE;
    const w = arr[i + 3], h = arr[i + 4];
    if (!(w > 0 && h > 0)) continue;
    out.push({ genre: arr[i], x: arr[i + 1], y: arr[i + 2], w, h, state: arr[i + 5] });
  }
  return out;
}

// Decodes the records of `city.structure_catalog()` into a Map genre -> {genre, w, h, cost, upkeep,
// flags, radius, effect}. At most MAX_CATALOG records are read; a trailing incomplete one is ignored.
export function decodeCatalog(arr) {
  const out = new Map();
  if (!arr || typeof arr.length !== "number") return out;
  const count = Math.min(Math.floor(arr.length / CATALOG_SIZE), MAX_CATALOG);
  for (let r = 0; r < count; r++) {
    const i = r * CATALOG_SIZE;
    const entry = {
      genre: arr[i], w: arr[i + 1], h: arr[i + 2], cost: arr[i + 3],
      upkeep: arr[i + 4], flags: arr[i + 5], radius: arr[i + 6], effect: arr[i + 7],
    };
    out.set(entry.genre, entry);
  }
  return out;
}

// The rectangle [x, y, w, h] of a decoded structure in canvas pixels, `scale` pixels per tile.
export function rectOf(record, scale) {
  return [record.x * scale, record.y * scale, record.w * scale, record.h * scale];
}

// The fill colour of a genre; a genre not in the table is grey.
export function colorOf(genre) {
  return Object.hasOwn(GENRE_COLORS, genre) ? GENRE_COLORS[genre] : UNKNOWN_GENRE_COLOR;
}

// Whether a genre needs electricity, from the decoded catalog. A genre missing from the catalog (or
// no catalog at all) is taken as not needing power, so no mark is drawn for what is not known.
export function needsPower(catalog, genre) {
  const entry = catalog?.get?.(genre);
  return Boolean(entry) && (entry.flags & FLAG_NEEDS_POWER) !== 0;
}

// Whether a structure is powered (bit 0 of its state).
export function isPowered(record) {
  return (record.state & STATE_POWERED) !== 0;
}
