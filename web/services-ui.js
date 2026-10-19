// Page feature: «Services publics» (docs/game-design-v09.md), the panel #services-panel: the rule switch, the
// coverage view (education, health, security) and the statistics. Presentation only (ARCHITECTURE.md rule 5):
// the engine owns the rule, the capacities and the coverage; update() reads them again after a load.
// setup(api) runs once after the engine exists; update(api) runs after every redraw.
import { supports, readRulesOn, decodeStats, statsLines, noteText, VIEWS, viewKind } from "./services-model.js";
import { setCoverageView } from "./map-layer-coverage-model.js";

let panel = null;
let ui = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// The rule switch: the engine flag, then the change event on the relief checkbox, whose handler relays the flags
// to the tool palette (as zoning-ui.js does), so the buildings follow the switch at once.
function onRuleChange(api, box) {
  api.city().set_service_rules(box.checked);
  const relief = api.$("relief");
  if (relief) relief.dispatchEvent(new Event("change"));
  else api.redraw();
}

// The coverage choice: one select, «Aucune» first. The map layer draws the chosen coverage on the next redraw.
function buildView(api) {
  const view = el("select", { id: "services-view", "aria-label": "Couverture affichée sur la carte" });
  for (const v of VIEWS) view.append(el("option", { value: v.key }, v.label));
  view.onchange = () => {
    setCoverageView(viewKind(view.value));
    api.redraw();
  };
  const label = el("label", { for: "services-view", class: "services-view" });
  label.append(el("span", {}, "Couverture sur la carte : "), view);
  return { view, label };
}

function build(api) {
  const box = el("input", { type: "checkbox", id: "services-rules" });
  box.onchange = () => onRuleChange(api, box);
  const label = el("label", { for: "services-rules", class: "services-switch" });
  label.append(box, el("span", {}, "Activer les services publics"));
  const { view, label: viewLabel } = buildView(api);
  const stats = el("ul", { id: "services-stats", class: "services-stats" });
  const note = el("p", { id: "services-note", class: "services-note" });
  panel.replaceChildren(el("h2", { id: "services-heading" }, "Services publics"), label, viewLabel, stats, note);
  panel.setAttribute("aria-labelledby", "services-heading");
  return { box, view, viewLabel, stats, note, statsText: null };
}

// Writes the statistics lines only when they changed (the list is rebuilt on a change, not every frame).
function setStats(ui, lines) {
  const text = lines.join("\n");
  if (ui.statsText === text) return;
  ui.statsText = text;
  ui.stats.replaceChildren(...lines.map((line) => el("li", {}, line)));
}

export function setup(api) {
  panel = api.$("services-panel");
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
  ui.viewLabel.hidden = !on;
  // the coverage view belongs to the rule: when it goes off, the map drops the coverage too
  if (!on && ui.view.value !== "") {
    ui.view.value = "";
    setCoverageView(null);
  }
  setStats(ui, statsLines(decodeStats(city.service_stats())));
  const note = noteText(on);
  if (ui.note.textContent !== note) ui.note.textContent = note;
  panel.hidden = false;
}
