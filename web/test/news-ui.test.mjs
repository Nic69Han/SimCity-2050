// Tests of the news ticker (web/news-ui.js) with a fake ticker and the mock engine: hidden until there is a headline, the newest
// headline shown, one snapshot per update, a new city starts again, a classic engine (no rewards) still gets its news.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../news-ui.js";
import { MockCity } from "./mock-engine.mjs";

const norm = (s) => s.replace(/[  ]/g, " ");

/** A page with the ticker and the given engine; `ready` and the city can change between updates. `desc` is what
 * api.describe() returns (the selector's label and the seed), and it can change between updates too. */
function setupPage(city, { ready = true } = {}) {
  const ticker = { hidden: false, textContent: "", updates: 0 };
  const desc = { label: "Ville A", seed: null };
  const api = {
    city: () => api.current,
    $: (id) => (id === "news-ticker" ? ticker : null),
    isReady: () => ready,
    describe: () => ({ ...desc }),
    current: city,
  };
  ui.setup(api);
  return { api, ticker, desc };
}

/** A city whose year, month, population and funds are read from `state`: the same object, another state on a load. */
function cityWithState(state) {
  const city = new MockCity(1, { rewards: true });
  city.set_reward_rules(true);
  city.year = () => state.year;
  city.month = () => state.month;
  city.population = () => state.population;
  city.funds = () => state.funds;
  return city;
}

// The ticker's text as the viewer reads it, once the page redrew.
const shown = (ticker) => (ticker.hidden ? null : norm(ticker.textContent));

describe("the ticker", () => {
  test("hidden after setup, and still hidden while there is no headline", () => {
    const city = new MockCity(1, { rewards: true });
    const { api, ticker } = setupPage(city);
    assert.equal(ticker.hidden, true);
    ui.update(api);
    ui.update(api);
    assert.equal(ticker.hidden, true, "the first snapshot is the baseline; nothing changed");
  });

  test("a reward unlocked: the ticker shows the headline and unhides", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    const { api, ticker } = setupPage(city);
    ui.update(api);
    city.mock_unlock_reward(51);
    ui.update(api);
    assert.equal(ticker.hidden, false);
    assert.equal(shown(ticker), "Récompense débloquée : Hôtel de ville");
  });

  test("the newest headline only: a second change replaces the first one on screen", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    const { api, ticker } = setupPage(city);
    ui.update(api);
    city.mock_unlock_reward(50);
    city.mock_propose_offer(60);
    ui.update(api);
    assert.equal(shown(ticker), "Un pétitionnaire propose un casino");
  });

  test("a year and a population milestone come from the engine's year and population", () => {
    const city = new MockCity(1);
    let year = 1911;
    city.year = () => year;
    city.population = () => 9000;
    const { api, ticker } = setupPage(city);
    ui.update(api);
    year = 1912;
    city.population = () => 10500;
    ui.update(api);
    assert.equal(shown(ticker), "La ville passe les 10 000 habitants !", "the last headline of the update");
  });

  test("the funds go into the red: the ticker says so", () => {
    const city = new MockCity(1);
    let funds = 500;
    city.funds = () => funds;
    const { api, ticker } = setupPage(city);
    ui.update(api);
    funds = -20;
    ui.update(api);
    assert.equal(shown(ticker), "La ville est dans le rouge");
  });

  test("the text is written only when it changes", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    const { api, ticker } = setupPage(city);
    city.mock_unlock_reward(50);
    ui.update(api);
    let writes = 0;
    let text = ticker.textContent;
    Object.defineProperty(ticker, "textContent", { get: () => text, set: (v) => { writes++; text = v; } });
    ui.update(api);
    assert.equal(writes, 0, "same headline, no write");
  });

  test("the queue is bounded: many headlines, the ticker still shows one", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    const { api, ticker } = setupPage(city);
    ui.update(api);
    for (const genre of [50, 51, 52, 53, 54]) {
      city.mock_unlock_reward(genre);
      ui.update(api);
    }
    assert.equal(shown(ticker), "Récompense débloquée : Arc de triomphe");
  });

  test("a new city starts again: the queue is empty and the ticker hides", () => {
    const first = new MockCity(1, { rewards: true });
    first.set_reward_rules(true);
    const { api, ticker } = setupPage(first);
    ui.update(api);
    first.mock_unlock_reward(50);
    ui.update(api);
    assert.equal(ticker.hidden, false);
    api.current = new MockCity(2, { rewards: true });
    ui.update(api);
    assert.equal(ticker.hidden, true);
  });

  test("nothing is read before the engine is ready", () => {
    const city = new MockCity(1);
    let reads = 0;
    city.population = () => (reads++, 0);
    const { api, ticker } = setupPage(city, { ready: false });
    ui.update(api);
    assert.equal(reads, 0);
    assert.equal(ticker.hidden, true);
  });
});

describe("the snapshot", () => {
  test("one snapshot per update: each engine read happens once per update", () => {
    const city = new MockCity(1, { rewards: true });
    let reads = 0;
    city.population = () => (reads++, 0);
    const { api } = setupPage(city);
    ui.update(api);
    assert.equal(reads, 1);
    ui.update(api);
    assert.equal(reads, 2);
  });

  test("a classic engine (no rewards, no energy) still gets the year, the population and the funds", () => {
    const classic = { year: () => 1950, population: () => 0, funds: () => 100 };
    const { api, ticker } = setupPage(classic);
    ui.update(api);
    classic.funds = () => -1;
    ui.update(api);
    assert.equal(shown(ticker), "La ville est dans le rouge");
  });

  test("the power shortage: production below consumption, from the energy statistics", () => {
    const city = new MockCity(1);
    let stats = [1200, 900, 0, 0, 0, 0];
    city.energy_stats = () => Int32Array.from(stats);
    const { api, ticker } = setupPage(city);
    ui.update(api);
    stats = [100, 900, 0, 0, 0, 0];
    ui.update(api);
    assert.equal(shown(ticker), "La ville manque d'électricité");
  });

  test("readSnapshot: the unlocked genres and the proposed offers, read from the engine", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    city.mock_unlock_reward(53);
    city.mock_propose_offer(62);
    const s = ui.readSnapshot(city);
    assert.deepEqual(s.rewardsUnlocked, [53]);
    assert.deepEqual(s.offersProposed, [62]);
    assert.equal(s.year, 1900);
    assert.equal(s.funds, 20000);
    assert.equal(s.powerShortage, false);
  });
});

describe("a load into the same city object", () => {
  // main.js creates one City and loads every save, sample and new city into it: only the state changes.
  test("another city in the same object (label changed): no headline, the ticker stays hidden", () => {
    const state = { year: 1900, month: 0, population: 0, funds: 20000 };
    const city = cityWithState(state);
    const { api, ticker, desc } = setupPage(city);
    ui.update(api);
    Object.assign(state, { year: 1972, month: 3, population: 53000, funds: -500 });
    city.mock_unlock_reward(53);
    desc.label = "Ville B";
    ui.update(api);
    assert.equal(ticker.hidden, true);
    assert.equal(shown(ticker), null);
  });

  test("a year jump of more than one, the same label: starts again, no headline", () => {
    const state = { year: 1900, month: 0, population: 0, funds: 20000 };
    const city = cityWithState(state);
    const { api, ticker } = setupPage(city);
    ui.update(api);
    Object.assign(state, { year: 1972, population: 53000, funds: -500 });
    ui.update(api);
    assert.equal(ticker.hidden, true);
  });

  test("the month goes back in the same year: starts again", () => {
    const state = { year: 1912, month: 5, population: 0, funds: 100 };
    const city = cityWithState(state);
    const { api, ticker } = setupPage(city);
    ui.update(api);
    Object.assign(state, { month: 2, funds: -10 });
    ui.update(api);
    assert.equal(ticker.hidden, true);
  });

  test("control: the month goes forward in the same year, the funds go red: the headline shows", () => {
    const state = { year: 1912, month: 5, population: 0, funds: 100 };
    const city = cityWithState(state);
    const { api, ticker } = setupPage(city);
    ui.update(api);
    Object.assign(state, { month: 6, funds: -10 });
    ui.update(api);
    assert.equal(shown(ticker), "La ville est dans le rouge");
  });

  test("control: the next year (+1) with the same label is news: «Nouvelle année : 1912», never grouped", () => {
    const state = { year: 1911, month: 11, population: 0, funds: 100 };
    const city = cityWithState(state);
    const { api, ticker } = setupPage(city);
    ui.update(api);
    Object.assign(state, { year: 1912, month: 0 });
    ui.update(api);
    assert.equal(shown(ticker), "Nouvelle année : 1912");
  });

  test("a new seed (a random city) in the same object: starts again, no headline", () => {
    const state = { year: 1900, month: 0, population: 0, funds: 100 };
    const city = cityWithState(state);
    const { api, ticker, desc } = setupPage(city);
    ui.update(api);
    desc.seed = 7;
    state.funds = -5;
    ui.update(api);
    assert.equal(ticker.hidden, true);
  });

  test("after a load the old queue is gone: only the headline of the new city's change shows", () => {
    const state = { year: 1900, month: 0, population: 0, funds: 20000 };
    const city = cityWithState(state);
    const { api, ticker, desc } = setupPage(city);
    ui.update(api);
    city.mock_unlock_reward(50);
    ui.update(api);
    assert.equal(shown(ticker), "Récompense débloquée : Résidence du maire");
    desc.label = "Ville B";
    Object.assign(state, { population: 0 });
    ui.update(api);
    assert.equal(ticker.hidden, true, "the load hides the ticker");
    state.population = 10500;
    ui.update(api);
    assert.equal(shown(ticker), "La ville passe les 10 000 habitants !");
  });
});
