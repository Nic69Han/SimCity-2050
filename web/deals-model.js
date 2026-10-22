// Pure model of the deals panel (docs/game-design-v02b.md, "Accords avec les voisins"). The engine
// gives indices and numbers only (City.deal_offers, active_deals, surplus...); the French names and
// sentences live here. No DOM, no engine access: node --test checks it alone
// (web/test/deals-model.test.mjs).
import { formatInt, formatMoney } from "./budget-text.js";

const MINUS = "−";

/** Engine method names the panel needs; a build without them keeps the panel hidden. */
export const REQUIRED = [
  "deals_rules", "set_deals_rules", "deal_offers", "active_deals", "accept_deal", "cancel_deal", "surplus",
];

/** The four neighbouring cities, by the engine's index (0 north, 1 east, 2 south, 3 west). */
export const NEIGHBOURS = Object.freeze(["Valmont (nord)", "Port-Aurore (est)", "Saint-Élan (sud)", "Hautebrise (ouest)"]);

/** The resources, by the engine's index. Resource 2 (waste) is exported: the city pays for it (docs/game-design-v08.md),
 *  so its price is negative in the engine and shown as a cost. */
export const RESOURCES = Object.freeze([
  { label: "Électricité", noun: "d'électricité" },
  { label: "Eau", noun: "d'eau" },
  { label: "Déchets", noun: "de déchets" },
  { label: "Achat d'électricité", noun: "d'électricité" },
]);

/** The waste resource: an export, the city pays the price and the deal's income is a cost. */
export const WASTE_RESOURCE = 2;
/** The electricity purchase (docs/game-design-v10.md): the city pays the neighbour, like the waste export. */
export const POWER_BUY_RESOURCE = 3;
const PAID = new Set([WASTE_RESOURCE, POWER_BUY_RESOURCE]);

/** Whether the city pays for this resource (an export or a purchase): its price is negative in the engine. */
export function isPaid(resource) {
  return PAID.has(Number(resource) | 0);
}

/** Numbers per record of deal_offers / active_deals (see crates/micropolis-wasm/src/deals.rs). */
export const OFFER_LEN = 6;
export const DEAL_LEN = 7;

/** Result codes of accept_deal / cancel_deal. */
export const CODE = Object.freeze({ DONE: 1, INVALID: 0, RULES_OFF: -1, ALREADY: -2, NO_SURPLUS: -3, FULL: -4 });

const CODE_TEXT = Object.freeze({
  [CODE.INVALID]: "Cet accord n'existe pas.",
  [CODE.RULES_OFF]: "Les accords sont désactivés.",
  [CODE.ALREADY]: "Un accord existe déjà avec cette ville pour cette ressource.",
  [CODE.NO_SURPLUS]: "Surplus insuffisant pour honorer cet accord.",
  [CODE.FULL]: "Trop d'accords en cours.",
});

/** Why an offer cannot be signed (empty when it can, or for an unknown code). */
export function reasonText(code) {
  return CODE_TEXT[code] ?? "";
}

/** Whether `city` has the whole deals API. */
export function supports(city) {
  return REQUIRED.every((m) => typeof city?.[m] === "function");
}

const int = (v) => Number(v) | 0;

/** Name of neighbour `n`; a number for an unknown index. */
export function neighbourName(n) {
  return NEIGHBOURS[n] ?? `Ville voisine ${n}`;
}

function resourceOf(r) {
  return RESOURCES[r] ?? { label: `Ressource ${r}`, noun: `de la ressource ${r}` };
}

/** Records of deal_offers as [{ index, neighbour, resource, amount, price, income, status }]. */
export function decodeOffers(flat) {
  const a = flat ?? [];
  const out = [];
  for (let o = 0; o + OFFER_LEN <= a.length; o += OFFER_LEN) {
    out.push({
      index: o / OFFER_LEN, neighbour: int(a[o]), resource: int(a[o + 1]), amount: int(a[o + 2]),
      price: int(a[o + 3]), income: int(a[o + 4]), status: int(a[o + 5]),
    });
  }
  return out;
}

/** Records of active_deals as [{ index, neighbour, resource, amount, price, income, covered, penalty }]. */
export function decodeDeals(flat) {
  const a = flat ?? [];
  const out = [];
  for (let o = 0; o + DEAL_LEN <= a.length; o += DEAL_LEN) {
    out.push({
      index: o / DEAL_LEN, neighbour: int(a[o]), resource: int(a[o + 1]), amount: int(a[o + 2]),
      price: int(a[o + 3]), income: int(a[o + 4]), covered: int(a[o + 5]) !== 0, penalty: int(a[o + 6]),
    });
  }
  return out;
}

/** A signed whole number with a true minus sign: -20 -> "−20". */
export function formatUnits(n) {
  const v = int(n);
  return (v < 0 ? MINUS : "") + formatInt(Math.abs(v));
}

/** "100 unités d'électricité par an à 5 $ l'unité" (the terms of an offer or a deal). An export (waste) reads
 *  "100 unités de déchets par an : la ville paie 5 $ l'unité". */
export function termsText(t) {
  const r = resourceOf(t.resource);
  if (isPaid(t.resource)) {
    return `${formatUnits(t.amount)} unités ${r.noun} par an : la ville paie ${formatMoney(Math.abs(int(t.price)))} l'unité`;
  }
  return `${formatUnits(t.amount)} unités ${r.noun} par an à ${formatMoney(t.price)} l'unité`;
}

/** Title of a row: "Valmont (nord) · Électricité". */
export function titleText(t) {
  return `${neighbourName(t.neighbour)} · ${resourceOf(t.resource).label}`;
}

/** "Recette : 500 $ par an"; an export (resource 2) reads as a cost: "Coût : 500 $ par an". */
export function incomeText(income, resource = 0) {
  if (isPaid(resource)) return `Coût : ${formatMoney(Math.abs(int(income)))} par an`;
  return `Recette : ${formatMoney(income)} par an`;
}

/** "Surplus disponible : électricité 600 unités, eau −20 unités" from the engine's [electricity, water]. */
export function surplusText(s) {
  const [e, w] = [int(s?.[0]), int(s?.[1])];
  return `Surplus disponible : électricité ${formatUnits(e)} unités, eau ${formatUnits(w)} unités.`;
}

/** Total of the yearly incomes of the signed deals, as a sentence. */
export function totalText(deals) {
  if (deals.length === 0) return "Aucun accord en cours.";
  const total = deals.reduce((sum, d) => sum + d.income, 0);
  return `Recettes des accords : ${formatMoney(total)} par an (${deals.length} en cours).`;
}

/** Text of an active deal's state. */
export function stateText(deal) {
  return deal.covered
    ? "Honoré"
    : "Menacé : surplus insuffisant, rupture et pénalité à la prochaine collecte";
}

/** Title (tooltip) of the cancel button: the penalty. */
export function cancelHelp(deal) {
  return `Résilier coûte une pénalité de ${formatMoney(deal.penalty)}.`;
}

/** The key of a deal for comparing two readings: neighbour and resource. */
export function dealKey(d) {
  return `${d.neighbour}:${d.resource}`;
}

/**
 * The deals of `before` that are not in `after` and were not cancelled by the player (`cancelled`
 * is a Set of dealKey): the neighbour broke them.
 */
export function brokenDeals(before, after, cancelled = new Set()) {
  const kept = new Set(after.map(dealKey));
  return before.filter((d) => !kept.has(dealKey(d)) && !cancelled.has(dealKey(d)));
}

/** "Accord rompu : Valmont (nord) · Électricité. Une pénalité a été payée." */
export function brokenText(deal) {
  return `Accord rompu : ${titleText(deal)}. Une pénalité a été payée.`;
}

/** A string that changes exactly when something the panel shows changes. */
export function snapshotKey(rulesOn, surplus, offers, deals) {
  const o = offers.map((x) => `${x.index}:${x.amount}:${x.price}:${x.status}`).join(",");
  const d = deals.map((x) => `${dealKey(x)}:${x.amount}:${x.price}:${x.covered ? 1 : 0}`).join(",");
  return `${rulesOn ? 1 : 0}|${int(surplus?.[0])},${int(surplus?.[1])}|${o}|${d}`;
}
