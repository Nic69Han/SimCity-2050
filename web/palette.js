// Legend colours (presentation only, ARCHITECTURE.md rule 5). The legend shows one swatch per
// category; the map is drawn with the tile art of tiles.js, whose main colours these approximate.
// Ranges are tile character numbers (low 10 bits), from the C++ MapTileCharacters / micropolis.h.
// Entries must not overlap (tested); a tile outside every range is drawn magenta.

export const TILE_LIMIT = 1024;
export const MISSING_TILE_RGBA = 0xffff00ff; // magenta, little-endian ABGR for the renderer

export const PALETTE = Object.freeze([
  { lo: 0, hi: 0, color: "#b09a68", label: "Terrain nu" },
  { lo: 2, hi: 20, color: "#2a5fb0", label: "Eau" },
  { lo: 21, hi: 43, color: "#2e6b2e", label: "Arbres" },
  { lo: 44, hi: 47, color: "#7d6f66", label: "Décombres" },
  { lo: 48, hi: 51, color: "#6f8fa8", label: "Inondation" },
  { lo: 52, hi: 55, color: "#b6d53a", label: "Radioactivité" },
  { lo: 56, hi: 63, color: "#ff7a1a", label: "Incendie" },
  { lo: 64, hi: 206, color: "#4b4f55", label: "Route" },
  { lo: 208, hi: 222, color: "#2a2a2a", label: "Ligne électrique" },
  { lo: 224, hi: 238, color: "#8c7e66", label: "Voie ferrée" },
  { lo: 240, hi: 422, color: "#9cc77a", label: "Zone résidentielle" },
  { lo: 423, hi: 611, color: "#9fbfe0", label: "Zone commerciale" },
  { lo: 612, hi: 692, color: "#c9b771", label: "Zone industrielle" },
  { lo: 693, hi: 708, color: "#2c6f9e", label: "Port" },
  { lo: 709, hi: 744, color: "#50545a", label: "Aéroport" },
  { lo: 745, hi: 760, color: "#55504b", label: "Centrale au charbon" },
  { lo: 761, hi: 810, color: "#2c4a8a", label: "Services (pompiers, police, stade)" },
  { lo: 811, hi: 826, color: "#eeeeea", label: "Centrale nucléaire" },
  { lo: 827, hi: 839, color: "#6b6b7a", label: "Autres (ponts, radar)" },
  { lo: 840, hi: 843, color: "#7fd0ff", label: "Fontaine" },
  { lo: 844, hi: 1023, color: "#6b6b7a", label: "Autres (ponts, radar)" },
]);

// Renderer table: one ABGR word per tile character (little-endian RGBA in a Uint32Array).
export function buildRgbTable(palette = PALETTE) {
  const rgb = new Uint32Array(TILE_LIMIT).fill(MISSING_TILE_RGBA);
  for (const { lo, hi, color } of palette) {
    const v = parseInt(color.slice(1), 16);
    const abgr = (0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | (v >> 16)) >>> 0;
    for (let t = lo; t <= hi; t++) rgb[t] = abgr;
  }
  return rgb;
}

// Palette entry ({ lo, hi, color, label }) of a tile character, or null when no range covers it.
export function tileEntry(tile, palette = PALETTE) {
  const t = tile & (TILE_LIMIT - 1);
  return palette.find((e) => t >= e.lo && t <= e.hi) ?? null;
}

// Colour (hex) of a tile character, or null when no range covers it.
export function tileColor(tile, palette = PALETTE) {
  const hit = tileEntry(tile, palette);
  return hit ? hit.color : null;
}

// Legend rows: one per distinct label, in palette order, with the colour of its first range.
export function legendEntries(palette = PALETTE) {
  const seen = new Set();
  const out = [];
  for (const { label, color } of palette) {
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, color });
  }
  return out;
}
