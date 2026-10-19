// Waste of the mock engine (docs/game-design-v08.md), used by mock-engine.mjs when its `waste` option is on
// (with the `structures` option, for the four waste genres). Pure helpers; the rules are documented in the
// header of mock-engine.mjs. The engine's real rules are the core's (crates/micropolis-core/src/waste.rs).

export const WASTE_STAT_COUNT = 7; // waste_stats: produced, treated, recycled, exported, accumulated, landfill room, power

// The waste genres of the mock catalog (the `waste` option): landfill 20, incinerator 21, recycling centre 22,
// recovery plant 23. Prices and upkeep are the mock's own numbers.
export const MOCK_WASTE_STRUCTURES = Object.freeze([
  { genre: 20, width: 3, height: 3, cost: 300, upkeep: 12 },
  { genre: 21, width: 2, height: 2, cost: 400, upkeep: 20 },
  { genre: 22, width: 2, height: 2, cost: 250, upkeep: 8 },
  { genre: 23, width: 3, height: 3, cost: 900, upkeep: 30 },
]);

/** A waste_stats array of WASTE_STAT_COUNT integers: the given values (missing ones 0), or all zeros when off. */
export function wasteStatsOf(rule, values) {
  return Int32Array.from({ length: WASTE_STAT_COUNT }, (_, i) => (rule ? Math.trunc(Number(values[i]) || 0) : 0));
}
