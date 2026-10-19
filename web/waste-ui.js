// Page feature: «Déchets» (docs/game-design-v08.md), the panel #waste-panel: the rule switch, the switch
// «Voir les ordures sur la carte» and the statistics. Presentation only (ARCHITECTURE.md rule 5): the engine
// owns the rule, the garbage and the landfills; update() reads them again after a load. The French texts and
// the decoding are in waste-model.js (pure, tested). setup(api) runs once after the engine exists; update(api)
// runs after every redraw.
import { supports, decodeStats, statsLines, noteText } from "./waste-model.js";
import { setWasteView } from "./map-layer-waste-model.js";

let panel = null;
let ui = null;
let lastStats = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function build(api) {
  const box = el("input", { type: "checkbox", id: "waste-rules" });
  box.onchange = () => {
    api.city().set_waste_rules(box.checked); // off: the engine stops the production
    // As the zoning panel does (zoning-ui.js): the relief checkbox's change handler relays the engine
    // flags to the tool palette, so the palette follows the switch at once.
    const relief = api.$("relief");
    if (relief) relief.dispatchEvent(new Event("change"));
    else api.redraw();
  };
  const label = el("label", { for: "waste-rules", class: "waste-switch" });
  label.append(box, el("span", {}, "Activer la gestion des déchets"));
  // «Voir les ordures sur la carte»: the 2D layer (map-layer-waste-model.js) shows the garbage on the map
  const view = el("input", { type: "checkbox", id: "waste-view" });
  view.onchange = () => {
    setWasteView(view.checked);
    api.redraw();
  };
  const viewLabel = el("label", { for: "waste-view", class: "waste-switch" });
  viewLabel.append(view, el("span", {}, "Voir les ordures sur la carte"));
  const stats = el("ul", { id: "waste-stats", class: "waste-stats" });
  const note = el("p", { id: "waste-note", class: "waste-note" });
  panel.replaceChildren(el("h2", { id: "waste-heading" }, "Déchets"), label, viewLabel, stats, note);
  panel.setAttribute("aria-labelledby", "waste-heading");
  return { box, view, viewLabel, stats, note };
}

export function setup(api) {
  panel = api.$("waste-panel");
  ui = null;
  lastStats = null;
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
  const on = Boolean(city.waste_rules());
  if (ui.box.checked !== on) ui.box.checked = on;
  ui.viewLabel.hidden = !on;
  if (!on && ui.view.checked) {
    ui.view.checked = false;
    setWasteView(false);
  }
  const lines = statsLines(decodeStats(city.waste_stats()));
  const key = lines.join("\n");
  if (key !== lastStats) {
    lastStats = key;
    ui.stats.replaceChildren(...lines.map((text) => el("li", {}, text)));
  }
  const note = noteText(on);
  if (ui.note.textContent !== note) ui.note.textContent = note;
  panel.hidden = false;
}
