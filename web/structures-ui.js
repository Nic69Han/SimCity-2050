// Page feature: «Bâtiments étendus» (docs/game-design-v04.md), the panel #structures-panel: the rule
// switch, the number of buildings and their monthly upkeep. Presentation only (ARCHITECTURE.md
// rule 5): the engine owns the rule and the buildings; update() reads them again after a load.
// setup(api) runs once after the engine exists; update(api) runs after every redraw.
const REQUIRED = ["structure_rules", "set_structure_rules", "structures", "structures_upkeep"];
const RECORD = 6;

/** Whether `city` has the extended buildings API. */
export function supports(city) {
  return REQUIRED.every((m) => typeof city?.[m] === "function");
}

/** The text under the switch: state, count and monthly upkeep (French). */
export function summaryText(on, count, upkeep) {
  if (!on) return "Désactivés : le groupe « Bâtiments » de la palette est fermé.";
  const n = Math.max(0, Math.trunc(count) || 0);
  const what = n === 0 ? "aucun bâtiment" : n === 1 ? "1 bâtiment" : `${n.toLocaleString("fr-FR")} bâtiments`;
  const cost = Math.max(0, Math.trunc(upkeep) || 0).toLocaleString("fr-FR");
  return `Activés : ${what}, entretien ${cost} $ par mois.`;
}

let panel = null;
let ui = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function build(api) {
  const box = el("input", { type: "checkbox", id: "structures-rules" });
  box.onchange = () => {
    api.city().set_structure_rules(box.checked); // off: the engine removes every building
    // As the metro panel does (transit-ui.js): the relief checkbox's handler relays the engine flags
    // to the tool palette and redraws, so the «Bâtiments» buttons follow the switch at once.
    const relief = api.$("relief");
    if (relief) relief.dispatchEvent(new Event("change"));
    else api.redraw();
  };
  const label = el("label", { for: "structures-rules", class: "structures-switch" });
  label.append(box, el("span", {}, "Activer les bâtiments étendus"));
  const state = el("p", { id: "structures-state", class: "structures-state" });
  const note = el("p", { class: "structures-note" },
    "Parcs, places et monuments du groupe « Bâtiments » ; les éteindre démolit les bâtiments posés sans remboursement.");
  panel.replaceChildren(el("h2", { id: "structures-heading" }, "Bâtiments étendus"), label, state, note);
  panel.setAttribute("aria-labelledby", "structures-heading");
  return { box, state };
}

export function setup(api) {
  panel = api.$("structures-panel");
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
  const on = Boolean(city.structure_rules());
  if (ui.box.checked !== on) ui.box.checked = on;
  const count = on ? Math.floor((city.structures()?.length ?? 0) / RECORD) : 0;
  const text = summaryText(on, count, on ? city.structures_upkeep() : 0);
  if (ui.state.textContent !== text) ui.state.textContent = text;
  panel.hidden = false;
}
