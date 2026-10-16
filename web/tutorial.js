// Page feature: guided first steps, checked against the real state of the city (docs/game-design.md,
// workstream "Tutoriel"). The steps and their checks are in tutorial-model.js; this module reads the
// engine, draws the panel and keeps two things per browser: whether the player dismissed the guide, and
// the furthest step reached. Tools are not touched: the guide only watches what the player builds.
import { STEPS, progress, sanitizeRecord, tilesDigest, supportsTutorial } from "./tutorial-model.js";
import { createPrefs } from "./saves.js";

export const RECORD_KEY = "micropolis.tutorial";

let host = null; // the feature API of main.js (city, $, redraw)
let root = null; // #tutorial-panel
let store = null; // the per-browser record (safe: every access is guarded)
let record = null; // { dismissed, reached }, as kept in the browser
let run = null; // { game, index, baseMonths }: the guide for the game in progress
let expanded = false; // the panel shows the steps (else only the «Premiers pas» button)
let lastKey = null; // change key of the last check; the steps are checked again only when it changes
let view = ""; // what is drawn, so the DOM is rebuilt only when it changes

export function setup(api) {
  host = api;
  root = api.$("tutorial-panel");
  store = createPrefs(undefined, RECORD_KEY);
  record = sanitizeRecord(store.read());
}

export function update(api) {
  if (!root) return;
  const city = api.city();
  if (!api.isReady() || !supportsTutorial(city)) {
    root.hidden = true;
    return;
  }
  root.hidden = false;
  const game = api.game();
  if (!run || run.game !== game.id) startRun(city, game);
  const tiles = city.tiles();
  const population = city.population();
  const months = city.year() * 12 + city.month();
  const key = `${game.id}|${population}|${months}|${tilesDigest(tiles)}`;
  if (key === lastKey) return; // nothing the steps read has changed: no check, no redraw
  lastKey = key;
  const index = progress({
    tiles,
    width: city.width(),
    height: city.height(),
    population,
    monthsElapsed: months - run.baseMonths,
  }, run.index);
  if (index !== run.index) {
    run.index = index;
    // the furthest step is kept for a game the player began as a new city (a sample is already built)
    if (run.kind === "new" && index > record.reached) saveRecord({ reached: index });
  }
  render();
}

// A new game: the guide starts at its first step. Only a new city is a fresh start, so only it opens by
// itself (unless the player dismissed the guide); a sample, a file or a save starts folded.
function startRun(city, game) {
  run = { game: game.id, kind: game.kind, index: 0, baseMonths: city.year() * 12 + city.month() };
  expanded = !record.dismissed && game.kind === "new";
  lastKey = null;
}

function saveRecord(patch) {
  record = { ...record, ...patch };
  store.write({ dismissed: record.dismissed, reached: record.reached }); // false when the browser refuses
}

function onPass() {
  expanded = false;
  saveRecord({ dismissed: true });
  render({ focusOpen: true });
}

function onOpen() {
  expanded = true;
  render();
}

function onRestart() {
  expanded = true;
  saveRecord({ dismissed: false, reached: 0 });
  run.index = 0;
  lastKey = null;
  host.redraw(); // checks the steps again from the first one
}

// Draws the panel: the current step with its hint, or only the «Premiers pas» button when folded.
function render({ focusOpen = false } = {}) {
  const index = run.index;
  const done = index >= STEPS.length;
  const shown = expanded ? `open|${index}|${record.reached}` : `folded|${record.reached}`;
  if (shown === view && !focusOpen) return;
  view = shown;
  if (!expanded) {
    const open = document.createElement("button");
    open.type = "button";
    open.className = "tutorial-open";
    open.setAttribute("aria-expanded", "false");
    open.textContent = "Premiers pas";
    if (record.reached > 0) {
      const count = document.createElement("span");
      count.className = "tutorial-count";
      count.textContent = ` ${record.reached}/${STEPS.length}`;
      open.append(count);
    }
    open.onclick = onOpen;
    root.replaceChildren(open);
    if (focusOpen) open.focus();
    return;
  }
  const heading = document.createElement("h2");
  heading.textContent = "Premiers pas";
  const count = document.createElement("p");
  count.className = "tutorial-count";
  count.setAttribute("aria-live", "polite");
  const title = document.createElement("h3");
  title.className = "tutorial-title";
  const hint = document.createElement("p");
  hint.className = "tutorial-hint";
  if (done) {
    count.textContent = `${STEPS.length}/${STEPS.length}`;
    title.textContent = "Bravo : les premiers pas sont faits.";
    hint.textContent = "Vous pouvez continuer à jouer, ou recommencer le guide.";
  } else {
    count.textContent = `Étape ${index + 1}/${STEPS.length}`;
    title.textContent = STEPS[index].title;
    hint.textContent = STEPS[index].hint;
  }
  const pass = document.createElement("button");
  pass.type = "button";
  pass.textContent = "Passer";
  pass.onclick = onPass;
  const restart = document.createElement("button");
  restart.type = "button";
  restart.textContent = "Recommencer";
  restart.onclick = onRestart;
  const actions = document.createElement("div");
  actions.className = "tutorial-actions";
  actions.append(pass, restart);
  root.replaceChildren(heading, count, title, hint, actions);
}
