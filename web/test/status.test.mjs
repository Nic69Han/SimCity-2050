// The status line text and the load messages: formatted from engine numbers, never a stale city.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatStatus, formatStats, formatLoadError, MONTHS, LOADING_TEXT, NO_CITY_TEXT } from "../status.js";

describe("status line", () => {
  test("date and funds of a sample city (fr-FR grouping)", () => {
    assert.equal(formatStatus({ month: 0, year: 1900, funds: 20000 }), "jan 1900 · 20 000 $");
    assert.equal(formatStatus({ month: 11, year: 2050, funds: 1000000 }), "déc 2050 · 1 000 000 $");
  });

  test("a seed is shown in front for a city made by Nouvelle ville", () => {
    assert.equal(formatStatus({ seed: 4242, month: 2, year: 1901, funds: 0 }), "Graine 4242 · mar 1901 · 0 $");
    assert.equal(formatStatus({ seed: -7, month: 0, year: 1900, funds: 5 }), "Graine -7 · jan 1900 · 5 $");
  });

  test("a seed of null (a loaded file) shows no seed", () => {
    assert.equal(formatStatus({ seed: null, month: 0, year: 1900, funds: 1 }), "jan 1900 · 1 $");
  });

  test("the twelve months are French, in order", () => {
    assert.deepEqual([...MONTHS], ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"]);
  });

  test("a month outside the year never prints undefined", () => {
    assert.equal(formatStatus({ month: 12, year: 1900, funds: 0 }), "? 1900 · 0 $");
  });

  test("texts shown before a city exists", () => {
    assert.equal(LOADING_TEXT, "Chargement…");
    assert.equal(NO_CITY_TEXT, "Aucune ville chargée");
  });
});

describe("stats line", () => {
  test("population, score and the demand valves", () => {
    assert.equal(
      formatStats({ population: 1056, score: 767, demand: [1, -2, 0] }),
      "Population 1\u202f056 · score 767 · demande R 1 / C -2 / I 0",
    );
  });
});

describe("load message", () => {
  test("an error is shown as 'Erreur : <message>'", () => {
    assert.equal(formatLoadError(new Error("bad header")), "Erreur : bad header");
    assert.equal(formatLoadError("plain text"), "Erreur : plain text");
    assert.equal(formatLoadError(undefined), "Erreur : undefined");
  });
});
