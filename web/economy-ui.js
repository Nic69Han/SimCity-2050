// Page feature: «Économie» (docs/game-design-v11.md), the panel #economy-panel: the rule switch «Économie détaillée», the
// 3 x 3 table of tax rates (residential, commercial, industrial by wealth class) with the yearly income of each case, the
// bonds with «Rembourser» and «Émettre une obligation», and the goods of the last year. Presentation only (ARCHITECTURE.md
// rule 4): the engine owns the rule, the rates, the bonds and the goods; update() reads them again after every change. The
// French texts and the decoding are in economy-model.js (pure, tested). setup(api) runs once after the engine exists;
// update(api) runs after every redraw.
import {
  supports, readRulesOn, decodeRates, decodeIncome, decodeBonds, decodeOffer, decodeGoods, parseRate, cellIndex,
  bondLine, offerLabel, goodsLines, incomeText, ruleNote, issueMessage, repayMessage, taxMessage, NO_BONDS_TEXT,
  ISSUE_LABEL, GENRES, CLASSES, MAX_TAX_RATE,
} from "./economy-model.js";
import { setWealthView } from "./map-layer-wealth-model.js";

let panel = null;
let ui = null;

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// The rule switch: the engine flag, then the change event on the relief checkbox, which relays the flags to the tool
// palette (as energy-ui.js does), so the buildings follow the switch at once.
function onRuleChange(api, box) {
  api.city().set_economy_rules(box.checked);
  const relief = api.$("relief");
  if (relief) relief.dispatchEvent(new Event("change"));
  else api.redraw();
}

// One tax case: a number input (0..20) and, under it, the income of the last year.
function taxCell(api, genre, cls) {
  const id = `tax-${genre.id}-${cls.id}`;
  const input = el("input", {
    type: "number", id, min: "0", max: String(MAX_TAX_RATE), step: "1",
    "aria-label": `${genre.label}, ${cls.label}`,
  });
  input.onchange = () => onTaxChange(api, genre.id, cls.id);
  const income = el("span", { id: `tax-income-${genre.id}-${cls.id}`, class: "economy-income" });
  const td = el("td", {});
  td.append(input, income);
  return { td, input, income };
}

function buildTaxTable(api) {
  const table = el("table", { id: "economy-taxes", class: "economy-taxes" });
  const head = el("tr");
  head.append(el("th", { scope: "col" }, "Impôts"), ...CLASSES.map((c) => el("th", { scope: "col" }, c.label)));
  const body = el("tbody");
  const inputs = [];
  const incomes = [];
  for (const genre of GENRES) {
    const row = el("tr");
    row.append(el("th", { scope: "row" }, genre.label));
    for (const cls of CLASSES) {
      const cell = taxCell(api, genre, cls);
      inputs[cellIndex(genre.id, cls.id)] = cell.input;
      incomes[cellIndex(genre.id, cls.id)] = cell.income;
      row.append(cell.td);
    }
    body.append(row);
  }
  table.replaceChildren(el("thead", {}, head), body);
  return { table, inputs, incomes };
}

function buildBonds(api) {
  const list = el("ul", { id: "economy-bond-list", class: "economy-bond-list", "aria-label": "Obligations" });
  const issue = el("button", { type: "button", id: "bond-issue", class: "economy-issue" }, ISSUE_LABEL);
  issue.onclick = () => onIssue(api);
  const block = el("div", { id: "economy-bonds", class: "economy-bonds" });
  block.append(el("h3", {}, "Obligations"), list, issue);
  return { block, list, issue, keys: {} };
}

function build(api) {
  const box = el("input", { type: "checkbox", id: "economy-rules" });
  box.onchange = () => onRuleChange(api, box);
  const label = el("label", { for: "economy-rules", class: "economy-switch" });
  label.append(box, el("span", {}, "Économie détaillée"));
  // «Voir la richesse»: the 2D layer (map-layer-wealth.js) tints the zones by wealth class
  const view = el("input", { type: "checkbox", id: "economy-wealth-view" });
  view.onchange = () => {
    setWealthView(view.checked);
    api.redraw();
  };
  const viewLabel = el("label", { for: "economy-wealth-view", class: "economy-switch" });
  viewLabel.append(view, el("span", {}, "Voir la richesse sur la carte"));
  const note = el("p", { id: "economy-note", class: "economy-note" });
  const taxes = buildTaxTable(api);
  const bonds = buildBonds(api);
  const goods = el("ul", { id: "economy-goods", class: "economy-goods", "aria-label": "Marchandises" });
  const status = el("p", { id: "economy-status", class: "economy-status", "aria-live": "polite" });
  panel.replaceChildren(el("h2", { id: "economy-heading" }, "Économie"), label, viewLabel, note, taxes.table, bonds.block, goods, status);
  panel.setAttribute("aria-labelledby", "economy-heading");
  return { box, view, viewLabel, note, taxes, bonds, goods, status, keys: {} };
}

// A tax change: the page reads the input, the engine decides (set_tax_rate returns a boolean), and the input shows the
// engine's value again, so a refused change goes back to the rate that holds. The input is written here even when it has
// the focus: writeTaxes leaves a focused input alone (the player may be typing), and the change event is the moment to
// settle it.
function onTaxChange(api, genre, cls) {
  const index = cellIndex(genre, cls);
  const input = ui.taxes.inputs[index];
  const city = api.city();
  const rate = parseRate(input.value);
  const ok = rate !== null && Boolean(city.set_tax_rate(genre, cls, rate));
  ui.status.textContent = taxMessage(ok);
  input.value = String(decodeRates(city.tax_rates())[index]);
  update(api);
}

function onIssue(api) {
  ui.status.textContent = issueMessage(api.city().issue_bond());
  update(api);
}

function onRepay(api, index) {
  ui.status.textContent = repayMessage(api.city().repay_bond(index));
  update(api);
}

// Writes the nine rates and their income. A rate is written only when its input differs and is not the focused one: the
// update runs every frame while the game plays, and a number input fires its change only on blur or Enter, so the value
// the player is typing must not be reset (onTaxChange writes the engine's value once the change is made).
function writeTaxes(city, on) {
  const rates = decodeRates(city.tax_rates());
  const income = decodeIncome(city.tax_income());
  rates.forEach((rate, i) => {
    const input = ui.taxes.inputs[i];
    if (document.activeElement !== input && input.value !== String(rate)) input.value = String(rate);
    input.disabled = !on;
    const text = incomeText(income[i]);
    if (ui.taxes.incomes[i].textContent !== text) ui.taxes.incomes[i].textContent = text;
  });
}

function bondItems(api, bonds, on) {
  if (bonds.length === 0) return [el("li", {}, NO_BONDS_TEXT)];
  return bonds.map((b, index) => {
    const line = bondLine(b);
    const repay = el("button", { type: "button", "aria-label": `Rembourser : ${line}` }, "Rembourser");
    repay.disabled = !on;
    repay.onclick = () => onRepay(api, index);
    const li = el("li", {});
    li.append(el("span", {}, line), " ", repay);
    return li;
  });
}

// The bond list and the issue button: the list is rebuilt only when a bond or the rule changes.
function writeBonds(api, city, on) {
  const bonds = decodeBonds(city.bonds());
  const offer = decodeOffer(city.bond_offer());
  ui.bonds.issue.textContent = offerLabel(offer);
  ui.bonds.issue.disabled = !on || !offer.available;
  const key = JSON.stringify([on, bonds]);
  if (ui.bonds.keys.list === key) return;
  ui.bonds.keys.list = key;
  ui.bonds.list.replaceChildren(...bondItems(api, bonds, on));
}

// The goods lines are rebuilt only when their text changes.
function writeGoods(city) {
  const lines = goodsLines(decodeGoods(city.goods_stats()));
  const text = lines.join("\n");
  if (ui.keys.goods === text) return;
  ui.keys.goods = text;
  ui.goods.replaceChildren(...lines.map((line) => el("li", {}, line)));
}

export function setup(api) {
  panel = api.$("economy-panel");
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
  if (!on && ui.view.checked) {
    ui.view.checked = false;
    setWealthView(false);
  }
  writeTaxes(city, on);
  writeBonds(api, city, on);
  writeGoods(city);
  const note = ruleNote(on);
  if (ui.note.textContent !== note) ui.note.textContent = note;
  panel.hidden = false;
}
