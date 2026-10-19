// Rail advice (docs/game-design-v06.md): a train or metro line that carries no rider this month is worth a
// word in Urbanisme. Pure: no DOM, no engine calls. The finding objects have the shape advisors-model.js
// uses ({ severity, diagnosis, action }); the severity is written here so this file imports nothing.
// Only read with the agents rule (snapshot.rail is set by advisors.js readSnapshot only then).

/** Severity of an idle line (a line with no rider this month is a warning, not an emergency). */
export const RAIL_IDLE_SEVERITY = "attention";

export const TRAIN_IDLE = Object.freeze({
  diagnosis: "Les trains roulent à vide.",
  action: "Placez les gares près des quartiers résidentiels et des zones d'emploi.",
});
export const METRO_IDLE = Object.freeze({
  diagnosis: "Le métro roule à vide.",
  action: "Rapprochez les stations des quartiers sans voiture.",
});

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The rail counts of the snapshot, { trainLines, trainRiders, metroLines, metroRiders }, or null when the
 * rule is off or the snapshot has no rail block. A missing or garbage count reads as 0.
 */
export function railOf(s) {
  if (s?.rules?.agents !== true || !s.rail || typeof s.rail !== "object") return null;
  const r = s.rail;
  return { trainLines: num(r.trainLines), trainRiders: num(r.trainRiders), metroLines: num(r.metroLines), metroRiders: num(r.metroRiders) };
}

/** The findings for idle lines: a train line with no train rider, and a metro line with no metro rider. */
export function railFindings(s) {
  const r = railOf(s);
  if (!r) return [];
  const out = [];
  if (r.trainLines > 0 && r.trainRiders === 0) out.push({ severity: RAIL_IDLE_SEVERITY, ...TRAIN_IDLE });
  if (r.metroLines > 0 && r.metroRiders === 0) out.push({ severity: RAIL_IDLE_SEVERITY, ...METRO_IDLE });
  return out;
}
