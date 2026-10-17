// Page feature of the water network (docs/game-design-v02.md): the «Réseau d'eau» rule checkbox
// and the «Voir le réseau» view toggle in #rules-controls, the stats line, and the state of the
// water tool buttons. main.js calls setup(api) once and update(api) after every redraw.
// The checkbox shows the engine's flag, read after every redraw (so after a load or a new city);
// the page never pushes it into a fresh city.
import {
  WATER_HELP, WATER_VIEW_HELP, WATER_TOOL_KEYS, supportsWater, readWater, setWater,
  waterToolPressed, statsText,
} from "./water-model.js";
import { setWaterView } from "./map-layer-water.js";
import { blockedReason, buttonTitle } from "./tools-water.js";

let ui = null; // the elements this feature created (null before setup, or without a water engine)

function checkbox(id, text, help) {
  const label = document.createElement("label");
  label.title = help;
  const input = document.createElement("input");
  input.id = id;
  input.type = "checkbox";
  label.append(input, ` ${text}`);
  return { label, input };
}

export function setup(api) {
  const city = api.city();
  const host = api.$("rules-controls");
  if (!host || !supportsWater(city)) return;
  const rule = checkbox("water-rules", "Réseau d'eau", WATER_HELP);
  const view = checkbox("water-view", "Voir le réseau", WATER_VIEW_HELP);
  const stats = document.createElement("span");
  stats.id = "water-stats";
  stats.className = "water-stats";
  stats.setAttribute("role", "status");
  view.label.hidden = true;
  host.append(rule.label, view.label, stats);
  ui = { rule: rule.input, view: view.input, viewLabel: view.label, stats, palette: api.$("palette"), frame: api.$("map-frame") };

  rule.input.onchange = () => {
    rule.input.checked = setWater(api.city(), rule.input.checked); // the engine's answer
    api.redraw();
  };
  view.input.onchange = () => {
    if (setWaterView({ show: view.input.checked })) api.redraw();
  };
  // A chosen water tool shows the network: follow the palette's pressed buttons.
  new MutationObserver(() => {
    if (setWaterView({ tool: waterToolPressed(pressedKeys()) })) api.redraw();
  }).observe(ui.palette, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
}

function pressedKeys() {
  return [...ui.palette.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.dataset.tool);
}

// The buttons of the water tools follow the engine's flag and the view (tools.js only learns the
// flags that main.js hands it, and water is not one of them).
function syncButtons(city) {
  const reason = blockedReason(city, { in3d: ui.frame.classList.contains("is-3d") });
  for (const key of WATER_TOOL_KEYS) {
    const b = ui.palette.querySelector(`button[data-tool="${key}"]`);
    if (!b) continue;
    b.disabled = reason !== "";
    b.title = buttonTitle(key, reason);
  }
}

export function update(api) {
  if (!ui) return;
  const city = api.city();
  const on = readWater(city);
  ui.rule.checked = on;
  ui.viewLabel.hidden = !on;
  if (!on) {
    ui.view.checked = false;
    setWaterView({ show: false });
  }
  const text = on ? statsText(Array.from(city.water_stats())) : "";
  if (ui.stats.textContent !== text) ui.stats.textContent = text;
  syncButtons(city);
}
