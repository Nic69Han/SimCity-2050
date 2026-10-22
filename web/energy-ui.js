// Page feature: «Énergie» (docs/game-design-v10.md), the panel #energy-panel: the rule switch «Énergie étendue»,
// the statistics and the list of power plants with their age and power. Presentation only (ARCHITECTURE.md
// rule 5): the engine owns the rule, the power, the ageing and the purchases; update() reads them again after a
// load. The French texts and the decoding are in energy-model.js (pure, tested). setup(api) runs once after the
// engine exists; update(api) runs after every redraw.
import { supports, readRulesOn, decodeStats, decodePlants, statsLines, plantsLines, noteText } from "./energy-model.js";

let panel = null;
let ui = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// The rule switch: the engine flag, then the change event on the relief checkbox, whose handler relays the flags
// to the tool palette (as services-ui.js does), so the buildings follow the switch at once.
function onRuleChange(api, box) {
  api.city().set_energy_rules(box.checked);
  const relief = api.$("relief");
  if (relief) relief.dispatchEvent(new Event("change"));
  else api.redraw();
}

function build(api) {
  const box = el("input", { type: "checkbox", id: "energy-rules" });
  box.onchange = () => onRuleChange(api, box);
  const label = el("label", { for: "energy-rules", class: "energy-switch" });
  label.append(box, el("span", {}, "Énergie étendue"));
  const stats = el("ul", { id: "energy-stats", class: "energy-stats" });
  const plants = el("ul", { id: "energy-plants", class: "energy-plants", "aria-label": "Centrales" });
  const note = el("p", { id: "energy-note", class: "energy-note" });
  panel.replaceChildren(el("h2", { id: "energy-heading" }, "Énergie"), label, stats, plants, note);
  panel.setAttribute("aria-labelledby", "energy-heading");
  return { box, stats, plants, note, keys: {} };
}

// Writes a list only when its lines changed (the lists are rebuilt on a change, not every frame).
function setList(list, keys, name, lines) {
  const text = lines.join("\n");
  if (keys[name] === text) return;
  keys[name] = text;
  list.replaceChildren(...lines.map((line) => el("li", {}, line)));
}

export function setup(api) {
  panel = api.$("energy-panel");
  ui = null;
  if (panel) panel.hidden = true;
}

export function update(api) {
  if (!panel || !api.isReady()) return;
  const city = api.city();
  if (!supports(city)) {
    panel.hidden = true;
    return;
  }
  if (!ui) ui = build(api);
  const on = readRulesOn(city);
  if (ui.box.checked !== on) ui.box.checked = on;
  setList(ui.stats, ui.keys, "stats", statsLines(decodeStats(city.energy_stats())));
  setList(ui.plants, ui.keys, "plants", plantsLines(decodePlants(city.power_plants())));
  const note = noteText(on);
  if (ui.note.textContent !== note) ui.note.textContent = note;
  panel.hidden = false;
}
