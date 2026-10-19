// Zoning by density, presentation side (docs/game-design-v07.md): the page names the zones, reads
// the statistics and says why the zoning tools cannot be used now. The engine decides the rule,
// the costs and the caps. Pure: no DOM, so node:test can check it.
//
// The engine's statistics (City.density_stats): Int32Array [légères, moyennes, denses, fermes,
// emplois_agricoles], see STAT_COUNT below.

// The engine methods of the zoning by density. Without all of them there is no zoning tool at all.
export const METHODS = Object.freeze([
  "density_rules", "set_density_rules", "zone_preview", "place_zone", "density_layer", "density_stats",
]);

// Genres of the zones: the engine's number, the letter of the keys and ids, and the French name.
export const GENRES = Object.freeze([
  { genre: 1, letter: "r", name: "Résidentiel" },
  { genre: 2, letter: "c", name: "Commercial" },
  { genre: 3, letter: "i", name: "Industriel" },
]);

// Densities: the engine's number (1 légère, 2 moyenne, 3 dense), the key of the keys and ids, and the
// adjective, which agrees with the genre (masculine).
export const DENSITIES = Object.freeze([
  { density: 1, key: "leger", adjective: "léger" },
  { density: 2, key: "moyen", adjective: "moyen" },
  { density: 3, key: "dense", adjective: "dense" },
]);

// Numbers of density_stats, in this order: light zones, medium zones, dense zones, farms, farm jobs.
export const STAT_COUNT = 5;

// Why the zoning tools cannot be used now (the page shows it as the button's reason).
export const RULE_OFF_MESSAGE = "Activez les densités de zonage pour zoner par densité.";
export const IN_3D_MESSAGE = "Le zonage se pose sur la carte 2D : passez en vue 2D pour zoner";

/** Whether `city` has the zoning by density API. */
export function supportsZoning(city) {
  return METHODS.every((m) => typeof city?.[m] === "function");
}

/** The rule flag as the engine holds it now (false when the engine has no zoning by density). */
export function readRulesOn(city) {
  return supportsZoning(city) && Boolean(city.density_rules());
}

/** The genre record of a genre number (one of GENRES). */
export function genreInfo(genre) {
  return GENRES.find((g) => g.genre === genre);
}

/** The density record of a density number (one of DENSITIES). */
export function densityInfo(density) {
  return DENSITIES.find((d) => d.density === density);
}

/** Palette key of a zone, e.g. "zone_r_leger". */
export function zoneKey(genre, density) {
  return `zone_${genreInfo(genre).letter}_${densityInfo(density).key}`;
}

/** Palette id of a zone, e.g. "zoning:r:leger". */
export function zoneId(genre, density) {
  return `zoning:${genreInfo(genre).letter}:${densityInfo(density).key}`;
}

/** French label of a zone, e.g. "Résidentiel léger". */
export function zoneLabel(genre, density) {
  return `${genreInfo(genre).name} ${densityInfo(density).adjective}`;
}

// A count as the page shows it: a non-negative integer, 0 for anything else.
function count(n) {
  return Math.max(0, Math.trunc(Number(n)) || 0);
}

/**
 * Decodes density_stats into { light, medium, dense, farms, farmJobs }. Only the first STAT_COUNT
 * values are read; a missing value counts as 0, and so does a negative or non-numeric one.
 */
export function decodeStats(values) {
  const [light = 0, medium = 0, dense = 0, farms = 0, farmJobs = 0] = Array.from(values ?? [])
    .slice(0, STAT_COUNT)
    .map(count);
  return { light, medium, dense, farms, farmJobs };
}

const fmt = (n) => n.toLocaleString("fr-FR");

/** The statistics line under the switch (French), from decodeStats' result. */
export function statsText({ light, medium, dense, farms, farmJobs }) {
  return `Zones légères : ${fmt(light)} · moyennes : ${fmt(medium)} · denses : ${fmt(dense)} · ` +
    `fermes : ${fmt(farms)} (${fmt(farmJobs)} emplois agricoles)`;
}

/** The note under the statistics: what the switch does now (French). */
export function noteText(on) {
  return on
    ? "Choisissez un outil Zonage dans la palette : une zone ne grandit pas au-delà de sa densité."
    : "Désactivé : toutes les zones sont denses, sans plafond de croissance.";
}

/** Why the zoning tools cannot be used now, in French; "" when they can (or the engine has none). */
export function zoningBlockedReason(city, { in3d }) {
  if (!supportsZoning(city)) return "";
  if (!readRulesOn(city)) return RULE_OFF_MESSAGE;
  if (in3d) return IN_3D_MESSAGE;
  return "";
}
