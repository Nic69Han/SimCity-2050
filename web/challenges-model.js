// Challenges, pure side (docs/game-design-v1.md): the table of dated challenges, the snapshot read from the engine, the
// verdict (won / lost / running), the best results kept in localStorage and the French texts. No DOM, no clock, no
// random: node:test checks every function. The panel is in challenges-ui.js.
//
// A challenge is data: `start` ({ sample } or { seed }), `kind` ("reach": the conditions must become true before the
// deadline; "hold": the conditions must stay true until the deadline), `conditions` (all must hold, each
// { metric, op, target }) and `deadline` in game years from the start. `requires` lists the engine methods a metric
// needs (the challenge is offered only when the engine has them) and `enable` the rule switches pushed after the load.

export const MONTHS_PER_YEAR = 12;
// Most challenges and conditions read in one go: a bounded loop whatever the table or the data hold.
export const MAX_CHALLENGES = 32;
export const MAX_CONDITIONS = 4;
export const STORAGE_KEY = "simcity2050.challenges";
export const RESULTS = Object.freeze({ WON: "won", LOST: "lost", RUNNING: "running" });
// The engine's ceiling for the pollution history (a byte); a bad reading is clamped to it.
export const POLLUTION_MAX = 255;

const cond = (metric, op, target) => Object.freeze({ metric, op, target });
const challenge = (c) => Object.freeze({ requires: [], enable: [], ...c, conditions: Object.freeze(c.conditions) });

export const CHALLENGES = Object.freeze([
  challenge({
    id: "first-year", title: "Une année sans faillite", start: { sample: "haight" }, kind: "hold",
    conditions: [cond("funds", ">", 0)], deadline: 1,
  }),
  challenge({
    id: "pop-50000", title: "50 000 habitants avant 1960", start: { seed: 1960 }, kind: "reach",
    conditions: [cond("population", ">=", 50000)], deadline: 60,
  }),
  challenge({
    id: "treasury-20", title: "Trésorerie positive pendant 20 ans", start: { sample: "kyoto" }, kind: "hold",
    conditions: [cond("funds", ">", 0)], deadline: 20,
  }),
  challenge({
    id: "clean-air", title: "Pollution moyenne sous 30", start: { sample: "yokohama" }, kind: "reach",
    conditions: [cond("pollution", "<=", 30), cond("population", ">=", 60000)], deadline: 15,
  }),
  challenge({
    id: "all-rewards", title: "Toutes les récompenses débloquées", start: { sample: "haight" }, kind: "reach",
    conditions: [cond("rewards", ">=", 5)], deadline: 30, requires: ["reward_stats"], enable: ["set_reward_rules"],
  }),
  challenge({
    id: "power-ok", title: "Aucun manque d'électricité", start: { sample: "kyoto" }, kind: "hold",
    conditions: [cond("powerBalance", ">=", 0)], deadline: 10, requires: ["energy_stats"], enable: ["set_energy_rules"],
  }),
  challenge({
    id: "new-town", title: "Une ville neuve de 10 000 habitants", start: { seed: 2050 }, kind: "reach",
    conditions: [cond("population", ">=", 10000)], deadline: 25,
  }),
  challenge({
    id: "approval-70", title: "Habitants satisfaits", start: { sample: "yokohama" }, kind: "reach",
    conditions: [cond("approval", ">=", 70), cond("population", ">=", 50000)], deadline: 5, requires: ["evaluation"],
  }),
]);

// ---- metrics ---------------------------------------------------------------------------------------------------

const number = (n) => (Number.isFinite(n) ? n : null);
export const formatInt = (n) => Math.round(n).toLocaleString("fr-FR");

// What the page shows of each metric: its label and how its value is written.
export const METRICS = Object.freeze({
  population: { label: "Population", text: (v) => formatInt(v) },
  funds: { label: "Fonds", text: (v) => `${formatInt(v)} $` },
  score: { label: "Score", text: (v) => formatInt(v) },
  approval: { label: "Approbation", text: (v) => `${formatInt(v)} %` },
  pollution: { label: "Pollution moyenne", text: (v) => formatInt(v) },
  rewards: { label: "Récompenses débloquées", text: (v) => formatInt(v) },
  powerBalance: { label: "Bilan électrique", text: (v) => formatInt(v) },
});

const call = (city, name, ...args) => (typeof city?.[name] === "function" ? city[name](...args) : null);
const at = (list, i) => (list && list.length > i ? number(Number(list[i])) : null);

// Last value of the short pollution history (120 values, oldest first), clamped; null without the method.
function readPollution(city) {
  const h = call(city, "history", 5, 0);
  if (!h || h.length === 0) return null;
  const v = number(Number(h[h.length - 1]));
  return v === null ? null : Math.min(POLLUTION_MAX, Math.max(0, v));
}

function readPowerBalance(city) {
  const s = call(city, "energy_stats");
  const made = at(s, 0);
  const used = at(s, 1);
  return made === null || used === null ? null : made - used;
}

/** Months since year 0 (year * 12 + month), or null: the cheap read that tells whether a new month has begun. */
export function readMonthIndex(city) {
  const year = number(call(city, "year"));
  return year === null ? null : year * MONTHS_PER_YEAR + (number(call(city, "month")) ?? 0);
}

/**
 * The numbers a challenge may read, from methods the engine has (a missing method gives null). `monthIndex` counts game
 * months from year 0, so two snapshots subtract into elapsed months.
 */
export function readSnapshot(city) {
  const evaluation = call(city, "evaluation");
  return {
    monthIndex: readMonthIndex(city),
    population: number(call(city, "population")),
    funds: number(call(city, "funds")),
    score: at(evaluation, 0) ?? number(call(city, "score")),
    approval: at(evaluation, 6),
    pollution: readPollution(city),
    rewards: at(call(city, "reward_stats"), 2),
    powerBalance: readPowerBalance(city),
  };
}

/** Whether the engine has what the challenge needs (the methods of `requires`). */
export function isAvailable(c, city) {
  return c.requires.every((name) => typeof city?.[name] === "function");
}

// ---- the verdict -----------------------------------------------------------------------------------------------

const OPS = Object.freeze({
  ">=": (a, b) => a >= b,
  ">": (a, b) => a > b,
  "<=": (a, b) => a <= b,
  "<": (a, b) => a < b,
});

/** One condition on a snapshot; a metric the engine did not give counts as not met. */
export function conditionMet(condition, snapshot) {
  const v = snapshot?.[condition.metric];
  return typeof v === "number" && Number.isFinite(v) && OPS[condition.op](v, condition.target);
}

export function conditionsMet(c, snapshot) {
  return c.conditions.slice(0, MAX_CONDITIONS).every((k) => conditionMet(k, snapshot));
}

/** Game months from the start to the snapshot (0 when a date is missing). */
export function elapsedMonths(start, snapshot) {
  if (!Number.isFinite(start?.monthIndex) || !Number.isFinite(snapshot?.monthIndex)) return 0;
  return Math.max(0, snapshot.monthIndex - start.monthIndex);
}

export const deadlineMonths = (c) => c.deadline * MONTHS_PER_YEAR;

/**
 * "won" | "lost" | "running". reach: won as soon as the conditions hold, lost once the deadline has passed without.
 * hold: lost as soon as a condition breaks, won when the deadline is reached with the conditions still true.
 */
export function evaluate(c, start, snapshot) {
  const met = conditionsMet(c, snapshot);
  const over = elapsedMonths(start, snapshot) >= deadlineMonths(c);
  if (c.kind === "hold") {
    if (!met) return RESULTS.LOST;
    return over ? RESULTS.WON : RESULTS.RUNNING;
  }
  if (met) return RESULTS.WON;
  return over ? RESULTS.LOST : RESULTS.RUNNING;
}

/** Evaluation is done once per game month: true when the snapshot is in a month other than the last one judged. */
export function isDue(lastMonthIndex, snapshot) {
  if (!Number.isFinite(snapshot?.monthIndex)) return false;
  return !Number.isFinite(lastMonthIndex) || snapshot.monthIndex !== lastMonthIndex;
}

// ---- best results (localStorage) -------------------------------------------------------------------------------

/**
 * Best results by challenge id: { id: { result: "won" | "lost", months } }. A text that is not the expected JSON, an
 * unknown id or a bad entry is dropped; at most MAX_CHALLENGES entries are kept.
 */
export function parseBest(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const known = new Set(CHALLENGES.map((c) => c.id));
  const out = {};
  for (const id of Object.keys(raw).slice(0, MAX_CHALLENGES)) {
    const e = raw[id];
    const ok = known.has(id) && e && (e.result === RESULTS.WON || e.result === RESULTS.LOST) &&
      Number.isInteger(e.months) && e.months >= 0;
    if (ok) out[id] = { result: e.result, months: e.months };
  }
  return out;
}

export function serializeBest(best) {
  return JSON.stringify(best);
}

const rank = (e) => (e.result === RESULTS.WON ? 0 : 1);

/** Whether `candidate` beats `old`: a win beats a loss; two wins, the faster; two losses, the longer held. */
export function isBetter(candidate, old) {
  if (!old) return true;
  if (rank(candidate) !== rank(old)) return rank(candidate) < rank(old);
  return candidate.result === RESULTS.WON ? candidate.months < old.months : candidate.months > old.months;
}

/** A new best-results object with the result recorded when it is better (the argument is not changed). */
export function recordResult(best, id, result, months) {
  const entry = { result, months: Math.max(0, Math.trunc(months)) };
  if (result === RESULTS.RUNNING || !isBetter(entry, best[id])) return best;
  return { ...best, [id]: entry };
}

// ---- French texts ----------------------------------------------------------------------------------------------

const yearsText = (n) => `${n} an${n > 1 ? "s" : ""}`;

export function durationText(months) {
  const m = Math.max(0, Math.trunc(months));
  const years = Math.floor(m / MONTHS_PER_YEAR);
  const rest = m % MONTHS_PER_YEAR;
  const y = years > 0 ? yearsText(years) : "";
  const r = rest > 0 || years === 0 ? `${rest} mois` : "";
  return [y, r].filter(Boolean).join(" et ");
}

export function conditionText(k) {
  const m = METRICS[k.metric];
  const op = { ">=": "au moins", ">": "plus de", "<=": "au plus", "<": "moins de" }[k.op];
  return `${m.label} : ${op} ${m.text(k.target)}`;
}

/** The goal in one sentence, e.g. « Population : au moins 50 000, avant 15 ans ». */
export function goalText(c) {
  const parts = c.conditions.slice(0, MAX_CONDITIONS).map(conditionText).join(" ; ");
  return c.kind === "hold" ? `${parts}, pendant ${yearsText(c.deadline)}` : `${parts}, en ${yearsText(c.deadline)} au plus`;
}

/** The current value of each metric of the challenge, e.g. « Population : 12 340 ». */
export function progressLines(c, snapshot) {
  return c.conditions.slice(0, MAX_CONDITIONS).map((k) => {
    const v = snapshot?.[k.metric];
    const m = METRICS[k.metric];
    return `${m.label} : ${typeof v === "number" ? m.text(v) : "inconnu"}`;
  });
}

export function remainingText(c, start, snapshot) {
  return `Il reste ${durationText(deadlineMonths(c) - elapsedMonths(start, snapshot))}.`;
}

export function resultText(c, result, months) {
  if (result === RESULTS.WON) return `Défi gagné : « ${c.title} » en ${durationText(months)}.`;
  return c.kind === "hold"
    ? `Défi perdu : « ${c.title} », l'objectif n'a pas tenu (${durationText(months)}).`
    : `Défi perdu : « ${c.title} », le délai est dépassé.`;
}

export function bestText(entry) {
  if (!entry) return "Pas encore tenté";
  return entry.result === RESULTS.WON ? `Meilleur : gagné en ${durationText(entry.months)}` : "Déjà tenté : perdu";
}

export const ABANDON_TEXT = "Défi abandonné : une autre ville a été chargée.";
export const UNAVAILABLE_TEXT = "Indisponible avec ce moteur.";
export const NO_SEED_TEXT = "Ce moteur ne sait pas créer une ville à partir d'une graine.";
export const LOADING_TEXT = "Chargement de la ville du défi…";
