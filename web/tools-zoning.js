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
const FAILED = 0; // ToolResult Failed (docs/tools-contract.md)

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

// Hover label of a zone: a refused tile says so (its preview has no cost to show); otherwise
// undefined keeps the default (tools.js costLabel), which shows the preview's cost.
export function label(preview) {
  return preview?.[0] === FAILED ? "Impossible ici" : undefined;
}

// Why the zoning tools cannot be used now, in French; "" when they can (or the engine has none).
export function blockedReason(city, { in3d }) {
  return zoningBlockedReason(city, { in3d: Boolean(in3d) });
}
