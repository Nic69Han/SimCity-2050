// Public services advice (docs/game-design-v09.md): a low education level (EQ) or life expectancy, and full
// schools or hospitals, are a word in Urbanisme. Pure: no DOM, no engine calls. The finding objects have the
// shape advisors-model.js uses ({ severity, diagnosis, action }); the severity is written here so this file
// imports nothing (as advisors-rail.js does). Only read with the services rule: snapshot.services is set by
// advisors.js readSnapshot only then, and findings need snapshot.rules.services === true.

/** EQ below this is worth a word (attention). The engine's EQ runs 0..150. */
export const SERVICES_EQ_LOW = 60;
/** Life expectancy below this, in years, is worth a word (attention). The engine's life runs 40..90. */
export const SERVICES_LIFE_LOW = 60;
/** Severity of every services finding: a word, not an emergency. */
export const SERVICES_SEVERITY = "attention";

export const EDUCATION_LOW = Object.freeze({
  action: "Construisez des écoles et une bibliothèque.",
});
export const LIFE_LOW = Object.freeze({
  action: "Construisez une clinique ou un hôpital.",
});
export const SCHOOLS_FULL_ACTION = "Construisez une école ou un collège de plus.";
export const CARE_FULL_ACTION = "Construisez un hôpital de plus.";
export const FULL_DIAGNOSIS = "Les écoles (ou les hôpitaux) sont pleins.";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The services block of the snapshot when the rule is on, else null. */
function servicesOf(s) {
  if (s?.rules?.services !== true || !s.services || typeof s.services !== "object") return null;
  return s.services;
}

/** Finding for a low EQ, or null when EQ is at or above SERVICES_EQ_LOW (or unknown). */
function educationFinding(sv) {
  const eq = num(sv.eq);
  if (eq === null || eq >= SERVICES_EQ_LOW) return null;
  return { severity: SERVICES_SEVERITY, diagnosis: `Le niveau d'éducation est bas (EQ ${Math.trunc(eq)}).`, action: EDUCATION_LOW.action };
}

/** Finding for a low life expectancy, or null when it is at or above SERVICES_LIFE_LOW (or unknown). */
function lifeFinding(sv) {
  const life = num(sv.life);
  if (life === null || life >= SERVICES_LIFE_LOW) return null;
  return { severity: SERVICES_SEVERITY, diagnosis: `L'espérance de vie est basse (${Math.trunc(life)} ans).`, action: LIFE_LOW.action };
}

/**
 * Finding for full places: students above the school places, or patients above the care places. The action
 * names what is short; both when both are. Null when neither is over its places (or the numbers are unknown).
 */
function fullFinding(sv) {
  const students = num(sv.students);
  const schools = num(sv.schoolPlaces);
  const patients = num(sv.patients);
  const care = num(sv.carePlaces);
  const schoolsFull = students !== null && schools !== null && students > schools;
  const careFull = patients !== null && care !== null && patients > care;
  if (!schoolsFull && !careFull) return null;
  const action = [schoolsFull ? SCHOOLS_FULL_ACTION : "", careFull ? CARE_FULL_ACTION : ""].filter(Boolean).join(" ");
  return { severity: SERVICES_SEVERITY, diagnosis: FULL_DIAGNOSIS, action };
}

/**
 * The services findings for Urbanisme, in order: education, life expectancy, full places. An empty list when
 * the rule is off, when the snapshot has no services block, or when all is well. Total: any input gives a list.
 */
export function servicesFindings(s) {
  const sv = servicesOf(s);
  if (!sv) return [];
  return [educationFinding(sv), lifeFinding(sv), fullFinding(sv)].filter(Boolean);
}
