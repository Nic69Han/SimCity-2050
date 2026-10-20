// Public services, presentation side (docs/game-design-v09.md): the page says whether the engine has the
// services, reads their statistics, names the coverage views and says what the rule does. The engine decides
// the rule, the capacities, the coverage and the effects. Pure: no DOM, so node:test can check it.
//
// The engine's statistics (City.service_stats): Int32Array [eq, life, students, school_places, patients,
// care_places, inmates, prison_places, education_pct, health_pct], see FIELDS below.

import { COVERAGE_KIND } from "./map-layer-coverage-model.js";

// The engine methods of the public services. Without all of them there is no services panel.
export const METHODS = Object.freeze(["service_rules", "set_service_rules", "service_stats"]);

// Numbers of service_stats, in this order (the names are the keys of decodeStats' result).
export const FIELDS = Object.freeze([
  "eq", "life", "students", "schoolPlaces", "patients", "carePlaces", "inmates", "prisonPlaces",
  "educationPct", "healthPct",
]);
export const STAT_COUNT = FIELDS.length;
// A coverage is a percentage: the decoded value never goes above this.
export const MAX_PERCENT = 100;

// The coverage views of the panel: the value of the option (its key), the coverage kind sent to
// setCoverageView (the numeric kind of the engine's contract, or null for none) and the French label.
// The key "" is «Aucune».
export const VIEWS = Object.freeze([
  { key: "", label: "Aucune", kind: null },
  { key: "education", label: "Éducation", kind: COVERAGE_KIND.EDUCATION },
  { key: "health", label: "Santé", kind: COVERAGE_KIND.HEALTH },
  { key: "security", label: "Sécurité", kind: COVERAGE_KIND.SAFETY },
]);

// Why the rule is off or on, as the note under the statistics (French).
export const RULE_OFF_NOTE = "Désactivé : les services publics n'ont aucun effet sur la ville.";
export const RULE_ON_NOTE =
  "Posez écoles, bibliothèques, cliniques ou prisons : elles agissent sur la ville une fois construites.";

/** Whether `city` has the public services API (all of METHODS). */
export function supports(city) {
  return METHODS.every((m) => typeof city?.[m] === "function");
}

/** The rule flag as the engine holds it now (false when the engine has no services). */
export function readRulesOn(city) {
  return supports(city) && Boolean(city.service_rules());
}

// A count as the page shows it: a non-negative integer, 0 for anything else.
const count = (n) => Math.max(0, Math.trunc(Number(n)) || 0);
// A percentage: a count, at most MAX_PERCENT.
const percent = (n) => Math.min(MAX_PERCENT, count(n));

/**
 * Decodes service_stats into the record named by FIELDS. Only the first STAT_COUNT values are read; a missing
 * or non-numeric value counts as 0, a negative one too, and a percentage is capped at MAX_PERCENT.
 */
export function decodeStats(values) {
  const v = Array.from(values ?? []).slice(0, STAT_COUNT);
  return {
    eq: count(v[0]),
    life: count(v[1]),
    students: count(v[2]),
    schoolPlaces: count(v[3]),
    patients: count(v[4]),
    carePlaces: count(v[5]),
    inmates: count(v[6]),
    prisonPlaces: count(v[7]),
    educationPct: percent(v[8]),
    healthPct: percent(v[9]),
  };
}

const fmt = (n) => n.toLocaleString("fr-FR");

/** The statistics lines under the switch (French), from decodeStats' result, in a fixed order. */
export function statsLines(s) {
  return [
    `Niveau d'éducation (EQ) : ${fmt(s.eq)}`,
    `Espérance de vie : ${fmt(s.life)} ans`,
    `Écoles : ${fmt(s.students)} / ${fmt(s.schoolPlaces)} élèves`,
    `Hôpitaux et cliniques : ${fmt(s.patients)} / ${fmt(s.carePlaces)} patients`,
    `Prison : ${fmt(s.inmates)} / ${fmt(s.prisonPlaces)} détenus`,
    `Couverture éducation : ${fmt(s.educationPct)} %`,
    `Couverture santé : ${fmt(s.healthPct)} %`,
  ];
}

/** The note under the statistics: what the switch does now (French). */
export function noteText(on) {
  return on ? RULE_ON_NOTE : RULE_OFF_NOTE;
}

/** The coverage kind (0 education, 1 health, 2 security) of a select value; null for «Aucune» or an unknown key. */
export function viewKind(key) {
  const v = VIEWS.find((x) => x.key === key);
  return v ? v.kind : null;
}
