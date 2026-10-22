// Tests of the economy panel (web/economy-ui.js) with a fake document and the mock engine (economy: true): the switch
// writes the engine flag and relays the change to the relief box; the tax table writes the engine's rates and shows the
// income of each case; the bonds are issued and repaid through the engine, the issue button follows the offer; the goods
// follow the engine; the lists are rebuilt only when they change.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../economy-ui.js";
import { wealthViewState } from "../map-layer-wealth-model.js";
import * as M from "../economy-model.js";
import { MockCity, MOCK_TOOLS } from "./mock-engine.mjs";
import { MAX_BONDS, MOCK_TAX_START, TAX_INCOME_PER_POINT } from "./mock-economy.mjs";
import { formatMoney } from "../budget-text.js";

// ---- fake document ------------------------------------------------------------------------

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.replaced = 0; // how many times the children were rebuilt
    this._text = "";
    this.events = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  append(...nodes) {
    this.children.push(...nodes.map((n) => (typeof n === "string" ? textNode(n) : n)));
  }
  replaceChildren(...nodes) {
    this.children = nodes;
    this.replaced++;
  }
  dispatchEvent(event) {
    this.events.push(event.type);
  }
  find(pred, out = []) {
    if (pred(this)) out.push(this);
    for (const c of this.children) c.find(pred, out);
    return out;
  }
}

function textNode(text) {
  const n = new Node("#text");
  n._text = text;
  return n;
}

globalThis.Event ??= class { constructor(type) { this.type = type; } };

/** A page with the economy panel, the relief checkbox (its change relays the flags) and the given engine. */
function setupPage(city, { ready = true, relief = true } = {}) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  const panel = new Node("section");
  panel.hidden = true;
  const reliefBox = new Node("input");
  const api = {
    city: () => city,
    $: (id) => (id === "economy-panel" ? panel : id === "relief" && relief ? reliefBox : null),
    redraw: () => { api.redraws = (api.redraws ?? 0) + 1; ui.update(api); },
    isReady: () => ready,
    reliefBox,
  };
  ui.setup(api);
  ui.update(api);
  return { api, panel };
}

const byId = (panel, id) => panel.find((n) => n.attributes.id === id)[0];
const byIdOrNull = (panel, id) => panel.find((n) => n.attributes.id === id)[0] ?? null;
const rules = (panel) => byId(panel, "economy-rules");
const note = (panel) => byId(panel, "economy-note");
const status = (panel) => byId(panel, "economy-status").textContent;
const taxInput = (panel, g, c) => byId(panel, `tax-${g}-${c}`);
const taxIncome = (panel, g, c) => byId(panel, `tax-income-${g}-${c}`).textContent;
const listTexts = (panel, id) => byId(panel, id).children.map((c) => c.textContent);
const issueButton = (panel) => byId(panel, "bond-issue");
const repayButtons = (panel) => byId(panel, "economy-bond-list").find((n) => n.tagName === "button");
const norm = (s) => s.replace(/[  ]/g, " ");

describe("the panel, the switch and the note", () => {
  test("h2 «Économie», the switch «Économie détaillée», the tax table, the bonds, the goods and the status", () => {
    const { panel } = setupPage(new MockCity(1, { economy: true }));
    assert.equal(panel.hidden, false);
    assert.equal(byId(panel, "economy-heading").textContent, "Économie");
    const label = panel.find((n) => n.attributes.class === "economy-switch")[0];
    assert.equal(label.textContent, "Économie détaillée");
    assert.ok(byId(panel, "economy-taxes"));
    assert.ok(byId(panel, "economy-bonds"));
    assert.ok(byId(panel, "economy-goods"));
    assert.ok(byId(panel, "economy-status"));
    assert.equal(note(panel).textContent, M.ruleNote(false));
  });

  test("the switch writes the engine flag, relays the change to the relief box and updates the note", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    rules(panel).checked = true;
    rules(panel).onchange();
    ui.update(api);
    assert.equal(city.economy_rules(), true);
    assert.deepEqual(api.reliefBox.events, ["change"]);
    assert.equal(note(panel).textContent, M.ruleNote(true));
  });

  test("«Voir la richesse» shows only with the rule on, sets the wealth view and redraws; the rule off clears it", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    const view = byId(panel, "economy-wealth-view");
    const viewLabel = panel.find((n) => n.attributes.for === "economy-wealth-view")[0];
    assert.equal(viewLabel.hidden, true, "hidden while the rule is off");
    city.set_economy_rules(true);
    ui.update(api);
    assert.equal(viewLabel.hidden, false);
    view.checked = true;
    view.onchange();
    assert.equal(wealthViewState().show, true);
    assert.equal(api.redraws, 1);
    city.set_economy_rules(false);
    ui.update(api);
    assert.equal(view.checked, false);
    assert.equal(wealthViewState().show, false);
  });

  test("without the relief box the switch redraws the map instead", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city, { relief: false });
    rules(panel).checked = true;
    rules(panel).onchange();
    assert.equal(city.economy_rules(), true);
    assert.equal(api.redraws, 1);
  });

  test("the box follows the engine after a change made elsewhere (a load, a new city)", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    ui.update(api);
    assert.equal(rules(panel).checked, true);
    city.new_random_city(3);
    ui.update(api);
    assert.equal(rules(panel).checked, false);
  });
});

describe("the tax table", () => {
  test("nine inputs with ids tax-<genre>-<class>, min 0 and max 20, and an income under each", () => {
    const { panel } = setupPage(new MockCity(1, { economy: true }));
    for (const g of [1, 2, 3]) {
      for (const c of [1, 2, 3]) {
        const input = taxInput(panel, g, c);
        assert.equal(input.attributes.type, "number");
        assert.equal(input.attributes.min, "0");
        assert.equal(input.attributes.max, "20");
        assert.ok(byId(panel, `tax-income-${g}-${c}`));
      }
    }
    assert.equal(panel.find((n) => n.attributes.id?.startsWith("tax-") && n.tagName === "input").length, 9);
  });

  test("the inputs show the engine's rates; the income of each case is shown with its unit", () => {
    const city = new MockCity(1, { economy: true });
    const { panel } = setupPage(city);
    assert.equal(taxInput(panel, 1, 1).value, String(MOCK_TAX_START));
    city.set_economy_rules(true);
    const { panel: on } = setupPage(city); // a page opened with the rule on
    assert.equal(norm(taxIncome(on, 1, 1)), norm(`${formatMoney(MOCK_TAX_START * TAX_INCOME_PER_POINT)} par an`));
  });

  test("a valid change calls set_tax_rate, the income follows, and the status says so", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    taxInput(panel, 2, 3).value = "12";
    taxInput(panel, 2, 3).onchange();
    assert.equal(city.tax_rates()[1 * 3 + 2], 12);
    assert.equal(taxInput(panel, 2, 3).value, "12");
    assert.equal(norm(taxIncome(panel, 2, 3)), norm(`${formatMoney(12 * TAX_INCOME_PER_POINT)} par an`));
    assert.equal(status(panel), "Taux enregistré.");
    assert.equal(api.city().tax_rates()[1 * 3 + 2], 12);
  });

  test("a refused change (above 20, a decimal, empty) keeps the rate and says so; the engine is not asked", () => {
    const city = new MockCity(1, { economy: true });
    const { panel } = setupPage(city);
    city.set_economy_rules(true);
    for (const bad of ["25", "2.5", ""]) {
      taxInput(panel, 1, 2).value = bad;
      taxInput(panel, 1, 2).onchange();
      assert.equal(taxInput(panel, 1, 2).value, String(MOCK_TAX_START), `back to the rate for "${bad}"`);
      assert.match(status(panel), /^Taux refusé/);
    }
    assert.equal(city.tax_rates()[1], MOCK_TAX_START);
  });

  test("an engine refusal (the rule switched off meanwhile) reverts the input too", () => {
    const city = new MockCity(1, { economy: true });
    const { panel } = setupPage(city);
    taxInput(panel, 1, 1).value = "9";
    taxInput(panel, 1, 1).onchange(); // the rule is off: refused by the engine
    assert.equal(taxInput(panel, 1, 1).value, String(MOCK_TAX_START));
    assert.match(status(panel), /^Taux refusé/);
  });

  test("the inputs are disabled while the rule is off", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    assert.equal(taxInput(panel, 3, 3).disabled, true);
    city.set_economy_rules(true);
    ui.update(api);
    assert.equal(taxInput(panel, 3, 3).disabled, false);
  });
});

describe("the bonds", () => {
  test("no bond: the sentence, and the issue button labelled with the offer, enabled when on", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    assert.deepEqual(listTexts(panel, "economy-bond-list"), [M.NO_BONDS_TEXT]);
    assert.equal(issueButton(panel).disabled, true, "off: disabled");
    city.set_economy_rules(true);
    ui.update(api);
    assert.equal(issueButton(panel).disabled, false);
    assert.equal(norm(issueButton(panel).textContent), norm(`Émettre une obligation (${formatMoney(10000)} à 3,0 %)`));
  });

  test("issuing: the engine issues, the funds rise, the list shows the bond with its rate and a Rembourser button", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    ui.update(api);
    const funds = city.funds();
    issueButton(panel).onclick();
    assert.equal(city.funds(), funds + 10000);
    assert.equal(status(panel), M.issueMessage(1));
    const lines = listTexts(panel, "economy-bond-list").map(norm);
    assert.equal(lines.length, 1);
    assert.equal(lines[0], norm(`Obligation de ${formatMoney(10000)} à 3,0 %, depuis 0 an Rembourser`));
    assert.equal(norm(issueButton(panel).textContent), norm(`Émettre une obligation (${formatMoney(10000)} à 4,0 %)`));
  });

  test("repaying: the Rembourser button of a bond calls repay_bond with its index and removes it", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    city.issue_bond();
    city.issue_bond();
    ui.update(api);
    const buttons = repayButtons(panel);
    assert.equal(buttons.length, 2);
    buttons[1].onclick(); // the second bond (3,0 % then 4,0 %): the 4,0 % one goes
    assert.deepEqual([...city.bonds()], [10000, 30, 0]);
    assert.equal(status(panel), M.repayMessage(1));
    assert.equal(repayButtons(panel).length, 1);
  });

  test("repaying without the funds is refused and says so; nothing moves", () => {
    const airport = MOCK_TOOLS.findIndex((t) => t.key === "airport");
    const city = new MockCity(1, { economy: true, funds: 0, rubble: 0 });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    city.issue_bond(); // +10 000 $ to 10 000 $
    assert.equal(city.tool_down(airport, 10, 10), 1, "an airport costs 10 000 $: the funds go back to 0");
    assert.equal(city.funds(), 0);
    ui.update(api);
    repayButtons(panel)[0].onclick();
    assert.match(status(panel), /fonds insuffisants/);
    assert.equal(city.bonds().length, 3, "the bond stays");
  });

  test("the cap: at MAX_BONDS the issue button is disabled and the status says why after a try", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    for (let i = 0; i < MAX_BONDS; i++) city.issue_bond();
    ui.update(api);
    assert.equal(issueButton(panel).disabled, true);
    issueButton(panel).onclick();
    assert.equal(status(panel), M.issueMessage(-1));
  });

  test("the bond list is rebuilt only when a bond or the rule changes", () => {
    const city = new MockCity(1, { economy: true });
    city.set_economy_rules(true);
    const { api, panel } = setupPage(city);
    const list = byId(panel, "economy-bond-list");
    const before = list.replaced;
    ui.update(api);
    assert.equal(list.replaced, before, "same bonds: no rebuild");
    city.issue_bond();
    ui.update(api);
    assert.equal(list.replaced, before + 1, "a bond was issued: rebuilt");
  });
});

describe("the goods", () => {
  test("five lines from the engine, and no shortage line while the flag is 0", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    assert.deepEqual(listTexts(panel, "economy-goods").map(norm), M.goodsLines(M.decodeGoods(Array(6).fill(0))).map(norm));
    city.set_economy_rules(true);
    ui.update(api);
    const lines = listTexts(panel, "economy-goods").map(norm);
    assert.equal(lines.length, 5);
    assert.equal(lines[0], "Marchandises produites : 120");
    assert.equal(lines[4], norm(`Recette nette du commerce : ${formatMoney(30)}`));
  });

  test("the shortage line appears with the flag, and goes away again", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    city.set_mock_shortage(true);
    ui.update(api);
    assert.equal(listTexts(panel, "economy-goods").at(-1), "Pénurie de marchandises");
    city.set_mock_shortage(false);
    ui.update(api);
    assert.equal(listTexts(panel, "economy-goods").length, 5);
  });

  test("the goods list is rebuilt only when its lines change", () => {
    const city = new MockCity(1, { economy: true });
    city.set_economy_rules(true);
    const { api, panel } = setupPage(city);
    const goods = byId(panel, "economy-goods");
    const before = goods.replaced;
    ui.update(api);
    assert.equal(goods.replaced, before);
  });
});

describe("hidden without the engine API or before it is ready", () => {
  test("hidden when the engine lacks an economy method", () => {
    const { panel } = setupPage(new MockCity(1));
    assert.equal(panel.hidden, true);
    const half = new MockCity(1, { economy: true });
    half.goods_stats = undefined; // defined on the prototype: hide it on the instance
    assert.equal(setupPage(half).panel.hidden, true);
  });

  test("nothing is shown before the engine is ready, and nothing is built", () => {
    const { panel } = setupPage(new MockCity(1, { economy: true }), { ready: false });
    assert.equal(panel.hidden, true);
    assert.equal(panel.children.length, 0);
    assert.equal(byIdOrNull(panel, "economy-taxes"), null);
  });
});

describe("the value typed in a tax input while the game runs", () => {
  test("a focused input keeps the typed value through the frames; the engine rate comes back once it is not focused", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    const input = taxInput(panel, 1, 1);
    globalThis.document.activeElement = input;
    input.value = "1";
    ui.update(api); // a frame while the player types
    assert.equal(input.value, "1", "the frame does not reset the typed digit");
    input.value = "12";
    ui.update(api);
    assert.equal(input.value, "12");
    assert.equal(city.tax_rates()[0], MOCK_TAX_START, "nothing is sent before the change");
    globalThis.document.activeElement = null;
    ui.update(api);
    assert.equal(input.value, String(MOCK_TAX_START), "not focused: the engine rate is written again");
  });

  test("the other inputs are written even while one is focused", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    globalThis.document.activeElement = taxInput(panel, 1, 1);
    taxInput(panel, 2, 2).value = "3"; // a stale value elsewhere
    ui.update(api);
    assert.equal(taxInput(panel, 2, 2).value, String(MOCK_TAX_START));
  });

  test("a change made while the input has the focus (Enter) is settled: a refused value goes back to the engine rate", () => {
    const city = new MockCity(1, { economy: true });
    const { api, panel } = setupPage(city);
    city.set_economy_rules(true);
    const input = taxInput(panel, 2, 2);
    globalThis.document.activeElement = input;
    input.value = "25";
    input.onchange();
    assert.equal(input.value, String(MOCK_TAX_START), "the refused text is replaced although the input is focused");
    assert.match(status(panel), /^Taux refusé/);
    input.value = "15";
    input.onchange();
    assert.equal(city.tax_rates()[1 * 3 + 1], 15);
    assert.equal(input.value, "15");
    assert.equal(api.city().tax_rates()[4], 15);
  });
});
