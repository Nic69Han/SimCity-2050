// Extended buildings, presentation side (docs/game-design-v04.md): the page reads the engine's
// catalog and rule flag, names the genres and says why they cannot be placed now. The engine
// decides what is allowed and what it costs. Pure: no DOM, so node:test can check it.
//
// The engine's catalog (City.structure_catalog): records of RECORD_LENGTH integers
// [genre, width, height, cost, upkeep, flags, radius, effect].

export const RECORD_LENGTH = 8;
// Most catalog records read in one go: a bounded loop, whatever the engine sends.
export const MAX_CATALOG_RECORDS = 32;

// French names of the genres of the milestone; the engine only knows numbers.
// The transport genres (docs/game-design-v05.md), the rail genre (docs/game-design-v06.md) and the waste
// genres (docs/game-design-v08.md) are named here too.
export const NAMES = Object.freeze({
  1: "Parc urbain", 2: "Place publique", 3: "Monument",
  10: "Arrêt de bus", 11: "Dépôt de bus", 12: "Dépôt de taxis", 13: "Gare",
  20: "Décharge", 21: "Incinérateur", 22: "Centre de recyclage", 23: "Usine de valorisation",
});

// French names of the public services genres 30-36 (docs/game-design-v09.md), kept apart from NAMES.
export const SERVICE_NAMES = Object.freeze({
  30: "École", 31: "Collège", 32: "Bibliothèque", 33: "Musée", 34: "Clinique", 35: "Hôpital", 36: "Prison",
});

// Why the buildings cannot be placed now (the page shows it as the button's reason).
export const RULE_OFF_MESSAGE = "Activez les bâtiments étendus pour construire.";
export const IN_3D_MESSAGE =
  "Les bâtiments se posent sur la carte 2D : passez en vue 2D pour les poser";

// The engine calls the buildings need. Without them there is no building tool at all.
const ENGINE_METHODS = Object.freeze([
  "structure_rules", "set_structure_rules", "structure_catalog", "structures",
  "structure_preview", "place_structure", "remove_structure",
]);

// The engine has the buildings: the rule flag and every call the page makes.
export function supportsStructures(city) {
  return ENGINE_METHODS.every((m) => typeof city?.[m] === "function");
}

// The rule flag as the engine holds it now (off when the engine has no buildings).
export function readStructureRules(city) {
  return supportsStructures(city) ? Boolean(city.structure_rules()) : false;
}

// French name of a genre; an unknown genre (a later engine) gets its number.
export function nameOf(genre) {
  return NAMES[genre] ?? SERVICE_NAMES[genre] ?? `Bâtiment n° ${genre}`;
}

// Decodes the catalog records into { genre, width, height, cost, upkeep, flags, radius, effect }.
// A trailing partial record is ignored, and so is a record with no room (width or height below 1):
// such a building cannot be placed.
export function decodeCatalog(records) {
  const src = records ?? [];
  const count = Math.min(Math.floor(src.length / RECORD_LENGTH), MAX_CATALOG_RECORDS);
  const out = [];
  for (let i = 0; i < count; i++) {
    const at = i * RECORD_LENGTH;
    const [genre, width, height, cost, upkeep, flags, radius, effect] = Array.from(src.slice(at, at + RECORD_LENGTH));
    if (width < 1 || height < 1) continue;
    out.push({ genre, width, height, cost, upkeep, flags, radius, effect });
  }
  return out;
}

// The upkeep line of a button: "+ N $/mois" (N formatted like the other prices of the palette).
export function upkeepText(upkeep) {
  return `+ ${Number(upkeep).toLocaleString("fr-FR")} $/mois`;
}

// Why the buildings cannot be used now, in French; "" when they can (or the engine has none).
// The flag is read from the engine, so the answer is right even before the page relays a change.
export function structuresBlockedReason(city, { in3d }) {
  if (!supportsStructures(city)) return "";
  if (!readStructureRules(city)) return RULE_OFF_MESSAGE;
  if (in3d) return IN_3D_MESSAGE;
  return "";
}
