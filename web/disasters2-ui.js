// Page feature: «Catastrophes et autoroutes» (docs/game-design-v13.md), the panel #disasters2-panel. Two sections: the
// disasters (the switch «Catastrophes étendues», the four «Déclencher» buttons while the rule is on, the status of
// the last trigger, the drought and the last disaster) and the highways (the switch «Autoroutes», the tiles and the
// upkeep, «Voir les autoroutes sur la carte»). Each section is shown only when the engine has its methods.
// Presentation only (ARCHITECTURE.md rule 4): the engine owns the rules, the luck and the effects; update() reads them
// again after every redraw. The French texts are in disasters2-model.js and highways-model.js (pure, tested).
// setup(api) runs once after the engine exists; update(api) runs after every redraw.
import {
  supportsDisasters, readDisastersOn, decodeDisasterStats, disasterStatsLines, disasterNoteText, triggerText, TRIGGERS,
  HEADING, DISASTERS_RULE_LABEL, TRIGGERS_GROUP_LABEL,
} from "./disasters2-model.js";
import {
  supportsHighways, readHighwaysOn, decodeHighwayStats, highwayStatsLines, highwayNoteText,
} from "./highways-model.js";
import { setHighwaysView, highwaysViewState } from "./map-layer-highways-model.js";

let panel = null;
let ui = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// The change of a switch: the engine flag is set, then the change event on the relief checkbox relays the flags to
// the tool palette (as energy-ui.js does), so the «Autoroute» button follows the switch at once.
function onRuleChange(api, setRule) {
  setRule();
  const relief = api.$("relief");
  if (relief) relief.dispatchEvent(new Event("change"));
  else api.redraw();
}

// A «Déclencher» button: the engine triggers the disaster, the status line tells the answer, the map is redrawn.
function triggerButton(api, t, status) {
  const button = el("button", { type: "button", id: `trigger-${t.kind}`, class: "disasters2-trigger" }, t.label);
  button.onclick = () => {
    status.textContent = triggerText(api.city().trigger_disaster(t.kind), t.kind);
    api.redraw();
  };
  return button;
}

function disastersSection(api) {
  const box = el("input", { type: "checkbox", id: "disasters2-rules" });
  box.onchange = () => onRuleChange(api, () => api.city().set_disaster2_rules(box.checked));
  const label = el("label", { for: "disasters2-rules", class: "disasters2-switch" });
  label.append(box, el("span", {}, DISASTERS_RULE_LABEL));
  const note = el("p", { class: "disasters2-note" });
  const status = el("p", { id: "disasters2-status", class: "disasters2-status", role: "status" });
  const triggers = el("div", {
    id: "disasters2-triggers", class: "disasters2-triggers", role: "group", "aria-label": TRIGGERS_GROUP_LABEL,
  });
  triggers.append(...TRIGGERS.map((t) => triggerButton(api, t, status)));
  const stats = el("ul", { id: "disasters2-stats", class: "disasters2-stats" });
  const section = el("div", { id: "disasters2-section", class: "disasters2-section" });
  section.append(label, note, triggers, status, stats);
  return { section, box, note, triggers, stats };
}

function highwaysSection(api) {
  const box = el("input", { type: "checkbox", id: "highways-rules" });
  box.onchange = () => onRuleChange(api, () => api.city().set_highway_rules(box.checked));
  const label = el("label", { for: "highways-rules", class: "disasters2-switch" });
  label.append(box, el("span", {}, "Autoroutes"));
  const note = el("p", { class: "disasters2-note" });
  const stats = el("ul", { id: "highways-stats", class: "disasters2-stats" });
  // «Voir les autoroutes sur la carte»: the 2D layer (map-layer-highways.js) strokes them.
  const view = el("input", { type: "checkbox", id: "highways-view" });
  view.onchange = () => {
    setHighwaysView(view.checked);
    api.redraw();
  };
  const viewLabel = el("label", { for: "highways-view", class: "disasters2-switch" });
  viewLabel.append(view, el("span", {}, "Voir les autoroutes sur la carte"));
  const section = el("div", { id: "highways-section", class: "disasters2-section" });
  section.append(label, note, stats, viewLabel);
  return { section, box, note, stats, view, viewLabel };
}

function build(api) {
  const disasters = disastersSection(api);
  const highways = highwaysSection(api);
  panel.replaceChildren(el("h2", { id: "disasters2-heading" }, HEADING), disasters.section, highways.section);
  panel.setAttribute("aria-labelledby", "disasters2-heading");
  return { disasters, highways, keys: {} };
}

// Writes a list only when its lines changed (the lists are rebuilt on a change, not every frame).
function setLines(list, keys, name, lines) {
  const text = lines.join("\n");
  if (keys[name] === text) return;
  keys[name] = text;
  list.replaceChildren(...lines.map((line) => el("li", {}, line)));
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function updateDisasters(city, d, keys) {
  const on = readDisastersOn(city);
  if (d.box.checked !== on) d.box.checked = on;
  d.triggers.hidden = !on;
  setText(d.note, disasterNoteText(on));
  setLines(d.stats, keys, "disasters", disasterStatsLines(decodeDisasterStats(city.disaster2_stats())));
}

function updateHighways(city, h, keys) {
  const on = readHighwaysOn(city);
  if (h.box.checked !== on) h.box.checked = on;
  setText(h.note, highwayNoteText(on));
  h.viewLabel.hidden = !on;
  // The view is the module's state: off with the rule, and the box follows it.
  if (!on && highwaysViewState().show) setHighwaysView(false);
  const shown = highwaysViewState().show;
  if (h.view.checked !== shown) h.view.checked = shown;
  setLines(h.stats, keys, "highways", highwayStatsLines(decodeHighwayStats(city.highway_stats())));
}

export function setup(api) {
  panel = api.$("disasters2-panel");
  ui = null;
  if (panel) panel.hidden = true;
}

export function update(api) {
  if (!panel || !api.isReady()) return;
  const city = api.city();
  const hasDisasters = supportsDisasters(city);
  const hasHighways = supportsHighways(city);
  if (!hasDisasters && !hasHighways) {
    panel.hidden = true;
    return;
  }
  if (!ui) ui = build(api);
  ui.disasters.section.hidden = !hasDisasters;
  ui.highways.section.hidden = !hasHighways;
  if (hasDisasters) updateDisasters(city, ui.disasters, ui.keys);
  if (hasHighways) updateHighways(city, ui.highways, ui.keys);
  panel.hidden = false;
}
