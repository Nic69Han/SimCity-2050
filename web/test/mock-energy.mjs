// Energy of the mock engine (docs/game-design-v10.md), used by mock-engine.mjs when its `energy` option is on.
// Pure helpers; the rules are documented in the header of mock-engine.mjs. The engine's real rules are the
// core's (crates/micropolis-core/src/energy.rs). The numbers are fixed: the mock places no plant.

// The methods of the energy API, hidden unless the constructor asks with `energy: true`.
export const ENERGY_METHODS = Object.freeze(["energy_rules", "set_energy_rules", "energy_stats", "power_plants"]);

// energy_stats() while the rule is on: [production, consumption, bought, plants, plants_at_end_of_life, pollution].
export const ENERGY_FIXED = Object.freeze([1200, 900, 50, 3, 1, 40]);

// power_plants() while the rule is on: a gas plant at 36 months of 480, a wind turbine at 200 of 240 (past 80 %,
// at the end of its life), a coal plant at 120 of 600. Records of 6 [genre, x, y, age, lifetime, power].
export const MOCK_PLANTS = Object.freeze([
  Object.freeze([40, 10, 10, 36, 480, 100]),
  Object.freeze([42, 4, 4, 200, 240, 92]),
  Object.freeze([0, 20, 5, 120, 600, 100]),
]);

/** energy_stats: ENERGY_FIXED while the rule is on, six zeros otherwise. */
export function energyStatsOf(rule) {
  return Int32Array.from(ENERGY_FIXED, (v) => (rule ? v : 0));
}

/** power_plants: the flat records of MOCK_PLANTS while the rule is on, nothing otherwise. */
export function powerPlantsOf(rule) {
  return rule ? Int32Array.from(MOCK_PLANTS.flat()) : new Int32Array(0);
}
