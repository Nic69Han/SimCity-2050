// Highway tool (docs/game-design-v13.md) as an extra tool module (contract in extra-tools.js): one entry «Autoroute»
// (id "highway", kind "highways", group «Réseaux»), 1x1. A click places a highway on the tile (the engine says
// whether it is a road); a drag places one along the dragged line. Not an engine tool id: it calls highway_preview,
// place_highway one tile at a time. Pure: no DOM, so node:test can check it.
import { supportsHighways, highwaysBlockedReason, highwayLine } from "./highways-model.js";
import { summarize } from "./transit-model.js";

export const KIND = "highways";

// ToolResult codes (docs/tools-contract.md, the same values as RESULT in tools.js; not imported, to keep this
// module free of the palette's cycle).
const OK = 1;
const FAILED = 0;
const NEED_BULLDOZE = -1;
const NO_MONEY = -2;
// French hover reasons for a refused tile, by code. The engine gives a refused preview a cost of 0.
const REFUSAL = Object.freeze({
  [FAILED]: "Impossible ici : posez-la sur une route",
  [NEED_BULLDOZE]: "Terrain à dégager",
  [NO_MONEY]: "Fonds insuffisants",
});

// Catalog entries of the highway tool, when the engine has the highways; [] otherwise. The price depends on the
// engine's rules, so the catalog shows «au survol» and the hover label gives the preview's cost.
export function catalog(city) {
  if (!supportsHighways(city)) return [];
  return [{
    id: "highway",
    key: "highway",
    label: "Autoroute",
    group: "reseaux",
    groupLabel: "Réseaux",
    cost: 0,
    size: 1,
    shortcut: null,
    kind: KIND,
    costText: "au survol",
    idleHint: "coût affiché au survol",
  }];
}

// The engine calls of the highway entry: { footprint, preview, down, drag }, each taking tile coordinates; null
// for an entry of another module or without the highways. A drag places along the line from the tile after the
// start, and the stroke's result is the engine's summary of those placements.
export function calls(city, entry) {
  if (entry?.kind !== KIND || !supportsHighways(city)) return null;
  return {
    footprint: (x, y) => Int32Array.of(x, y, 1, 1),
    preview: (x, y) => city.highway_preview(x, y),
    down: (x, y) => city.place_highway(x, y),
    drag(x0, y0, x1, y1) {
      return summarize(highwayLine(x0, y0, x1, y1).map((t) => city.place_highway(t.x, t.y)));
    },
  };
}

// Hover label: undefined keeps the default (tools.js costLabel: the preview's cost) when the tile can take a
// highway, else the reason the tile is refused (the engine gives it a cost of 0, never the catalog price).
export function label(preview) {
  if (!preview || preview[0] === OK || preview[1] > 0) return undefined;
  return REFUSAL[preview[0]] ?? REFUSAL[FAILED];
}

// Why the highway tool cannot be used now, in French; "" when it can (or the engine has no highways). The flag is
// read from the engine itself, as the transit tools do.
export function blockedReason(city) {
  return highwaysBlockedReason(city);
}
