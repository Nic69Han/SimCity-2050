// Terraforming tools (roadmap step 1) as an extra tool module (see extra-tools.js for the
// contract). Not engine tool ids: each tool calls terraform(x, y, delta) and
// terraform_preview(x, y, delta) one tile at a time. Their catalog entries have id
// "relief:<delta>" and kind "relief". Pure: no DOM, so node:test can check it.
import { supportsTerraform, reliefBlockedReason, lineTiles } from "./relief.js";

export const KIND = "relief";

const RESULT_OK = 1; // ToolResult.OK (docs/tools-contract.md)

const RELIEF_TOOLS = Object.freeze([
  { key: "relever", label: "Relever", shortcut: "u", delta: 1 },
  { key: "abaisser", label: "Abaisser", shortcut: "d", delta: -1 },
]);

// "r" is the road, so the terraforming keys are U (up) and D (down).
// Catalog entries of the terraforming tools, when the engine has terraform and terraform_preview.
// Same shape as tools.js readCatalog's, plus kind and delta (+1 raise, -1 lower). Their cost is
// shown on the hover label only (the engine prices each tile), so the catalog cost is 0.
export function catalog(city) {
  if (!supportsTerraform(city)) return [];
  return RELIEF_TOOLS.map((r) => ({
    id: `relief:${r.delta}`,
    key: r.key,
    label: r.label,
    group: "terrain",
    groupLabel: "Terrain",
    cost: 0,
    size: 1,
    shortcut: r.shortcut,
    kind: KIND,
    delta: r.delta,
    costText: "selon pente",
    idleHint: "coût affiché au survol",
  }));
}

// The engine calls of one terraforming entry: { footprint, preview, down, drag }, each taking
// tile coordinates; null for an entry of another module. A drag terraforms every tile its
// pointer crosses, from the tile after the start.
export function calls(city, entry) {
  if (entry.kind !== KIND) return null;
  const d = entry.delta;
  return {
    footprint: (x, y) => Int32Array.of(x, y, 1, 1),
    preview: (x, y) => city.terraform_preview(x, y, d),
    down: (x, y) => city.terraform(x, y, d),
    drag(x0, y0, x1, y1) {
      let r = 0;
      for (const t of lineTiles(x0, y0, x1, y1)) r = city.terraform(t.x, t.y, d);
      return r;
    },
  };
}

// Label of a terraforming hover: the engine's cost when the step is allowed, else a dash
// (a refused step has no price to show).
export function label(preview) {
  return preview[0] === RESULT_OK ? formatCost(preview[1]) : "—";
}

function formatCost(cost) {
  return cost > 0 ? `${cost.toLocaleString("fr-FR")} $` : "gratuit";
}

// Why the terraforming tools cannot be used now, in French; "" when they can.
// `flags` holds the engine flags the page has read (flags.relief: the relief rules are on);
// `in3d` tells whether the 3D view is shown. `city` is unused: the flag comes from the page.
export function blockedReason(_city, { in3d, flags }) {
  return reliefBlockedReason({ rules: Boolean(flags?.relief), in3d });
}
