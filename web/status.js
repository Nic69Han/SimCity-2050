import { engineErrorText } from "./errors.js";

// Text of the status line and of the load messages (presentation only, ARCHITECTURE.md rule 5).
// The numbers come from the engine; this only formats them.

export const MONTHS = Object.freeze(["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"]);

// Shown until the first city is loaded: no numbers of an engine that holds no city yet.
export const LOADING_TEXT = "Chargement…";
// Shown when the first city could not be loaded.
export const NO_CITY_TEXT = "Aucune ville chargée";

// "Graine 4242 · jan 1900 · 20 000 $" (the seed part only for a city made by "Nouvelle ville").
export function formatStatus({ seed = null, month, year, funds }) {
  const date = `${MONTHS[month] ?? "?"} ${year}`;
  const money = `${Number(funds).toLocaleString("fr-FR")} $`;
  return `${seed !== null ? `Graine ${seed} · ` : ""}${date} · ${money}`;
}

// The line under the map: population, score and the three demand valves (R, C, I).
export function formatStats({ population, score, demand }) {
  const [r, c, i] = demand;
  return `Population ${Number(population).toLocaleString("fr-FR")} · score ${score} · ` +
    `demande R ${r} / C ${c} / I ${i}`;
}

// The message of a refused file or a failed load (the status line is not touched). The French
// text of the engine's error codes is in errors.js.
export function formatLoadError(error, limits = undefined) {
  return engineErrorText(error, limits);
}
