// Energy advice (docs/game-design-v10.md): a deficit (consumption above production) is urgent, and plants past
// 80 % of their life are worth a word (attention). Pure: no DOM, no engine calls. The finding objects have the
// shape advisors-model.js uses ({ severity, diagnosis, action }); the severities are written here so this file
// imports nothing from the advisors. Only read with the energy rule (snapshot.energy is set by advisors.js
// readSnapshot only then).
import { formatInt } from "./budget-text.js";

/** A deficit is urgent: the lights go out. */
export const ENERGY_DEFICIT_SEVERITY = "urgent";
/** Plants at the end of their life are a word, not an emergency. */
export const ENERGY_AGING_SEVERITY = "attention";

export const DEFICIT_ACTION = "Construisez une centrale ou achetez de l'électricité aux voisins.";
export const AGING_ACTION = "Remplacez les centrales en fin de vie avant qu'elles ne s'arrêtent.";

const count = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);

/**
 * The energy numbers of the snapshot, { production, consumption, endOfLife }, or null when the rule is off or the
 * snapshot has no energy block. A missing, garbage or negative number reads as 0.
 */
export function energyOf(s) {
  if (s?.rules?.energy !== true || !s.energy || typeof s.energy !== "object") return null;
  return { production: count(s.energy.production), consumption: count(s.energy.consumption), endOfLife: count(s.energy.endOfLife) };
}

/** Deficit finding: consumption above production, urgent; null when production covers consumption. */
export function deficitFinding(e) {
  if (e.consumption <= e.production) return null;
  const diagnosis = `Il manque de l'électricité : consommation ${formatInt(e.consumption)}, production ${formatInt(e.production)}.`;
  return { severity: ENERGY_DEFICIT_SEVERITY, diagnosis, action: DEFICIT_ACTION };
}

/** Ageing finding: one plant or more past 80 % of its life (attention); null when none is. */
export function agingFinding(e) {
  if (e.endOfLife <= 0) return null;
  const diagnosis = e.endOfLife === 1
    ? "Une centrale approche de la fin de sa vie."
    : `${formatInt(e.endOfLife)} centrales approchent de la fin de leur vie.`;
  return { severity: ENERGY_AGING_SEVERITY, diagnosis, action: AGING_ACTION };
}

/** The energy findings for Urbanisme, in order: deficit, then ageing. An empty list when the rule is off or all is well. */
export function energyFindings(s) {
  const e = energyOf(s);
  if (!e) return [];
  return [deficitFinding(e), agingFinding(e)].filter(Boolean);
}
