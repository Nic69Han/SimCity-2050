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
let lastCity = null; // the city the queue belongs to: a new city (a load) starts again

// Calls a method of the engine when it exists; undefined otherwise (a classic or an older engine).
function call(city, name) {
  return typeof city?.[name] === "function" ? city[name]() : undefined;
}

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
    population: numberOrNull(call(city, "population")),
    funds: numberOrNull(call(city, "funds")),
    rewardsUnlocked: decodeRewards(call(city, "rewards")).filter((r) => r.unlocked).map((r) => r.genre),
    offersProposed: decodeOffers(call(city, "special_offers"))
      .filter((o) => o.state === OFFER_STATE.PROPOSED)
      .map((o) => o.genre),
    powerShortage: powerShortageOf(call(city, "energy_stats")),
  };
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
  queue = [];
  prev = null;
  lastCity = null;
  if (ticker) ticker.hidden = true;
}

export function update(api) {
  if (!ticker || !api.isReady()) return;
  const city = api.city();
  if (city !== lastCity) {
    lastCity = city;
    queue = [];
    prev = null;
  }
  const next = readSnapshot(city);
  queue = pushHeadlines(queue, headlines(prev, next));
  prev = next;
  showLatest();
}
