// Zoning by density of the mock engine (docs/game-design-v07.md), used by mock-engine.mjs when its
// `densities` option is on. Pure helpers over the mock's zone records { genre, density, x, y }; the
// rules are documented in the header of mock-engine.mjs. The engine's real rules are the core's.

export const MOCK_ZONE_COST = 100; // dollars of a classic zone; a density costs a percentage of it
export const ZONE_HALF = 1; // tiles from a zone's centre to its edge: a zone is 3x3
export const CLASSIC_DENSITY = 3; // what a zone counts as while the rule is off (dense, no cap)

const COST_PCT = Object.freeze({ 1: 80, 2: 100, 3: 150 }); // light, medium, dense
const TILE = Object.freeze({ 1: 240, 2: 423, 3: 612 }); // residential, commercial, industrial tiles

/** Whether (genre, density) names a zone: genre 1 R, 2 C, 3 I; density 1 light, 2 medium, 3 dense. */
export function isZone(genre, density) {
  return Number.isInteger(genre) && Number.isInteger(density) &&
    Object.hasOwn(TILE, genre) && Object.hasOwn(COST_PCT, density);
}

/** Price of a 3x3 zone of density `density`, in dollars. */
export function zoneCost(density) {
  return (MOCK_ZONE_COST * COST_PCT[density]) / 100;
}

/** Tile written on the nine tiles of a zone of genre `genre`. */
export function zoneTile(genre) {
  return TILE[genre];
}

/** Density a zone counts as now: its own while the rule is on, dense while it is off. */
export function zoneDensity(zone, rule) {
  return rule ? zone.density : CLASSIC_DENSITY;
}

/** density_layer: one value per tile (index x * height + y): 0 nothing, 1-3 the zone's density. */
export function zoneLayer(zones, width, height, rule) {
  const out = new Uint8Array(width * height);
  for (const zone of zones) {
    const value = zoneDensity(zone, rule);
    for (let dx = -ZONE_HALF; dx <= ZONE_HALF; dx++) {
      for (let dy = -ZONE_HALF; dy <= ZONE_HALF; dy++) {
        out[(zone.x + dx) * height + zone.y + dy] = value;
      }
    }
  }
  return out;
}

/** density_stats: [light, medium, dense, farms (none in the mock), farm jobs (none)]. */
export function zoneStats(zones, rule) {
  const counts = [0, 0, 0];
  for (const zone of zones) counts[zoneDensity(zone, rule) - 1]++;
  return Int32Array.of(counts[0], counts[1], counts[2], 0, 0);
}
