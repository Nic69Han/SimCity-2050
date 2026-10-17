// Metro tools (docs/game-design-v02.md) as an extra tool module (see extra-tools.js for the
// contract): «Tunnel de métro» (a drag digs a line, tile after tile) and «Station de métro».
// Not engine tool ids: they call place_tunnel / tunnel_preview and place_station / station_preview
// one tile at a time. Their entries have id "transit:tunnel" / "transit:station", kind "transit".
// Pure: no DOM, so node:test can check it.
import { supportsTransit, readTransit, readParams, transitBlockedReason, tunnelPath, summarize } from "./transit-model.js";

export const KIND = "transit";

const TOOLS = Object.freeze([
  { part: "tunnel", key: "metro_tunnel", label: "Tunnel de métro", shortcut: "j", costText: "par tuile" },
  { part: "station", key: "metro_station", label: "Station de métro", shortcut: "k", costText: "par station" },
]);

// Catalog entries of the metro tools, when the engine has the metro. Same shape as tools.js
// readCatalog's, plus kind and part; the price comes from the engine (City.transit_params) and
// the hover label shows the preview's cost.
export function catalog(city) {
  if (!supportsTransit(city)) return [];
  const params = readParams(city);
  return TOOLS.map((t) => ({
    id: `transit:${t.part}`,
    key: t.key,
    label: t.label,
    group: "reseaux",
    groupLabel: "Réseaux",
    cost: t.part === "tunnel" ? params.tunnelCost : params.stationCost,
    size: 1,
    shortcut: t.shortcut,
    kind: KIND,
    part: t.part,
    costText: t.costText,
    idleHint: "coût affiché au survol",
  }));
}

// The engine calls of one metro entry: { footprint, preview, down, drag }, each taking tile
// coordinates; null for an entry of another module. A drag of the tunnel tool digs every tile its
// pointer crosses, from the tile after the start, by sides only; the station tool places one
// station per click and ignores a drag.
export function calls(city, entry) {
  if (entry.kind !== KIND || !supportsTransit(city)) return null;
  const tunnel = entry.part === "tunnel";
  return {
    footprint: (x, y) => Int32Array.of(x, y, 1, 1),
    preview: (x, y) => (tunnel ? city.tunnel_preview(x, y) : city.station_preview(x, y)),
    down: (x, y) => (tunnel ? city.place_tunnel(x, y) : city.place_station(x, y)),
    drag(x0, y0, x1, y1) {
      if (!tunnel) return 0;
      return summarize(tunnelPath(x0, y0, x1, y1).map((t) => city.place_tunnel(t.x, t.y)));
    },
  };
}

// Hover label of a metro entry: undefined keeps the default (tools.js costLabel): the engine's cost
// when the placement is allowed, else the catalog price, so the label always tells a cost.
export function label(_preview) {
  return undefined;
}

// Why the metro tools cannot be used now, in French; "" when they can. The flag is read from the
// engine itself, so the answer is right even before the page has relayed a change of the rules.
export function blockedReason(city, { in3d }) {
  if (!supportsTransit(city)) return ""; // no metro in this engine: there is no metro tool either
  return transitBlockedReason({ rules: readTransit(city), in3d: Boolean(in3d) });
}
