// News ticker, the words (docs/game-design-v12.md): the headlines that a change of the city's state makes, and the short
// queue the ticker shows. Pure: no DOM and no engine call, so node:test can check it. news-ui.js reads the snapshots.
//
// A snapshot (one per update, read by news-ui.js): { year, month, population, funds, rewardsUnlocked: [genre],
// offersProposed: [genre], powerShortage }. The month is read by news-ui.js only (a jump back in time starts again). A number that is missing (null, undefined, NaN) disables the headline that
// needs it. The first snapshot (prev null) only sets the baseline: it makes no headline.

import { formatInt } from "./budget-text.js";
import { nameOf } from "./structures-model.js";

// The queue keeps at most this many headlines: the oldest go first.
export const MAX_HEADLINES = 8;
// A population headline each time the city passes a multiple of this many inhabitants.
export const POPULATION_STEP = 10000;

// The offers read after «Un pétitionnaire propose» (French, with their article).
export const OFFER_PHRASES = Object.freeze({
  60: "un casino", 61: "une prison d'État", 62: "une décharge toxique", 63: "une base de missiles",
});

// The French headlines (the texts of the tests and of the page).
export const TEXT = Object.freeze({
  // A year is never grouped in French: «1912», not «1 912».
  year: (year) => `Nouvelle année : ${Math.trunc(year)}`,
  population: (n) => `La ville passe les ${formatInt(n)} habitants !`,
  reward: (genre) => `Récompense débloquée : ${nameOf(genre)}`,
  offer: (genre) => `Un pétitionnaire propose ${OFFER_PHRASES[genre] ?? nameOf(genre)}`,
  broke: "La ville est dans le rouge",
  powerOut: "La ville manque d'électricité",
});

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

// The genres of `after` that `before` does not have (both lists are bounded by the snapshot reader).
const newGenres = (before = [], after = []) => after.filter((g) => !before.includes(g));

// The milestone bucket of a population: 0 below the first step, then 1 from the first step, and so on.
const bucket = (population) => Math.floor(Math.max(0, population) / POPULATION_STEP);

function yearHeadlines(prev, next) {
  return isNum(prev.year) && isNum(next.year) && prev.year !== next.year ? [TEXT.year(next.year)] : [];
}

// One headline for the highest milestone passed by this change (a jump over several steps is one headline).
function populationHeadlines(prev, next) {
  if (!isNum(prev.population) || !isNum(next.population)) return [];
  const before = bucket(prev.population);
  const after = bucket(next.population);
  return after > before ? [TEXT.population(after * POPULATION_STEP)] : [];
}

function rewardHeadlines(prev, next) {
  return newGenres(prev.rewardsUnlocked, next.rewardsUnlocked).map(TEXT.reward);
}

function offerHeadlines(prev, next) {
  return newGenres(prev.offersProposed, next.offersProposed).map(TEXT.offer);
}

// Only the change into the red is news: a city that stays in the red makes no headline each update.
function fundsHeadlines(prev, next) {
  return isNum(prev.funds) && isNum(next.funds) && prev.funds >= 0 && next.funds < 0 ? [TEXT.broke] : [];
}

function powerHeadlines(prev, next) {
  return !prev.powerShortage && next.powerShortage ? [TEXT.powerOut] : [];
}

/** The headlines of the change from snapshot `prev` to snapshot `next`, in a fixed order; [] without a baseline. */
export function headlines(prev, next) {
  if (!prev || !next) return [];
  return [
    ...yearHeadlines(prev, next),
    ...populationHeadlines(prev, next),
    ...rewardHeadlines(prev, next),
    ...offerHeadlines(prev, next),
    ...fundsHeadlines(prev, next),
    ...powerHeadlines(prev, next),
  ];
}

/** The queue with `texts` added at its end, keeping the last MAX_HEADLINES only. */
export function pushHeadlines(queue, texts) {
  return [...queue, ...texts].slice(-MAX_HEADLINES);
}

/** The headline the ticker shows: the newest one, or "" for an empty queue. */
export function latestHeadline(queue) {
  return queue.length > 0 ? queue[queue.length - 1] : "";
}
