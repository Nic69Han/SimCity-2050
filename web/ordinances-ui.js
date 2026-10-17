// Page feature of the ordinances workstream (docs/game-design-v02.md): the panel #ordinances-panel,
// one checkbox per ordinance with its monthly cost and a one-line effect, and the total cost.
// Presentation only (ARCHITECTURE.md rule 5): the engine owns the rules and the active set; the page
// keeps no copy of it. After a load or a new city, update() reads the engine again, so the page
// never pushes its state into a fresh city. The French texts are in ordinances-model.js.
// setup(api) runs once after the engine exists; update(api) runs after every redraw.
// api = { city(): the engine, $(id): getElementById, redraw(), isReady() }.
import { costText, readOrdinances, snapshotKey, supports, totalText } from "./ordinances-model.js";

let panel = null;
let ui = null; // { rows: [{ box, cost, effect }], total } once built
let lastKey = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function build(items, api) {
  const rows = items.map((item) => {
    const id = `ord-${item.key}`;
    const box = el("input", { type: "checkbox", id, "data-index": String(item.index) });
    const cost = el("span", { class: "ord-cost" });
    const effect = el("span", { class: "ord-effect", id: `${id}-effect` });
    box.setAttribute("aria-describedby", `${id}-effect`);
    box.onchange = () => {
      // The engine decides; the next update() shows its answer (a refused change unticks the box).
      api.city().set_ordinance(item.index, box.checked);
      lastKey = null;
      api.redraw();
    };
    const name = el("label", { for: id, class: "ord-name" }, item.label);
    const li = el("li", { class: "ord-row", title: item.help }, undefined);
    li.append(box, name, cost, effect);
    return { li, box, cost, effect };
  });
  const total = el("p", { id: "ord-total", class: "ord-total", role: "status", "aria-live": "polite" });
  const list = el("ul", { class: "ord-list" });
  list.append(...rows.map((r) => r.li));
  panel.replaceChildren(
    el("h2", { id: "ord-heading" }, "Ordonnances"),
    el("p", { class: "ord-note" }, "Chaque ordonnance coûte à chaque collecte des impôts, une fois par an."),
    list,
    total,
  );
  panel.setAttribute("aria-labelledby", "ord-heading");
  return { rows, total };
}

export function setup(api) {
  panel = api.$("ordinances-panel");
  ui = null;
  lastKey = null;
  if (!panel) return;
  panel.hidden = true; // shown by the first update() that finds the API
}

export function update(api) {
  if (!panel || !api.isReady()) return;
  const city = api.city();
  if (!supports(city) || !(Number(city.ordinance_count()) > 0)) {
    panel.hidden = true;
    return;
  }
  const items = readOrdinances(city);
  const key = snapshotKey(items);
  if (key === lastKey && ui) return; // nothing the panel shows has changed
  if (!ui || ui.rows.length !== items.length) ui = build(items, api);
  lastKey = key;
  items.forEach((item, i) => {
    const row = ui.rows[i];
    if (row.box.checked !== item.active) row.box.checked = item.active;
    setText(row.cost, costText(item.info.cost));
    setText(row.effect, item.effect);
  });
  setText(ui.total, totalText(items));
  panel.hidden = false;
}
