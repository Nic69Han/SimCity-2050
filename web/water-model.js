// Water network, presentation side (ARCHITECTURE.md rule 5): the page shows the engine's flag and
// forwards the player's choices; the engine decides what a pipe or a pump costs, where it can go
// and which zones have water (docs/game-design-v02.md, "Réseau d'eau"). Pure: no DOM, so
// node:test can check it.

// Help of the «Réseau d'eau» checkbox (its title attribute).
export const WATER_HELP =
  "Pompes sur la rive et canalisations souterraines : une zone sans eau ne se développe pas " +
  "au-delà d'une densité plafond (les petites villes grandissent sans eau, puis stagnent).";

// Help of the «Voir le réseau» checkbox.
export const WATER_VIEW_HELP =
  "Montre les canalisations, les pompes et les zones à sec sur la carte (toujours visible quand " +
  "un outil d'eau est choisi).";

// Keys of the three water tools (data-tool of their palette buttons).
export const WATER_TOOL_KEYS = Object.freeze(["canalisation", "pompe", "retrait-eau"]);

// Layer values of City.water_layer().
export const LAYER = Object.freeze({ NONE: 0, DRY_PIPE: 1, PIPE: 2, PUMP: 3 });

const METHODS = [
  "water_rules", "set_water_rules", "place_pipe", "pipe_preview", "remove_pipe", "place_pump",
  "pump_preview", "remove_pump", "water_layer", "water_dry_zones", "water_stats", "water_costs",
  "water_piece",
];

// The engine has the water network (every City.water_* / pipe / pump method).
export function supportsWater(city) {
  return METHODS.every((m) => typeof city?.[m] === "function");
}

// The flag as the engine holds it now. Read it after every new or loaded city: a file may carry
// the rules on, and the page shows that. The page never pushes its checkbox into a new city.
export function readWater(city) {
  return supportsWater(city) ? Boolean(city.water_rules()) : false;
}

// Sets the flag in the engine and returns what the engine then says (the value to show).
export function setWater(city, on) {
  if (!supportsWater(city)) return false;
  city.set_water_rules(Boolean(on));
  return readWater(city);
}

// Why the water tools cannot be used now, in French; "" when they can. They need the rules on and
// the flat map (the network is underground: only the 2D layer shows it).
export function waterBlockedReason({ rules, in3d }) {
  if (!rules) return "Activez « Réseau d'eau » pour poser des canalisations et des pompes";
  if (in3d) return "Le réseau d'eau se pose sur la carte 2D : il est souterrain, seul le calque 2D le montre";
  return "";
}

// Whether one of the pressed palette buttons (their data-tool keys) is a water tool.
export function waterToolPressed(keys) {
  return keys.some((k) => WATER_TOOL_KEYS.includes(k));
}

// The stats line, from City.water_stats() = [pumps, pipes, watered zones, unwatered zones]; "" when
// the network and the zones are both empty (nothing to say).
export function statsText(stats) {
  const [pumps = 0, pipes = 0, wet = 0, dry = 0] = stats ?? [];
  if (pumps + pipes + wet + dry === 0) return "";
  const n = (count, one, many) => `${count} ${count > 1 ? many : one}`;
  return (
    `Eau : ${n(pumps, "pompe", "pompes")}, ${n(pipes, "canalisation", "canalisations")} · ` +
    `${n(wet, "zone alimentée", "zones alimentées")}, ${dry} à sec`
  );
}

// Segments to stroke for a layer of `w` x `h` tiles (index x * h + y): a segment joins two
// neighbouring tiles that both hold a pipe or a pump (right and down only, so each is listed once).
// Returns { fed, dry, pumps }: segments as [x1, y1, x2, y2] in tile units (tile centres are at
// +0.5), and pumps as [x, y]. A segment is "fed" when both ends are, otherwise "dry". A lone pipe
// has no segment: `dots` lists the pipe tiles ([x, y] and whether fed) so that it is still drawn.
export function networkShapes(layer, w, h) {
  const out = { fed: [], dry: [], pumps: [], dots: [] };
  const at = (x, y) => (x < w && y < h ? layer[x * h + y] : LAYER.NONE);
  const isFed = (v) => v === LAYER.PIPE || v === LAYER.PUMP;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const v = layer[x * h + y];
      if (v === LAYER.NONE) continue;
      if (v === LAYER.PUMP) out.pumps.push([x, y]);
      else out.dots.push([x, y, isFed(v)]);
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const o = at(x + dx, y + dy);
        if (o === LAYER.NONE) continue;
        (isFed(v) && isFed(o) ? out.fed : out.dry).push([x, y, x + dx, y + dy]);
      }
    }
  }
  return out;
}
