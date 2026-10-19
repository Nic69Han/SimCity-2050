// Waste, presentation side (docs/game-design-v08.md): the page names the statistics, says whether the rule
// is on, and words the environment advice about the garbage left on the map. The engine decides the rule,
// the production, the treatment and the landfill capacity. Pure: no DOM, no engine calls, so node:test
// can check it. The advisors (advisors-model.js) call wasteFindings() for the environment advisor.
import { formatInt } from "./budget-text.js";

// The engine methods of the waste. Without all of them there is no waste panel.
export const METHODS = Object.freeze(["waste_rules", "set_waste_rules", "waste_stats", "waste_layer"]);

// waste_stats() = Int32Array [produits_par_mois, traités_par_mois, recyclés_par_mois, exportés_par_mois,
// accumulés_total, capacité_décharges_restante, électricité_produite].
export const STAT_COUNT = 7;

// Genre of the landfill (the engine's number, docs/game-design-v08.md); the other waste genres are 21-23.
export const GENRE_LANDFILL = 20;

// Record of City.structures(): [genre, x, y, width, height, state].
export const STRUCTURE_RECORD = 6;

// Garbage left on the map (accumulated) from which the environment advice is urgent; any garbage at all is
// worth a word (attention).
export const WASTE_URGENT = 500;

/** Whether `city` has the waste API. */
export function supports(city) {
  return METHODS.every((m) => typeof city?.[m] === "function");
}

// A count as the page shows it: a non-negative integer, 0 for anything else.
const count = (n) => Math.max(0, Math.trunc(Number(n)) || 0);

/**
 * Decodes waste_stats into { produced, treated, recycled, exported, accumulated, landfillLeft, power }.
 * Only the first STAT_COUNT values are read; a missing value counts as 0, and so does a negative one.
 */
export function decodeStats(values) {
  const [produced = 0, treated = 0, recycled = 0, exported = 0, accumulated = 0, landfillLeft = 0, power = 0] =
    Array.from(values ?? []).slice(0, STAT_COUNT).map(count);
  return { produced, treated, recycled, exported, accumulated, landfillLeft, power };
}

/** The statistics rows under the switch (French), one line each, in the engine's order. */
export function statsLines(st) {
  return [
    `Produits par mois : ${formatInt(st.produced)}`,
    `Traités par mois : ${formatInt(st.treated)}`,
    `Recyclés par mois : ${formatInt(st.recycled)}`,
    `Exportés par mois : ${formatInt(st.exported)}`,
    `Accumulés sur la carte : ${formatInt(st.accumulated)}`,
    `Capacité des décharges restante : ${formatInt(st.landfillLeft)}`,
    `Électricité produite : ${formatInt(st.power)}`,
  ];
}

/** The note under the statistics: what the switch does now (French). */
export function noteText(on) {
  return on
    ? "Les zones produisent des déchets : une décharge, un incinérateur, un centre de recyclage ou une usine de valorisation les traitent."
    : "Désactivé : les zones ne produisent pas de déchets.";
}

/** Number of landfills in City.structures() records (flat, STRUCTURE_RECORD numbers each); bounded by the data. */
export function countLandfills(records) {
  const src = records ?? [];
  let n = 0;
  for (let at = 0; at + STRUCTURE_RECORD <= src.length; at += STRUCTURE_RECORD) {
    if (Number(src[at]) === GENRE_LANDFILL) n++;
  }
  return n;
}

/**
 * The waste block of the advisors' snapshot: { accumulated, landfillLeft, landfills } from waste_stats and the
 * placed buildings. Missing numbers read as 0.
 */
export function wasteSnapshot(statsValues, structureRecords) {
  const st = decodeStats(statsValues);
  return { accumulated: st.accumulated, landfillLeft: st.landfillLeft, landfills: countLandfills(structureRecords) };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The waste block of a snapshot, or null unless the waste rule is exactly on and the block is present. */
export function wasteOf(s) {
  if (s?.rules?.waste !== true || !s.waste || typeof s.waste !== "object") return null;
  return { accumulated: num(s.waste.accumulated), landfillLeft: num(s.waste.landfillLeft), landfills: num(s.waste.landfills) };
}

/**
 * Environment findings of the waste (same shape as advisors-model.js: { severity, diagnosis, action }):
 * garbage on the map is attention, and urgent from WASTE_URGENT; landfills that take nothing more are attention.
 * Nothing while the rule is off or the block is absent.
 */
export function wasteFindings(s) {
  const w = wasteOf(s);
  if (!w) return [];
  const out = [];
  const remedy = "Construisez une décharge, un incinérateur ou un centre de recyclage.";
  if (w.accumulated > 0) {
    out.push({
      severity: w.accumulated >= WASTE_URGENT ? "urgent" : "attention",
      diagnosis: `Les ordures non ramassées s'accumulent : ${formatInt(w.accumulated)} sur la carte. Elles polluent et font baisser la valeur des terrains.`,
      action: remedy,
    });
  }
  if (w.landfills > 0 && w.landfillLeft === 0) {
    out.push({
      severity: "attention",
      diagnosis: "Les décharges sont pleines.",
      action: "Construisez une nouvelle décharge ou traitez les déchets par un incinérateur ou un centre de recyclage.",
    });
  }
  return out;
}
