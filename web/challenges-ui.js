// Page feature: «Défis» (docs/game-design-v1.md), the panel #challenges-panel: the list of challenges with «Commencer», the
// running challenge (goal, progress, time left), the result announced in a role="status" line and the best results kept
// in localStorage. Presentation only (ARCHITECTURE.md rule 5): the verdicts are in challenges-model.js (pure, tested). A
// challenge loads its city through the page's own paths: the city selector (a sample) or the «Nouvelle ville» button
// (a seed); the challenge begins when the page reports a new game (api.game().id changes). setup(api) runs once after the
// engine exists; update(api) runs after every redraw.
import {
  CHALLENGES, RESULTS, STORAGE_KEY, ABANDON_TEXT, UNAVAILABLE_TEXT, NO_SEED_TEXT, LOADING_TEXT,
  readSnapshot, readMonthIndex, isAvailable, evaluate, isDue, parseBest, serializeBest, recordResult, elapsedMonths,
  goalText, progressLines, remainingText, resultText, bestText,
} from "./challenges-model.js";

export const PANEL_TITLE = "Défis";
export const START_TEXT = "Commencer";
export const GIVE_UP_TEXT = "Abandonner";

let panel = null;
let ui = null;
// pending: a start waiting for the new game; running: { challenge, gameId, start, last, snapshot }.
let state = { pending: null, running: null, message: "", best: {} };

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

// ---- storage (every access guarded: it can throw or be absent) -------------------------------------------------

function readBest() {
  try {
    return parseBest(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "");
  } catch {
    return {};
  }
}

function writeBest(best) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, serializeBest(best));
  } catch {
    // no storage (private window, quota): the results stay in memory for this visit
  }
}

// ---- starting --------------------------------------------------------------------------------------------------

/** Why the challenge cannot start now (a French text), or null. */
export function blockedReason(c, api) {
  if (!isAvailable(c, api.city())) return UNAVAILABLE_TEXT;
  if (c.start.seed !== undefined && (!api.$("newcity") || api.$("newcity").hidden)) return NO_SEED_TEXT;
  return null;
}

// Loads the challenge's city by the page's own path: the selector's change handler, or the «Nouvelle ville» button.
function loadCity(api, c) {
  if (c.start.sample !== undefined) {
    const select = api.$("city");
    select.value = c.start.sample;
    select.dispatchEvent(new Event("change"));
    return;
  }
  api.$("seed").value = String(c.start.seed);
  api.$("newcity-btn").click();
}

function startChallenge(api, c) {
  if (!api.isReady() || blockedReason(c, api)) return;
  state.running = null;
  state.message = LOADING_TEXT;
  state.pending = { challenge: c, gameId: api.game().id };
  loadCity(api, c);
  update(api); // a seed city is made at once: the new game is seen now; a sample comes with its redraw
}

// The rules a challenge needs are pushed after the load (a load resets them); the relief box relays the flags.
function enableRules(api, c) {
  const city = api.city();
  for (const name of c.enable) if (typeof city[name] === "function") city[name](true);
  if (c.enable.length > 0) api.$("relief")?.dispatchEvent(new Event("change"));
}

function begin(api) {
  const { challenge } = state.pending;
  enableRules(api, challenge);
  const snapshot = readSnapshot(api.city());
  state.running = { challenge, gameId: api.game().id, start: snapshot, last: snapshot.monthIndex, snapshot };
  state.pending = null;
  state.message = "";
}

function giveUp() {
  state.running = null;
  state.pending = null;
  state.message = "";
}

// ---- tracking --------------------------------------------------------------------------------------------------

function finish(result) {
  const { challenge, start, snapshot } = state.running;
  const months = elapsedMonths(start, snapshot);
  state.best = recordResult(state.best, challenge.id, result, months);
  writeBest(state.best);
  state.message = resultText(challenge, result, months);
  state.running = null;
}

// Once per game month: the snapshot is judged when its month is not the last one judged.
function track(api) {
  const run = state.running;
  if (api.game().id !== run.gameId) {
    state.running = null;
    state.message = ABANDON_TEXT;
    return;
  }
  const month = readMonthIndex(api.city());
  if (!isDue(run.last, { monthIndex: month })) return;
  run.snapshot = readSnapshot(api.city());
  run.last = month;
  const verdict = evaluate(run.challenge, run.start, run.snapshot);
  if (verdict !== RESULTS.RUNNING) finish(verdict);
}

// ---- the panel -------------------------------------------------------------------------------------------------

function buildItem(api, c) {
  const button = el("button", { type: "button", class: "challenge-start" }, START_TEXT);
  button.onclick = () => startChallenge(api, c);
  const note = el("span", { class: "challenge-note" });
  const li = el("li", { class: "challenge" });
  li.append(el("strong", {}, c.title), el("span", { class: "challenge-goal" }, goalText(c)), note, button);
  return { c, li, button, note };
}

function build(api) {
  const list = el("ul", { class: "challenge-list" });
  const items = CHALLENGES.map((c) => buildItem(api, c));
  for (const it of items) list.append(it.li);
  const runTitle = el("h3", {}, "Défi en cours");
  const runGoal = el("p", { class: "challenge-goal" });
  const runProgress = el("ul", { class: "challenge-progress" });
  const runTime = el("p", { class: "challenge-time" });
  const giveUpButton = el("button", { type: "button", id: "challenge-giveup" }, GIVE_UP_TEXT);
  giveUpButton.onclick = () => giveUp();
  const running = el("div", { class: "challenge-running" });
  running.append(runTitle, runGoal, runProgress, runTime, giveUpButton);
  const status = el("p", { class: "challenge-result", role: "status" });
  panel.replaceChildren(el("h2", {}, PANEL_TITLE), list, running, status);
  return { items, running, runTitle, runGoal, runProgress, runTime, status, progressKey: "" };
}

function renderItems(api) {
  for (const it of ui.items) {
    const reason = blockedReason(it.c, api);
    it.button.disabled = reason !== null;
    setText(it.note, reason ?? bestText(state.best[it.c.id]));
  }
}

function renderRunning() {
  const run = state.running;
  ui.running.hidden = run === null;
  if (!run) return;
  setText(ui.runTitle, run.challenge.title);
  setText(ui.runGoal, goalText(run.challenge));
  const lines = progressLines(run.challenge, run.snapshot);
  const key = lines.join("\n");
  if (ui.progressKey !== key) {
    ui.progressKey = key;
    ui.runProgress.replaceChildren(...lines.map((line) => el("li", {}, line)));
  }
  setText(ui.runTime, remainingText(run.challenge, run.start, run.snapshot));
}

export function setup(api) {
  panel = api.$("challenges-panel") ?? null;
  ui = null;
  state = { pending: null, running: null, message: "", best: readBest() };
  if (panel) panel.hidden = true;
}

export function update(api) {
  if (!panel || !api.isReady()) return;
  if (!ui) ui = build(api);
  if (state.pending && api.game().id !== state.pending.gameId) begin(api);
  else if (state.running) track(api);
  renderItems(api);
  renderRunning();
  setText(ui.status, state.message);
  panel.hidden = false;
}
