// Rewards and special offers, presentation side (docs/game-design-v12.md): the page says whether the engine has the
// rule «Récompenses et accords», reads the rewards, the offers and the statistics, and names and describes them. The
// engine decides the rule, the unlocks, the offers and the answers. Pure: no DOM, so node:test can check it.
//
// The engine's layouts (crates/micropolis-wasm/src/rewards.rs):
// - rewards(): records of REWARD_LENGTH integers [genre, unlocked 0/1, placed 0/1, population_required,
//   satisfaction_required] for the genres 50-54.
// - special_offers(): records of OFFER_LENGTH integers [genre, annual_income, state, population_required] for the
//   genres 60-63; state 0 none, 1 proposed, 2 accepted, 3 refused.
// - reward_stats(): [satisfaction_pct, special_income_last_year, rewards_unlocked, accepted_offers].

import { formatInt, formatMoney, formatPercent } from "./budget-text.js";
import { nameOf } from "./structures-model.js";

// The engine methods of the rewards. Without all of them there is no rewards panel.
export const METHODS = Object.freeze([
  "reward_rules", "set_reward_rules", "rewards", "special_offers", "answer_offer", "reward_stats",
]);

export const REWARD_LENGTH = 5;
export const OFFER_LENGTH = 4;
export const STAT_COUNT = 4;
// Most records read in one go, for the rewards and for the offers: a bounded loop, whatever the engine sends.
export const MAX_RECORDS = 32;

// The states of an offer (special_offers, field 3).
export const OFFER_STATE = Object.freeze({ NONE: 0, PROPOSED: 1, ACCEPTED: 2, REFUSED: 3 });

// The texts of the panel (French).
export const RULE_LABEL = "Récompenses et accords";
export const ACCEPT_TEXT = "Accepter";
export const REFUSE_TEXT = "Refuser";
export const RULE_OFF_NOTE = "Désactivé : ni récompense ni pétitionnaire tant que la règle est éteinte.";
export const RULE_ON_NOTE =
  "Une récompense se pose une fois débloquée. Un accord rapporte chaque année tant que son bâtiment est debout et alimenté.";

/** Whether `city` has the rewards API (all of METHODS). */
export function supports(city) {
  return METHODS.every((m) => typeof city?.[m] === "function");
}

/** The rule flag as the engine holds it now (false when the engine has no rewards). */
export function readRulesOn(city) {
  return supports(city) && Boolean(city.reward_rules());
}

// A count as the page shows it: a non-negative integer, 0 for anything else.
const count = (n) => Math.max(0, Math.trunc(Number(n)) || 0);
const int = (n) => Math.trunc(Number(n)) || 0;

// Records of `length` integers, at most MAX_RECORDS, a truncated last record ignored.
function records(flat, length) {
  const src = flat ?? [];
  const out = [];
  for (let at = 0; at + length <= src.length && out.length < MAX_RECORDS; at += length) {
    out.push(Array.from(src.slice(at, at + length), int));
  }
  return out;
}

/** Decodes rewards() into [{ genre, unlocked, placed, population, satisfaction }]. */
export function decodeRewards(flat) {
  return records(flat, REWARD_LENGTH).map(([genre, unlocked, placed, population, satisfaction]) => ({
    genre, unlocked: unlocked !== 0, placed: placed !== 0, population: count(population), satisfaction: count(satisfaction),
  }));
}

/** Decodes special_offers() into [{ genre, income, state, population }]; an unknown state counts as none. */
export function decodeOffers(flat) {
  return records(flat, OFFER_LENGTH).map(([genre, income, state, population]) => ({
    genre,
    income: count(income),
    state: Object.values(OFFER_STATE).includes(state) ? state : OFFER_STATE.NONE,
    population: count(population),
  }));
}

/** Decodes reward_stats() into { satisfaction, specialIncome, unlocked, accepted }; missing values count as 0. */
export function decodeRewardStats(values) {
  const v = Array.from(values ?? []).slice(0, STAT_COUNT).map(count);
  const [satisfaction = 0, specialIncome = 0, unlocked = 0, accepted = 0] = v;
  return { satisfaction, specialIncome, unlocked, accepted };
}

/** The status of a reward (French): posée, débloquée (to place), or locked with its thresholds. */
export function rewardStatus(r) {
  if (r.placed) return "Posée";
  if (r.unlocked) return "Débloquée — à poser";
  const lock = `Verrouillée : ${formatInt(r.population)} habitants`;
  return r.satisfaction > 0 ? `${lock}, ${formatInt(r.satisfaction)} % de satisfaction` : lock;
}

/** One reward line of the list (French): "Hôtel de ville (Débloquée — à poser)". */
export function rewardLine(r) {
  return `${nameOf(r.genre)} (${rewardStatus(r)})`;
}

/** The text of an offer (French), without its buttons: the income while proposed, else the state. */
export function offerText(o) {
  const name = nameOf(o.genre);
  if (o.state === OFFER_STATE.PROPOSED) return `${name} rapporte ${formatMoney(o.income)} par an`;
  if (o.state === OFFER_STATE.ACCEPTED) return `${name} : Accepté`;
  if (o.state === OFFER_STATE.REFUSED) return `${name} : Refusé`;
  return `${name} : Pas encore proposé (${formatInt(o.population)} habitants)`;
}

/** Whether an offer shows the two answer buttons: only while it is proposed. */
export function offerAnswerable(o) {
  return o.state === OFFER_STATE.PROPOSED;
}

/** The statistics lines under the list (French), in a fixed order. */
export function statsLines(s) {
  return [
    `Satisfaction : ${formatPercent(s.satisfaction)}`,
    `Recette des accords l'an dernier : ${formatMoney(s.specialIncome)}`,
  ];
}

/** The note under the switch: what the rule does now (French). */
export function noteText(on) {
  return on ? RULE_ON_NOTE : RULE_OFF_NOTE;
}
