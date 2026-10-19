// Zoning by density tools (docs/game-design-v07.md) as an extra tool module (contract in
// extra-tools.js). Nine entries, one per genre and density, in the «Zonage» group, with ids
// "zoning:<letter>:<densité>". Not engine tool ids: they call zone_preview / place_zone. A click
// places a 3x3 zone centred on the clicked tile; the hover shows the engine's preview, whose cost
// is the zone's price. Pure: no DOM, so node:test can check it.
import {
  supportsZoning, zoningBlockedReason, GENRES, DENSITIES, zoneId, zoneKey, zoneLabel,
} from "./zoning-model.js";

export const KIND = "zoning";
export const SIZE = 3; // a zone's side, in tiles
const HALF = (SIZE - 1) / 2; // tiles from the centre to the edge of a zone
// ToolResult codes (docs/tools-contract.md, the same values as RESULT in tools.js; not imported, to
// keep this module free of the palette's cycle).
const OK = 1;
const FAILED = 0;
const NEED_BULLDOZE = -1;
const NO_MONEY = -2;
// French hover reasons for a refused tile, by code. The engine gives a refused preview a cost of 0.
const REFUSAL = Object.freeze({
  [FAILED]: "Impossible ici",
  [NEED_BULLDOZE]: "Terrain à dégager",
  [NO_MONEY]: "Fonds insuffisants",
});

// Catalog entries of the zones, when the engine has the zoning by density; [] otherwise. The price
// depends on the tile (the engine's preview gives it), so the catalog shows «au survol».
export function catalog(city) {
  if (!supportsZoning(city)) return [];
  return GENRES.flatMap((g) => DENSITIES.map((d) => ({
    id: zoneId(g.genre, d.density),
    key: zoneKey(g.genre, d.density),
    label: zoneLabel(g.genre, d.density),
    group: "zonage",
    groupLabel: "Zonage",
    cost: 0,
    size: SIZE,
    shortcut: null,
    kind: KIND,
    genre: g.genre,
    density: d.density,
    costText: "au survol",
    idleHint: "coût affiché au survol",
  })));
}

// The engine calls of one zone entry: { footprint, preview, down, drag }, each taking tile
// coordinates; null for an entry of another module. The footprint is the 3x3 square centred on the
// clicked tile. A drag places nothing: one zone per click.
export function calls(city, entry) {
  if (entry?.kind !== KIND || !supportsZoning(city)) return null;
  const { genre, density } = entry;
  return {
    footprint: (x, y) => Int32Array.of(x - HALF, y - HALF, SIZE, SIZE),
    preview: (x, y) => city.zone_preview(genre, density, x, y),
    down: (x, y) => city.place_zone(genre, density, x, y),
    drag: () => 0,
  };
}

// Hover label of a zone. A placeable tile (Ok, or a preview that charges) keeps the default
// (tools.js costLabel), which shows the preview's cost. Otherwise the tile is refused and the engine
// reports a cost of 0, so the label gives the reason: never the catalog price («gratuit»).
export function label(preview) {
  if (!preview || preview[0] === OK || preview[1] > 0) return undefined;
  return REFUSAL[preview[0]] ?? REFUSAL[FAILED];
}

// Why the zoning tools cannot be used now, in French; "" when they can (or the engine has none).
export function blockedReason(city, { in3d }) {
  return zoningBlockedReason(city, { in3d: Boolean(in3d) });
}
