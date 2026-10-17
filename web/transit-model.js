// Metro, presentation side (ARCHITECTURE.md rule 5): the page shows the engine's flag, its network
// and its numbers, and forwards the player's choices. The engine decides what is allowed and what
// it costs. Pure: no DOM, so node:test can check it.
//
// The engine's network (City.transit_layer): one code per tile, in the order of tiles().
export const CODE_NOTHING = 0;
export const CODE_TUNNEL = 1;
export const CODE_TUNNEL_WORKING = 2;
export const CODE_STATION = 3;
export const CODE_STATION_WORKING = 4;

// Reach of a station when the engine does not say (City.transit_params): crate micropolis_core::transit.
export const DEFAULT_RADIUS = 8;

// Help of the «Métro» checkbox (its title attribute).
export const TRANSIT_HELP =
  "Tunnels et stations de métro, sous la ville. Deux stations reliées par des tunnels forment une " +
  "ligne : autour de chacune, le trafic baisse et la valeur du terrain monte. " +
  "Une station seule ne sert à rien.";

// The engine has the rule flag and the metro actions.
export function supportsTransit(city) {
  return ["transit_rules", "set_transit_rules", "place_tunnel", "tunnel_preview", "remove_tunnel",
    "place_station", "station_preview", "remove_station", "transit_layer", "transit_stats"]
    .every((m) => typeof city?.[m] === "function");
}

// The flag as the engine holds it now. Read it after every new or loaded city: a file may carry
// the rules on, and the page shows that. The page never pushes its checkbox into a new city.
export function readTransit(city) {
  return supportsTransit(city) ? Boolean(city.transit_rules()) : false;
}

// Sets the flag in the engine and returns what the engine then says (the value to show).
export function setTransit(city, on) {
  if (!supportsTransit(city)) return false;
  city.set_transit_rules(Boolean(on));
  return readTransit(city);
}

// The numbers of the rules as the engine gives them, with the defaults of an older engine.
// { tunnelCost, stationCost, radius, trafficCutPct, landBonus, maxStations }
export function readParams(city) {
  const p = typeof city?.transit_params === "function" ? Array.from(city.transit_params()) : [];
  return {
    tunnelCost: p[0] ?? 0,
    stationCost: p[1] ?? 0,
    radius: p[2] ?? DEFAULT_RADIUS,
    trafficCutPct: p[3] ?? 0,
    landBonus: p[4] ?? 0,
    maxStations: p[5] ?? 0,
  };
}

// Why the metro tools cannot be used now, in French; "" when they can. They need the rules on,
// and the 2D map (the network is drawn on it only).
export function transitBlockedReason({ rules, in3d }) {
  if (!rules) return "Activez « Métro » pour poser des tunnels et des stations";
  if (in3d) return "Le métro se pose sur la carte 2D : le plan des tunnels n'est pas dessiné en 3D";
  return "";
}

const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

// The stats line, from City.transit_stats [stations, tunnels, lines, covered tiles].
export function formatTransitStats(stats) {
  const [stations = 0, tunnels = 0, lines = 0, covered = 0] = Array.from(stats ?? []);
  return `Métro : ${plural(stations, "station")}, ${plural(tunnels, "tunnel")}, ` +
    `${plural(lines, "ligne en service", "lignes en service")}, ${plural(covered, "tuile desservie", "tuiles desservies")}`;
}

// Tiles of a tunnel dug by dragging from (x0, y0) to (x1, y1): start excluded, end included, each
// tile touching the previous one by a side (tunnels link by their sides, never by a corner).
export function tunnelPath(x0, y0, x1, y1) {
  const out = [];
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    const stepX = e2 >= dy, stepY = e2 <= dx;
    if (stepX) { err += dy; x += sx; }
    if (stepY) {
      if (stepX) out.push({ x, y }); // a corner step: go through the side tile first
      err += dx; y += sy;
    }
    out.push({ x, y });
  }
  return out;
}

// What the engine answered over a run of placements: no money wins (the player must know), then
// success if any tile was dug, else the last refusal. Codes as ToolResult (docs/tools-contract.md).
export function summarize(codes) {
  if (codes.includes(-2)) return -2;
  if (codes.includes(1)) return 1;
  return codes.length ? codes[codes.length - 1] : 0;
}

// What the map shows: the view state, owned here and shared by the map layer and the page feature.
// The network is drawn while the rules are on and a metro tool is chosen or «Plan du métro» is on.
const view = { plan: false, tool: false };

export function setPlanShown(on) {
  view.plan = Boolean(on);
}

export function isPlanShown() {
  return view.plan;
}

export function setMetroToolActive(on) {
  view.tool = Boolean(on);
}

export function isMetroToolActive() {
  return view.tool;
}

// Whether the map draws the network now.
export function metroShown(city) {
  return readTransit(city) && (view.plan || view.tool);
}
