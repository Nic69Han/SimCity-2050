// Highways, page side (docs/game-design-v13.md): whether the engine has the highways, the rule «Autoroutes», the
// statistics (tiles and yearly upkeep), the drag line of the highway tool and the reason it cannot be used. The engine
// decides the rule, the placement, the cost and the traffic. Pure: no DOM, so node:test can check it.
//
// The engine's statistics (City.highway_stats): Int32Array [tiles, yearly_upkeep_in_dollars].

import { formatInt, formatMoney } from "./budget-text.js";
import { lineTiles } from "./relief.js";

// The engine methods of the highways. Without all of them there is no highway tool and no highways section.
export const METHODS = Object.freeze([
  "highway_rules", "set_highway_rules", "highway_preview", "place_highway", "remove_highway", "highway_layer",
  "highway_stats",
]);

// Numbers of highway_stats, in this order.
export const STAT_COUNT = 2;
// Most tiles one drag may place (a stroke segment is short; a bounded walk whatever the pointer sends).
export const HIGHWAY_DRAG_MAX = 256;
// Why the highway tool cannot be used now (the palette shows it as the button's reason).
export const BLOCKED_TEXT = "Activez les autoroutes";

/** Whether `city` has the highways (all of METHODS). */
export function supportsHighways(city) {
  return METHODS.every((m) => typeof city?.[m] === "function");
}

/** The rule flag as the engine holds it now (false when the engine has no highways). */
export function readHighwaysOn(city) {
  return supportsHighways(city) && Boolean(city.highway_rules());
}

// A count as the page shows it: a non-negative integer, 0 for anything else.
const count = (n) => Math.max(0, Math.trunc(Number(n)) || 0);

/** Decodes highway_stats into { tiles, upkeep }. Only the first STAT_COUNT values are read; bad values count as 0. */
export function decodeHighwayStats(values) {
  const [tiles = 0, upkeep = 0] = Array.from(values ?? []).slice(0, STAT_COUNT).map(count);
  return { tiles, upkeep };
}

/** «34 tuiles», «1 tuile». */
export function tilesText(n) {
  return n === 1 ? "1 tuile" : `${formatInt(n)} tuiles`;
}

/** The two highway lines of the panel: the tiles, and the upkeep of the year. */
export function highwayStatsLines({ tiles, upkeep }) {
  return [`Autoroutes : ${tilesText(tiles)}`, `Entretien : ${formatMoney(upkeep)} par an`];
}

/** The note under the highways switch, as the rule is on or off. */
export function highwayNoteText(on) {
  return on
    ? "Tracez une autoroute sur une route existante : elle coûte plus cher, mais la circulation y est divisée par deux."
    : "Désactivé : les autoroutes sont retirées, sans remboursement.";
}

/**
 * Why the highway tool cannot be used now, in French; "" when it can, or when the engine has no highways (then
 * there is no tool at all). The rule is read from the engine, so the answer is right after a load too.
 */
export function highwaysBlockedReason(city) {
  if (!supportsHighways(city)) return "";
  return readHighwaysOn(city) ? "" : BLOCKED_TEXT;
}

/**
 * The tiles of a drag from (x0, y0) to (x1, y1): the tiles after the start, along the line, at most
 * HIGHWAY_DRAG_MAX of them.
 */
export function highwayLine(x0, y0, x1, y1) {
  return lineTiles(x0, y0, x1, y1).slice(0, HIGHWAY_DRAG_MAX);
}
