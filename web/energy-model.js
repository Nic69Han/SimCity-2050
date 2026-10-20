// Energy, presentation side (docs/game-design-v10.md): the page says whether the engine has the energy rule,
// reads its statistics and its power plants, names them and says what the rule does. The engine decides the
// rule, the power, the ageing and the purchases. Pure: no DOM, so node:test can check it.
//
// The engine's statistics (City.energy_stats): Int32Array [production, consumption, bought, plants,
// plants_at_end_of_life, air_pollution], see FIELDS below.
// The engine's plants (City.power_plants): records of PLANT_LENGTH integers
// [genre, x, y, age_months, lifetime_months, current_power]; genre 0 coal, 1 nuclear, 40-46 the new plants.

import { formatInt } from "./budget-text.js";
import { nameOf } from "./structures-model.js";

// The engine methods of the energy. Without all of them there is no energy panel.
export const METHODS = Object.freeze(["energy_rules", "set_energy_rules", "energy_stats", "power_plants"]);

// Numbers of energy_stats, in this order (the names are the keys of decodeStats' result).
export const FIELDS = Object.freeze(["production", "consumption", "bought", "plants", "endOfLife", "pollution"]);
export const STAT_COUNT = FIELDS.length;
// Integers per power plant record (City.power_plants).
export const PLANT_LENGTH = 6;
// Most plants read in one go: a bounded loop, whatever the engine sends.
export const MAX_PLANTS = 256;
// The age of a plant is shown in whole years.
export const MONTHS_PER_YEAR = 12;
// A plant's power is a percentage: the decoded value never goes above this.
export const MAX_PERCENT = 100;

// The two classic plants (not in the structures catalog): coal and nuclear.
const CLASSIC_NAMES = Object.freeze({ 0: "Centrale à charbon", 1: "Centrale nucléaire" });

export const NO_PLANTS_TEXT = "Aucune centrale posée.";
// Why the rule is off or on, as the note under the statistics (French).
export const RULE_OFF_NOTE = "Désactivé : seules les centrales à charbon et nucléaire existent.";
export const RULE_ON_NOTE =
  "Les centrales vieillissent : remplacez-les avant leur fin de vie. Vous pouvez aussi acheter de l'électricité aux voisins.";

/** Whether `city` has the energy API (all of METHODS). */
export function supports(city) {
  return METHODS.every((m) => typeof city?.[m] === "function");
}

/** The rule flag as the engine holds it now (false when the engine has no energy). */
export function readRulesOn(city) {
  return supports(city) && Boolean(city.energy_rules());
}

// A count as the page shows it: a non-negative integer, 0 for anything else.
const count = (n) => Math.max(0, Math.trunc(Number(n)) || 0);
const int = (n) => Math.trunc(Number(n)) || 0;
// A percentage: a count, at most MAX_PERCENT.
const percent = (n) => Math.min(MAX_PERCENT, count(n));

/**
 * Decodes energy_stats into the record named by FIELDS. Only the first STAT_COUNT values are read; a missing
 * or non-numeric value counts as 0, and so does a negative one.
 */
export function decodeStats(values) {
  const v = Array.from(values ?? []).slice(0, STAT_COUNT).map(count);
  const [production = 0, consumption = 0, bought = 0, plants = 0, endOfLife = 0, pollution = 0] = v;
  return { production, consumption, bought, plants, endOfLife, pollution };
}

/**
 * Decodes power_plants into [{ genre, x, y, ageMonths, lifetimeMonths, power }], one per record of PLANT_LENGTH
 * integers, at most MAX_PLANTS. A truncated last record is ignored; the power is a percentage (MAX_PERCENT).
 */
export function decodePlants(flat) {
  const src = flat ?? [];
  const out = [];
  for (let at = 0; at + PLANT_LENGTH <= src.length && out.length < MAX_PLANTS; at += PLANT_LENGTH) {
    out.push({
      genre: int(src[at]),
      x: int(src[at + 1]),
      y: int(src[at + 2]),
      ageMonths: count(src[at + 3]),
      lifetimeMonths: count(src[at + 4]),
      power: percent(src[at + 5]),
    });
  }
  return out;
}

/** Whole years of a plant's age, from months (a month under a year is 0 years). */
export function ageYears(ageMonths) {
  return Math.floor(count(ageMonths) / MONTHS_PER_YEAR);
}

/** The French name of a plant: the classic two, else the structures catalog name of its genre. */
export function plantName(genre) {
  return CLASSIC_NAMES[genre] ?? nameOf(genre);
}

/** One plant line (French): "Centrale au gaz : âge 3 ans, puissance 100 %". */
export function plantLine(p) {
  const years = ageYears(p.ageMonths);
  return `${plantName(p.genre)} : âge ${formatInt(years)} ${years === 1 ? "an" : "ans"}, puissance ${formatInt(p.power)} %`;
}

/** The plant lines of the panel, or the one line «Aucune centrale posée.» for an empty list. */
export function plantsLines(list) {
  return list.length === 0 ? [NO_PLANTS_TEXT] : list.map(plantLine);
}

/** The statistics lines under the switch (French), from decodeStats' result, in a fixed order. */
export function statsLines(s) {
  return [
    `Production : ${formatInt(s.production)}`,
    `Consommation : ${formatInt(s.consumption)}`,
    `Achetée aux voisins : ${formatInt(s.bought)}`,
    `Centrales : ${formatInt(s.plants)}`,
    `Centrales en fin de vie : ${formatInt(s.endOfLife)}`,
    `Pollution de l'air produite : ${formatInt(s.pollution)}`,
  ];
}

/** The note under the statistics: what the switch does now (French). */
export function noteText(on) {
  return on ? RULE_ON_NOTE : RULE_OFF_NOTE;
}
