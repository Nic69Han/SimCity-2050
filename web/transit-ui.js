// Page feature of the metro (docs/game-design-v02.md): the «Métro» rule checkbox in
// #rules-controls, the «Plan du métro» toggle and a stats line. setup(api) and update(api) are
// called by main.js (update after every redraw). The page shows the engine's flag, read after
// every redraw (so after a load or a new city, which may carry the rule on); it never pushes the
// checkbox into a city.
import {
  TRANSIT_HELP, supportsTransit, readTransit, setTransit, formatTransitStats, setPlanShown,
  setMetroToolActive, isMetroToolActive,
} from "./transit-model.js";

const METRO_TOOL_BUTTONS = '#palette button.tool.active[data-tool="metro_tunnel"], ' +
  '#palette button.tool.active[data-tool="metro_station"]';

let ui = null; // { rules, plan, planLabel, stats, label }

function control(api, id, text, title) {
  const label = document.createElement("label");
  label.id = `${id}-label`;
  if (title) label.title = title;
  const box = document.createElement("input");
  box.type = "checkbox";
  box.id = id;
  label.append(box, ` ${text}`);
  return { label, box };
}

export function setup(api) {
  const city = api.city();
  const host = api.$("rules-controls");
  if (!host || !supportsTransit(city)) return;
  const rules = control(api, "transit", "Métro", TRANSIT_HELP);
  const plan = control(api, "transit-plan", "Plan du métro",
    "Montre les tunnels, les stations et la portée des lignes en service sur la carte.");
  const stats = document.createElement("span");
  stats.id = "transit-stats";
  stats.setAttribute("role", "status");
  host.append(rules.label, plan.label, stats);
  ui = { rules: rules.box, plan: plan.box, planLabel: plan.label, stats };

  rules.box.onchange = () => {
    rules.box.checked = setTransit(api.city(), rules.box.checked); // the engine's answer
    showState(api);
    // main.js relays an engine flag to the tool palette (tools.setFlag) in the relief checkbox's
    // handler, which also redraws: running it re-evaluates which metro buttons are allowed, and
    // drops a metro tool that has just become forbidden. It only re-sends the engine's own value.
    const relief = api.$("relief");
    if (relief) relief.dispatchEvent(new Event("change"));
    else api.redraw();
  };
  plan.box.onchange = () => {
    setPlanShown(plan.box.checked);
    api.redraw();
  };
  // A metro tool chosen or dropped (button, shortcut or Échap) changes the pressed buttons of the
  // palette: the map then shows or hides the network.
  const palette = api.$("palette");
  if (palette) {
    new MutationObserver(() => {
      const active = palette.querySelector(METRO_TOOL_BUTTONS) !== null;
      if (active === isMetroToolActive()) return;
      setMetroToolActive(active);
      api.redraw();
    }).observe(palette, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  }
}

// Shows the engine's flag and numbers.
function showState(api) {
  const city = api.city();
  const on = readTransit(city);
  ui.rules.checked = on;
  ui.planLabel.hidden = !on;
  ui.stats.hidden = !on;
  ui.stats.textContent = on ? formatTransitStats(city.transit_stats()) : "";
}

export function update(api) {
  if (ui) showState(api);
}
