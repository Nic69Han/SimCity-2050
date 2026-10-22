// Economy, presentation side (docs/game-design-v11.md): the page says whether the engine has the economy rule, reads
// the nine tax rates, their yearly income, the bonds and the goods, and names them. The engine decides the rule, the
// rates, the bonds and the goods. Pure: no DOM, no engine calls except readEconomy (a read of the engine's getters),
// so node:test can check it. Tested by web/test/economy-model.test.mjs.
//
// Engine layouts (crates/micropolis-wasm/src/economy.rs):
// - tax_rates() and tax_income(): nine integers, index (genre - 1) * 3 + (richesse - 1): residential, commercial,
//   industrial; modest, average, wealthy. A rate is a whole percent 0..=20.
// - bonds(): records of BOND_FIELDS integers [amount, permille, years]; permille is a rate per thousand (30 = 3,0 %).
// - bond_offer(): [amount, permille] of the next bond, [0, 0] when none can be issued.
// - goods_stats(): [produced, consumed, exported, imported, net revenue, shortage (0/1)] of the last year.

import { formatInt, formatMoney } from "./budget-text.js";

const NBSP = " ";

// The engine methods of the economy. Without all of them there is no economy panel.
export const METHODS = Object.freeze([
  "economy_rules", "set_economy_rules", "tax_rates", "set_tax_rate", "tax_income", "bonds", "bond_offer",
  "issue_bond", "repay_bond", "goods_stats",
]);

// The rows (genres) and the columns (wealth classes) of the tax table, in the engine's numbering.
export const GENRES = Object.freeze([
  Object.freeze({ id: 1, label: "Résidentiel" }),
  Object.freeze({ id: 2, label: "Commercial" }),
  Object.freeze({ id: 3, label: "Industriel" }),
]);
export const CLASSES = Object.freeze([
  Object.freeze({ id: 1, label: "Modeste" }),
  Object.freeze({ id: 2, label: "Moyenne" }),
  Object.freeze({ id: 3, label: "Aisée" }),
]);
// Cells of the tax table, and the highest rate the engine takes (percent).
export const TAX_CELLS = 9;
export const MAX_TAX_RATE = 20;
// Integers per bond record (bonds()) and the most records read in one go: a bounded loop.
export const BOND_FIELDS = 3;
export const MAX_BOND_RECORDS = 16;
// Integers per goods_stats() answer.
export const GOODS_FIELDS = 6;
// Per mille: the rate of a bond is shown with one decimal (30 -> "3,0 %").
export const PERMILLE_PER_PERCENT = 10;

export const RULE_OFF_NOTE = "Désactivé : un impôt unique, pas d'obligations ni de marchandises.";
export const RULE_ON_NOTE =
  "Chaque zone paie ses impôts selon sa richesse. Les obligations financent les grands travaux ; le commerce achète et vend des marchandises.";
export const NO_BONDS_TEXT = "Aucune obligation en cours.";
export const ISSUE_LABEL = "Émettre une obligation";
export const SHORTAGE_TEXT = "Pénurie de marchandises";
export const REFUSED_TAX_TEXT = "Taux refusé : un nombre entier de 0 à 20, la règle étant active.";
const RULE_NEEDED = "Règle désactivée : activez « Économie détaillée ».";

// Result codes of issue_bond and repay_bond: 1 done, 0 rule off, -1 refused (cap, funds or index).
const ISSUE_MESSAGE = Object.freeze({
  1: "Obligation émise : les fonds sont versés.",
  0: RULE_NEEDED,
  "-1": "Impossible d'émettre : le plafond d'obligations est atteint.",
});
const REPAY_MESSAGE = Object.freeze({
  1: "Obligation remboursée.",
  0: RULE_NEEDED,
  "-1": "Remboursement impossible : fonds insuffisants ou obligation inconnue.",
});

/** Whether `city` has the economy API (all of METHODS). */
export function supports(city) {
  return METHODS.every((m) => typeof city?.[m] === "function");
}

/** The rule flag as the engine holds it now (false when the engine has no economy). */
export function readRulesOn(city) {
  return supports(city) && Boolean(city.economy_rules());
}

// A count as the page shows it: a non-negative integer, 0 for anything else.
const count = (n) => Math.max(0, Math.trunc(Number(n)) || 0);
const int = (n) => Math.trunc(Number(n)) || 0;

/** The cell index of the nine-value arrays: genre 1..3, richesse 1..3. */
export function cellIndex(genre, richesse) {
  return (genre - 1) * CLASSES.length + (richesse - 1);
}

/** A tax rate from the engine's array, clamped to 0..=MAX_TAX_RATE; nine cells, a missing one is 0. */
export function decodeRates(values) {
  const v = Array.from(values ?? []).slice(0, TAX_CELLS);
  return Array.from({ length: TAX_CELLS }, (_, i) => Math.min(MAX_TAX_RATE, count(v[i])));
}

/** The yearly income per cell, from tax_income(): nine counts, a missing one is 0. */
export function decodeIncome(values) {
  const v = Array.from(values ?? []).slice(0, TAX_CELLS);
  return Array.from({ length: TAX_CELLS }, (_, i) => count(v[i]));
}

/**
 * Parses the text of a tax input: a whole number from 0 to MAX_TAX_RATE, or null (the page then sends nothing).
 * Spaces around the number are allowed; a decimal, a letter or an empty text is refused.
 */
export function parseRate(text) {
  const s = String(text ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_TAX_RATE ? n : null;
}

/** Decodes bonds() into [{ amount, permille, years }], at most MAX_BOND_RECORDS, a truncated record ignored. */
export function decodeBonds(flat) {
  const src = Array.from(flat ?? []);
  const out = [];
  for (let at = 0; at + BOND_FIELDS <= src.length && out.length < MAX_BOND_RECORDS; at += BOND_FIELDS) {
    out.push({ amount: count(src[at]), permille: count(src[at + 1]), years: count(src[at + 2]) });
  }
  return out;
}

/** Decodes bond_offer() into { amount, permille, available }; available only when the amount is above 0. */
export function decodeOffer(values) {
  const [amount = 0, permille = 0] = Array.from(values ?? []).map(count);
  return { amount, permille, available: amount > 0 };
}

/** Decodes goods_stats() into the named record; the net revenue is signed, the shortage is 1 or 0. */
export function decodeGoods(values) {
  const v = Array.from(values ?? []).slice(0, GOODS_FIELDS);
  const [produced = 0, consumed = 0, exported = 0, imported = 0, net = 0, shortage = 0] = v;
  return {
    produced: count(produced),
    consumed: count(consumed),
    exported: count(exported),
    imported: count(imported),
    netRevenue: int(net),
    shortage: int(shortage) === 1 ? 1 : 0,
  };
}

/** A per mille rate as a percent with one decimal and a French comma: 30 -> "3,0 %", 125 -> "12,5 %". */
export function percentText(permille) {
  const p = count(permille);
  const whole = Math.floor(p / PERMILLE_PER_PERCENT);
  return `${formatInt(whole)},${p % PERMILLE_PER_PERCENT}${NBSP}%`;
}

/** A tax rate as the table shows it: "7 %". */
export function rateText(rate) {
  return `${formatInt(count(rate))}${NBSP}%`;
}

/** A yearly income: "1 200 $ par an". */
export function incomeText(income) {
  return `${formatMoney(count(income))} par an`;
}

/** One bond line (French): "Obligation de 10 000 $ à 3,0 %, depuis 2 ans" ("an" for 0 or 1 year). */
export function bondLine(b) {
  const years = count(b.years);
  return `Obligation de ${formatMoney(b.amount)} à ${percentText(b.permille)}, depuis ${formatInt(years)} ${years <= 1 ? "an" : "ans"}`;
}

/** The label of the issue button: the offer's amount and rate, or the bare label when no bond can be issued. */
export function offerLabel(offer) {
  if (!offer.available) return ISSUE_LABEL;
  return `${ISSUE_LABEL} (${formatMoney(offer.amount)} à ${percentText(offer.permille)})`;
}

/** The goods lines under the tax table (French), in a fixed order; the shortage line only when the flag is 1. */
export function goodsLines(g) {
  const lines = [
    `Marchandises produites : ${formatInt(g.produced)}`,
    `Marchandises consommées : ${formatInt(g.consumed)}`,
    `Marchandises exportées : ${formatInt(g.exported)}`,
    `Marchandises importées : ${formatInt(g.imported)}`,
    `Recette nette du commerce : ${formatMoney(g.netRevenue)}`,
  ];
  if (g.shortage === 1) lines.push(SHORTAGE_TEXT);
  return lines;
}

/** The note under the panel title: what the switch does now (French). */
export function ruleNote(on) {
  return on ? RULE_ON_NOTE : RULE_OFF_NOTE;
}

/** The status line after an issue (issue_bond's code); "" for an unknown code. */
export function issueMessage(code) {
  return ISSUE_MESSAGE[code] ?? "";
}

/** The status line after a repayment (repay_bond's code); "" for an unknown code. */
export function repayMessage(code) {
  return REPAY_MESSAGE[code] ?? "";
}

/** The status line after a tax change: the engine's answer (set_tax_rate returns a boolean). */
export function taxMessage(ok) {
  return ok ? "Taux enregistré." : REFUSED_TAX_TEXT;
}

/**
 * What the advisors read (advisors-economy.js), from the engine: whether goods are short, the nine tax rates and the
 * number of bonds in force. Reads only the engine's getters; the caller reads it only with the economy rule on.
 */
export function readEconomy(city) {
  return {
    shortage: decodeGoods(city.goods_stats()).shortage === 1,
    taxRates: decodeRates(city.tax_rates()),
    bondCount: decodeBonds(city.bonds()).length,
  };
}
