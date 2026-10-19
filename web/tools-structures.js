// Extended buildings tools (docs/game-design-v04.md) as an extra tool module (contract in
// extra-tools.js). One entry per genre of the engine's catalog: a click places a building whose
// top-left tile is the clicked one; the hover shows the engine's preview. Their entries have ids
// "structures:<genre>" and kind "structures", in the «Bâtiments» group. Not engine tool ids: they
// call structure_preview / place_structure. Pure: no DOM, so node:test can check it.
import { supportsStructures, decodeCatalog, nameOf, upkeepText, structuresBlockedReason } from "./structures-model.js";

export const KIND = "structures";

// Catalog entries of the buildings, when the engine has them; [] otherwise. The price is the
// engine's construction cost; the button shows the monthly upkeep (costText).
export function catalog(city) {
  if (!supportsStructures(city)) return [];
  return decodeCatalog(city.structure_catalog()).map((r) => ({
    id: `structures:${r.genre}`,
    key: `structure_${r.genre}`,
    label: nameOf(r.genre),
    group: "batiments",
    groupLabel: "Bâtiments",
    cost: r.cost,
    size: Math.max(r.width, r.height),
    shortcut: null,
    kind: KIND,
    genre: r.genre,
    width: r.width,
    height: r.height,
    costText: upkeepText(r.upkeep),
    idleHint: "coût affiché au survol",
  }));
}

// The engine calls of one building entry: { footprint, preview, down, drag }, each taking tile
// coordinates; null for an entry of another module. The footprint is the building's rectangle
// with the clicked tile as its top-left. A drag places nothing: one building per click.
export function calls(city, entry) {
  if (entry?.kind !== KIND || !supportsStructures(city)) return null;
  const { genre, width, height } = entry;
  return {
    footprint: (x, y) => Int32Array.of(x, y, width, height),
    preview: (x, y) => city.structure_preview(genre, x, y),
    down: (x, y) => city.place_structure(genre, x, y),
    drag: () => 0,
  };
}

// Hover label of a building entry: undefined keeps the default (tools.js costLabel), which shows
// the preview's cost when the placement is allowed, else the catalog price.
export function label(_preview) {
  return undefined;
}

// Why the buildings cannot be used now, in French; "" when they can (or the engine has none).
export function blockedReason(city, { in3d }) {
  return structuresBlockedReason(city, { in3d: Boolean(in3d) });
}
