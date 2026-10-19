// Page feature: «Circulation simulée» (docs/game-design-v03.md), the panel #agents-panel: the rule
// switch and the traffic statistics. Presentation only (ARCHITECTURE.md rule 5): the engine owns the
// rule and the numbers; the page keeps no copy it writes back. After a load or a new city update()
// reads the engine again. The French texts and the formatting are in agents-model.js.
// setup(api) runs once after the engine exists; update(api) runs after every redraw.
// api = { city(): the engine, $(id): getElementById, redraw(), isReady(), game(), describe() }.
import {
  NOTE, SWITCH_LABEL, TITLE, decodeStats, decodeTransport, statsLines, stateText, supports, supportsTransport,
  transportLines,
} from "./agents-model.js";

/** update() reads agent_stats() once in this many calls (a scan of the traffic is not free). */
export const READ_EVERY = 5;

let panel = null;
let ui = null; // the built elements, once the engine has the API
let lastKey = null; // what the stats list shows now; null forces a read
let sinceRead = 0;
let cityId = null; // which city the last reading belongs to

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function build(api) {
  const box = el("input", { type: "checkbox", id: "agents-rules" });
  box.onchange = () => {
    // The engine decides; the next update() shows its answer.
    api.city().set_agent_rules(box.checked);
    lastKey = null;
    sinceRead = READ_EVERY;
    api.redraw();
  };
  const label = el("label", { for: "agents-rules", class: "agent-switch" });
  label.append(box, el("span", {}, SWITCH_LABEL));
  const state = el("p", { id: "agent-state", class: "agent-state" });
  const note = el("p", { class: "agent-note" }, NOTE);
  const stats = el("ul", { id: "agent-stats", class: "agent-stats" });
  panel.replaceChildren(el("h2", { id: "agent-heading" }, TITLE), label, state, note, stats);
  panel.setAttribute("aria-labelledby", "agent-heading");
  return { box, state, stats };
}

function statRow([label, value]) {
  const li = el("li", { class: "agent-row" });
  li.append(el("span", { class: "agent-label" }, label), el("span", { class: "agent-value" }, value));
  return li;
}

/** The rows while the rule is on: the traffic ones, then the transport ones when the engine has them. */
function trafficLines(city) {
  const traffic = statsLines(decodeStats(city.agent_stats()));
  if (!supportsTransport(city)) return traffic;
  return [...traffic, ...transportLines(decodeTransport(city.transport_stats()))];
}

export function setup(api) {
  panel = api.$("agents-panel");
  ui = null;
  lastKey = null;
  sinceRead = READ_EVERY;
  cityId = null;
  if (!panel) return;
  panel.hidden = true; // shown by the first update() that finds the API
}

export function update(api) {
  if (!panel || !api.isReady()) return;
  const city = api.city();
  if (!supports(city)) {
    panel.hidden = true;
    return;
  }
  if (!ui) ui = build(api);
  const rulesOn = Boolean(city.agent_rules());
  // Another city (a new one or a load) is a change the page did not make: read everything now.
  // api.game().id changes on every new city or load, before the redraw that calls update()
  const id = JSON.stringify(api.game?.()?.id ?? api.describe?.() ?? null);
  if (id !== cityId) {
    cityId = id;
    sinceRead = READ_EVERY;
  }
  if (ui.box.checked !== rulesOn) {
    ui.box.checked = rulesOn;
    sinceRead = READ_EVERY;
  }
  setText(ui.state, stateText(rulesOn));
  panel.hidden = false;
  if (++sinceRead < READ_EVERY && lastKey !== null) return;
  sinceRead = 0;

  const lines = rulesOn ? trafficLines(city) : [];
  const key = rulesOn ? lines.map((l) => l.join("|")).join(";") : "off";
  if (key === lastKey) return; // nothing the panel shows has changed
  lastKey = key;
  ui.stats.hidden = !rulesOn;
  ui.stats.replaceChildren(...lines.map(statRow));
}
