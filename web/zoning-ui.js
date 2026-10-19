// Page feature: «Densités de zonage» (docs/game-design-v07.md), the panel #zoning-panel: the rule
// switch, the number of zones by density and the farms. Presentation only (ARCHITECTURE.md rule 5):
// the engine owns the rule and the zones; update() reads them again after a load.
// setup(api) runs once after the engine exists; update(api) runs after every redraw.
import { supportsZoning, decodeStats, statsText, noteText } from "./zoning-model.js";

let panel = null;
let ui = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function build(api) {
  const box = el("input", { type: "checkbox", id: "zoning-rules" });
  box.onchange = () => {
    api.city().set_density_rules(box.checked); // off: every zone becomes dense (no cap)
    // As the structures panel does (structures-ui.js): the relief checkbox's change handler relays
    // the engine flags to the tool palette, so the «Zonage» buttons follow the switch at once.
    const relief = api.$("relief");
    if (relief) relief.dispatchEvent(new Event("change"));
    else api.redraw();
  };
  const label = el("label", { for: "zoning-rules", class: "zoning-switch" });
  label.append(box, el("span", {}, "Activer les densités de zonage"));
  const state = el("p", { id: "zoning-state", class: "zoning-state" });
  const note = el("p", { id: "zoning-note", class: "zoning-note" });
  panel.replaceChildren(el("h2", { id: "zoning-heading" }, "Densités de zonage"), label, state, note);
  panel.setAttribute("aria-labelledby", "zoning-heading");
  return { box, state, note };
}

export function setup(api) {
  panel = api.$("zoning-panel");
  ui = null;
  if (panel) panel.hidden = true;
}

export function update(api) {
  if (!panel || !api.isReady()) return;
  const city = api.city();
  if (!supportsZoning(city)) {
    panel.hidden = true;
    return;
  }
  if (!ui) ui = build(api);
  const on = Boolean(city.density_rules());
  if (ui.box.checked !== on) ui.box.checked = on;
  const text = statsText(decodeStats(city.density_stats()));
  if (ui.state.textContent !== text) ui.state.textContent = text;
  const note = noteText(on);
  if (ui.note.textContent !== note) ui.note.textContent = note;
  panel.hidden = false;
}
