// The news ticker's words (web/news-model.js): the headlines of a change of snapshot, the bounded queue and the latest headline.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { headlines, pushHeadlines, latestHeadline, MAX_HEADLINES, OFFER_PHRASES, TEXT, POPULATION_STEP } from "../news-model.js";

// Narrow no-break spaces read as plain spaces in the expected texts.
const norm = (list) => list.map((s) => s.replace(/[  ]/g, " "));
const snap = (over = {}) => ({
  year: 1900, population: 0, funds: 20000, rewardsUnlocked: [], offersProposed: [], powerShortage: false, ...over,
});

describe("headlines of a change", () => {
  test("no baseline (the first snapshot, or none): no headline", () => {
    assert.deepEqual(headlines(null, snap()), []);
    assert.deepEqual(headlines(snap(), null), []);
    assert.deepEqual(headlines(undefined, undefined), []);
  });

  test("the same snapshot: no headline", () => {
    assert.deepEqual(headlines(snap({ population: 12000 }), snap({ population: 12000 })), []);
  });

  test("a new year: «Nouvelle année : 1912»", () => {
    assert.equal(TEXT.year(2050), "Nouvelle année : 2050", "a year is never grouped");
    assert.deepEqual(norm(headlines(snap({ year: 1911 }), snap({ year: 1912 }))), ["Nouvelle année : 1912"]);
    assert.deepEqual(headlines(snap({ year: null }), snap({ year: 1912 })), [], "a missing year gives no headline");
  });

  test("a population milestone each 10 000 inhabitants, once for a jump over several steps", () => {
    assert.equal(POPULATION_STEP, 10000);
    assert.deepEqual(norm(headlines(snap({ population: 9999 }), snap({ population: 10000 }))), [
      "La ville passe les 10 000 habitants !",
    ]);
    assert.deepEqual(headlines(snap({ population: 10000 }), snap({ population: 19999 })), [], "inside a step");
    assert.deepEqual(norm(headlines(snap({ population: 5000 }), snap({ population: 45000 }))), [
      "La ville passe les 40 000 habitants !",
    ], "the highest step only");
  });

  test("a reward unlocked: «Récompense débloquée : Hôtel de ville», only for a new genre", () => {
    assert.deepEqual(headlines(snap({ rewardsUnlocked: [50] }), snap({ rewardsUnlocked: [50, 51] })), [
      "Récompense débloquée : Hôtel de ville",
    ]);
    assert.deepEqual(headlines(snap({ rewardsUnlocked: [50] }), snap({ rewardsUnlocked: [50] })), []);
  });

  test("an offer proposed: «Un pétitionnaire propose un casino», with the article of each offer", () => {
    assert.deepEqual(headlines(snap(), snap({ offersProposed: [60] })), ["Un pétitionnaire propose un casino"]);
    assert.deepEqual(headlines(snap(), snap({ offersProposed: [61] })), ["Un pétitionnaire propose une prison d'État"]);
    assert.deepEqual(headlines(snap(), snap({ offersProposed: [62] })), ["Un pétitionnaire propose une décharge toxique"]);
    assert.deepEqual(headlines(snap(), snap({ offersProposed: [63] })), ["Un pétitionnaire propose une base de missiles"]);
    assert.deepEqual(headlines(snap({ offersProposed: [60] }), snap({ offersProposed: [60] })), [], "already proposed");
  });

  test("the funds go into the red: once, on the change, not on each update", () => {
    assert.deepEqual(headlines(snap({ funds: 100 }), snap({ funds: -5 })), ["La ville est dans le rouge"]);
    assert.deepEqual(headlines(snap({ funds: -5 }), snap({ funds: -10 })), [], "already in the red");
    assert.deepEqual(headlines(snap({ funds: null }), snap({ funds: -5 })), [], "no funds known");
  });

  test("a power shortage starts: «La ville manque d'électricité», once", () => {
    assert.deepEqual(headlines(snap({ powerShortage: false }), snap({ powerShortage: true })), [
      "La ville manque d'électricité",
    ]);
    assert.deepEqual(headlines(snap({ powerShortage: true }), snap({ powerShortage: true })), []);
  });

  test("several changes: in a fixed order (year, population, rewards, offers, funds, power)", () => {
    const out = headlines(
      snap({ year: 1911, population: 9000, funds: 5, powerShortage: false }),
      snap({ year: 1912, population: 11000, rewardsUnlocked: [51], offersProposed: [60], funds: -1, powerShortage: true }),
    );
    assert.deepEqual(norm(out), [
      "Nouvelle année : 1912",
      "La ville passe les 10 000 habitants !",
      "Récompense débloquée : Hôtel de ville",
      "Un pétitionnaire propose un casino",
      "La ville est dans le rouge",
      "La ville manque d'électricité",
    ]);
  });

  test("every offer genre has its phrase", () => {
    assert.deepEqual(Object.keys(OFFER_PHRASES).map(Number), [60, 61, 62, 63]);
    assert.equal(TEXT.offer(99), "Un pétitionnaire propose Bâtiment n° 99", "an unknown genre keeps its number");
  });
});

describe("the queue of headlines", () => {
  test("MAX_HEADLINES is 8", () => {
    assert.equal(MAX_HEADLINES, 8);
  });

  test("keeps at most MAX_HEADLINES, the newest ones", () => {
    const many = Array.from({ length: MAX_HEADLINES + 3 }, (_, i) => `h${i}`);
    const queue = pushHeadlines([], many);
    assert.equal(queue.length, MAX_HEADLINES);
    assert.equal(queue[0], "h3", "the three oldest went first");
    assert.equal(queue.at(-1), `h${MAX_HEADLINES + 2}`);
  });

  test("adding to a full queue drops the oldest; the input is not changed", () => {
    const full = pushHeadlines([], Array.from({ length: MAX_HEADLINES }, (_, i) => `h${i}`));
    const next = pushHeadlines(full, ["new"]);
    assert.equal(next.length, MAX_HEADLINES);
    assert.equal(next[0], "h1");
    assert.equal(next.at(-1), "new");
    assert.equal(full[0], "h0", "the input queue is untouched");
  });

  test("no texts: the same headlines", () => {
    assert.deepEqual(pushHeadlines(["a", "b"], []), ["a", "b"]);
  });

  test("the latest headline: the last one, or \"\" for an empty queue", () => {
    assert.equal(latestHeadline([]), "");
    assert.equal(latestHeadline(["a", "b"]), "b");
  });
});
