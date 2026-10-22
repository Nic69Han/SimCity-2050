// Economy advice (docs/game-design-v11.md): a shortage of goods, a tax rate that makes people leave, and more bonds than
// the city should carry are each one attention finding. Pure: no DOM, no engine calls. The finding objects have the shape
// advisors-model.js uses ({ severity, diagnosis, action }); the severity is written here so this file imports nothing
// from the advisors. Only read with the economy rule (snapshot.economy is set only then, see economy-model.js readEconomy).
import { formatInt } from "./budget-text.js";

/** Every economy finding is a word for the mayor, not an emergency. */
export const ECONOMY_SEVERITY = "attention";
/** A tax rate of at least this many percent makes the zone's people leave. */
export const TAX_LEAVE_RATE = 15;
/** More bonds than this in force: their interest weighs on the budget. */
export const MANY_BONDS = 5;

export const SHORTAGE_DIAGNOSIS = "Le commerce manque de marchandises.";
export const SHORTAGE_ACTION = "Zonez de l'industrie ou baissez ses impôts.";
export const TAX_ACTION = "Baissez les impôts les plus élevés pour retenir les habitants.";
export const BONDS_ACTION = "Remboursez les obligations dès que les caisses le permettent.";

const count = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);

/**
 * The economy numbers of the snapshot, { shortage, maxRate, bonds }, or null when the rule is off or the snapshot has no
 * economy block. maxRate is the highest of the nine tax rates; a missing or garbage number reads as 0.
 */
export function economyOf(s) {
  if (s?.rules?.economy !== true || !s.economy || typeof s.economy !== "object") return null;
  const rates = Array.isArray(s.economy.taxRates) ? s.economy.taxRates : [];
  return {
    shortage: s.economy.shortage === true,
    maxRate: rates.reduce((m, r) => Math.max(m, count(r)), 0),
    bonds: count(s.economy.bondCount),
  };
}

/** Shortage finding: the commerce lacks goods; null when it does not. */
export function shortageFinding(e) {
  if (!e.shortage) return null;
  return { severity: ECONOMY_SEVERITY, diagnosis: SHORTAGE_DIAGNOSIS, action: SHORTAGE_ACTION };
}

/** Tax finding: one rate of TAX_LEAVE_RATE percent or more makes people leave; null below it. */
export function taxFinding(e) {
  if (e.maxRate < TAX_LEAVE_RATE) return null;
  const diagnosis = `Un impôt atteint ${formatInt(e.maxRate)} % : des habitants quittent ces zones.`;
  return { severity: ECONOMY_SEVERITY, diagnosis, action: TAX_ACTION };
}

/** Bond finding: more than MANY_BONDS bonds in force; null otherwise. */
export function bondFinding(e) {
  if (e.bonds <= MANY_BONDS) return null;
  const diagnosis = `${formatInt(e.bonds)} obligations en cours : leurs intérêts pèsent sur le budget.`;
  return { severity: ECONOMY_SEVERITY, diagnosis, action: BONDS_ACTION };
}

/** The economy findings for the advisors, in order: shortage, taxes, bonds. An empty list when the rule is off or all is well. */
export function economyFindings(s) {
  const e = economyOf(s);
  if (!e) return [];
  return [shortageFinding(e), taxFinding(e), bondFinding(e)].filter(Boolean);
}
