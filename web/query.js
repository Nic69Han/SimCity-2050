// Zone status for the query tool (presentation only, ARCHITECTURE.md rule 5).
// `city.query(x, y)` returns [] when there is nothing to report, else
//   [category, density, land_value, crime, pollution, growth]
// (docs/tools-contract.md). The values are string-table indices of the C++ doZoneStatus:
// doZoneStatus stores `getDensity(cat) + 1` (STR202_* + 1, 1-based line numbers), and the
// category is `k + 1` where k is the position of the tile kind in its idArray. The
// category texts (stri.219) are not in the repository, so their French labels follow the
// order of the C++ category comment in tool.cpp (value v = comment entry v - 1).
// A value not listed here is shown as "inconnu" with its number: the page never crashes.

export const CATEGORY_LABELS = Object.freeze({
  1: "Terrain nu",
  2: "Eau",
  3: "Arbres",
  4: "Décombres",
  5: "Inondation",
  6: "Déchets radioactifs",
  7: "Incendie",
  8: "Route",
  9: "Ligne électrique",
  10: "Voie ferrée",
  11: "Zone résidentielle",
  12: "Zone commerciale",
  13: "Zone industrielle",
  14: "Port maritime",
  15: "Aéroport",
  16: "Centrale au charbon",
  17: "Caserne de pompiers",
  18: "Commissariat",
  19: "Stade",
  20: "Centrale nucléaire",
  21: "Pont-levant",
  22: "Radar",
  23: "Fontaine",
  24: "Zone industrielle",
  25: "Stade (animation)",
  26: "Pont-levant",
  27: "Centrale nucléaire (animation)",
  28: "Église",
  29: "Terrain nu", // what the C++ reports for dirt (its known bug, tool.cpp doZoneStatus)
});

// STR202 indices (text.h) + 1, per field of the status.
export const DENSITY_LABELS = Object.freeze({ 1: "faible", 2: "moyenne", 3: "élevée", 4: "très élevée" });
export const LAND_VALUE_LABELS = Object.freeze({ 5: "taudis", 6: "classe populaire", 7: "classe moyenne", 8: "aisée" });
export const CRIME_LABELS = Object.freeze({ 9: "sûr", 10: "léger", 11: "modéré", 12: "dangereux" });
export const POLLUTION_LABELS = Object.freeze({ 13: "aucune", 14: "modérée", 15: "forte", 16: "très forte" });
export const GROWTH_LABELS = Object.freeze({ 17: "en déclin", 18: "stable", 19: "croissance lente", 20: "croissance rapide" });

// Status fields in the order of the contract array (after the category): name and label table.
const FIELDS = Object.freeze([
  { name: "densité", table: DENSITY_LABELS },
  { name: "valeur du terrain", table: LAND_VALUE_LABELS },
  { name: "criminalité", table: CRIME_LABELS },
  { name: "pollution", table: POLLUTION_LABELS },
  { name: "croissance", table: GROWTH_LABELS },
]);

// Raw engine value -> French lines: first the category, then one "nom : valeur" line per
// field that is present. [] (or any non-array) -> [] (nothing to show).
export function formatZoneStatus(raw) {
  if (typeof raw === "string") return raw ? [raw] : [];
  if (raw === null || raw === undefined || typeof raw.length !== "number") return [];
  if (raw.length === 0) return [];
  const [category, ...fields] = Array.from(raw);
  const lines = [];
  if (Object.hasOwn(CATEGORY_LABELS, category)) lines.push(CATEGORY_LABELS[category]);
  else lines.push(`Type inconnu (${category})`);
  FIELDS.forEach((f, i) => {
    if (i >= fields.length) return;
    const v = fields[i];
    const label = Object.hasOwn(f.table, v) ? f.table[v] : `inconnu (${v})`;
    lines.push(`${f.name[0].toUpperCase()}${f.name.slice(1)} : ${label}`);
  });
  return lines;
}
