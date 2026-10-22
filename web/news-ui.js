// Page feature: the news ticker (docs/game-design-v12.md), the strip #news-ticker under the header. Once per update it reads
// a snapshot of the city (the year, the population, the funds, the unlocked rewards, the proposed offers, the power
// shortage), turns the change from the last snapshot into headlines (news-model.js, pure and tested) and shows the newest
// one. Presentation only (ARCHITECTURE.md rule 4): every method is read from the engine when it exists, so a classic
// engine still gets the year, the population, the funds and the power. setup(api) runs once after the engine exists;
// update(api) runs after every redraw.
import { headlines, pushHeadlines, latestHeadline } from "./news-model.js";
import { decodeRewards, decodeOffers, OFFER_STATE } from "./rewards-model.js";

let ticker = null;
let queue = []; // the headlines, oldest first, at most MAX_HEADLINES (news-model.js)
let prev = null; // the snapshot of the last update, or null: the next one is the baseline
let lastCity = null; // the city object of the last update (a different object is a new city)
let lastKey = null; // the label and seed of the city the queue belongs to (api.describe): a load changes them

// Calls a method of the engine when it exists; undefined otherwise (a classic or an older engine).
function call(city, name) {
  return typeof city?.[name] === "function" ? city[name]() : undefined;
}

const isNum = (n) => typeof n === "number" && Number.isFinite(n);
const numberOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Power is short when the engine produces less than it consumes (energy_stats: production, consumption, ...).
function powerShortageOf(stats) {
  const s = Array.from(stats ?? []);
  return s.length >= 2 && Number(s[0]) < Number(s[1]);
}

/** The snapshot of `city` for news-model.js. Reads each method only when the engine has it. */
export function readSnapshot(city) {
  return {
    year: numberOrNull(call(city, "year")),
    month: numberOrNull(call(city, "month")),
    population: numberOrNull(call(city, "population")),
    funds: numberOrNull(call(city, "funds")),
    rewardsUnlocked: decodeRewards(call(city, "rewards")).filter((r) => r.unlocked).map((r) => r.genre),
    offersProposed: decodeOffers(call(city, "special_offers"))
      .filter((o) => o.state === OFFER_STATE.PROPOSED)
      .map((o) => o.genre),
    powerShortage: powerShortageOf(call(city, "energy_stats")),
  };
}

// The key of the city the page shows: the selector's label and the seed of a random city. "" without describe().
function keyOf(api) {
  const d = typeof api.describe === "function" ? api.describe() : null;
  return d ? `${d.label ?? ""}\u0000${d.seed ?? ""}` : "";
}

/**
 * True when `next` cannot follow `prev` in play: the year moves by anything but 0 or +1, or the month goes back in the
 * same year. main.js keeps one City object for every load, so the object alone does not tell a new city.
 */
export function isJump(prev, next) {
  if (!prev || !isNum(prev.year) || !isNum(next.year)) return false;
  const dy = next.year - prev.year;
  if (dy !== 0 && dy !== 1) return true;
  return dy === 0 && isNum(prev.month) && isNum(next.month) && next.month < prev.month;
}

// A new city (or a load) starts again: no queue, no baseline, the ticker hidden.
function startAgain(city, key) {
  lastCity = city;
  lastKey = key;
  queue = [];
  prev = null;
  if (ticker) ticker.hidden = true;
}

// The ticker shows the newest headline, and stays hidden until there is one.
function showLatest() {
  const text = latestHeadline(queue);
  if (text === "") {
    ticker.hidden = true;
    return;
  }
  if (ticker.textContent !== text) ticker.textContent = text;
  ticker.hidden = false;
}

export function setup(api) {
  ticker = api.$("news-ticker");
  startAgain(null, null);
}

export function update(api) {
  if (!ticker || !api.isReady()) return;
  const city = api.city();
  const key = keyOf(api);
  const next = readSnapshot(city);
  if (city !== lastCity || key !== lastKey || isJump(prev, next)) startAgain(city, key);
  queue = pushHeadlines(queue, headlines(prev, next));
  prev = next;
  showLatest();
}
