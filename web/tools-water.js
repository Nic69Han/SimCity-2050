// Water tools (docs/game-design-v02.md, "Réseau d'eau") as an extra tool module (see
// extra-tools.js for the contract): «Canalisation» (a drag lays a line of pipes), «Pompe à eau»
// and «Retirer» (takes up a pipe or a pump). Not engine tool ids: each calls the City.place_pipe /
// place_pump / remove_* methods one tile at a time. Their catalog entries have ids "water:<name>"
// and kind "water", and sit in the «Réseaux» group (the palette only knows its own groups).
// Pure: no DOM, so node:test can check it.
import { lineTiles } from "./relief.js";
import { supportsWater, waterBlockedReason } from "./water-model.js";

export const KIND = "water";

const RESULT = Object.freeze({ NO_MONEY: -2, FAILED: 0, OK: 1 }); // ToolResult (docs/tools-contract.md)

// The engine says what a pipe and a pump cost (City.water_costs = [pipe, pump, most pumps]).
const TOOLS = Object.freeze([
  { name: "pipe", key: "canalisation", label: "Canalisation", cost: (c) => c[0], hint: "glisser pour poser une ligne" },
  { name: "pump", key: "pompe", label: "Pompe à eau", cost: (c) => c[1], hint: "sur la rive (terre à côté de l'eau)" },
  { name: "remove", key: "retrait-eau", label: "Retirer canalisation ou pompe", cost: () => 0, hint: "gratuit" },
]);

const toolOf = (entry) => TOOLS.find((t) => entry?.id === `water:${t.name}`) ?? null;

// Catalog entries of the water tools when the engine has the water network; [] otherwise.
export function catalog(city) {
  if (!supportsWater(city)) return [];
  const costs = Array.from(city.water_costs());
  return TOOLS.map((t) => ({
    id: `water:${t.name}`,
    key: t.key,
    label: t.label,
    group: "reseaux",
    groupLabel: "Réseaux",
    cost: t.cost(costs),
    size: 1,
    shortcut: null,
    kind: KIND,
    idleHint: t.hint,
  }));
}

// The result of a drag that tried several tiles: money trouble is reported, else a success if any
// tile worked (the others were already laid), else the last refusal.
function dragResult(results) {
  if (results.includes(RESULT.NO_MONEY)) return RESULT.NO_MONEY;
  if (results.includes(RESULT.OK)) return RESULT.OK;
  return results.length ? results[results.length - 1] : RESULT.OK;
}

// The engine calls of one water entry: { footprint, preview, down, drag }, each taking tile
// coordinates; null for an entry of another module (or one this module does not know).
export function calls(city, entry) {
  const tool = toolOf(entry);
  if (entry?.kind !== KIND || !tool) return null;
  const footprint = (x, y) => Int32Array.of(x, y, 1, 1);
  if (tool.name === "pipe") {
    return {
      footprint,
      preview: (x, y) => city.pipe_preview(x, y),
      down: (x, y) => city.place_pipe(x, y),
      drag: (x0, y0, x1, y1) => dragResult(lineTiles(x0, y0, x1, y1).map((t) => city.place_pipe(t.x, t.y))),
    };
  }
  if (tool.name === "pump") {
    // A pump is one building: a drag never sprays pumps along the pointer's path.
    return {
      footprint,
      preview: (x, y) => city.pump_preview(x, y),
      down: (x, y) => city.place_pump(x, y),
      drag: () => RESULT.OK,
    };
  }
  const removeAt = (x, y) => (city.water_piece(x, y) === 3 ? city.remove_pump(x, y) : city.remove_pipe(x, y));
  return {
    footprint,
    // there is no engine preview for taking up: allowed when something lies there
    preview: (x, y) => Int32Array.of(city.water_piece(x, y) !== 0 ? RESULT.OK : RESULT.FAILED, 0),
    down: removeAt,
    drag: (x0, y0, x1, y1) => dragResult(lineTiles(x0, y0, x1, y1).map((t) => removeAt(t.x, t.y))),
  };
}

// Title (tooltip) of a water tool's button: its name, then why it is blocked or what it does.
export function buttonTitle(key, reason) {
  const tool = TOOLS.find((t) => t.key === key);
  return tool ? `${tool.label} : ${reason || tool.hint}` : "";
}

// The default cost label is right (the engine's cost when allowed, the price otherwise).
export function label(_preview) {
  return undefined;
}

// Why the water tools cannot be used now, in French; "" when they can (or the engine has no water).
export function blockedReason(city, { in3d }) {
  if (!supportsWater(city)) return "";
  return waterBlockedReason({ rules: Boolean(city.water_rules()), in3d: Boolean(in3d) });
}
