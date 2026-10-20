// Tests of the energy panel (web/energy-ui.js) with a fake document, the mock engine (energy: true): the switch writes
// the engine flag and relays the change to the relief box, the statistics and the plants follow the engine, and the lists
// are rebuilt only when they change.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../energy-ui.js";
import { noteText, NO_PLANTS_TEXT } from "../energy-model.js";
import { MockCity } from "./mock-engine.mjs";
import { ENERGY_FIXED } from "./mock-energy.mjs";

// ---- fake document ------------------------------------------------------------------------

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.checked = false;
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
    this.children.push(...nodes);
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

globalThis.Event ??= class { constructor(type) { this.type = type; } };

/** A page with the energy panel, the relief checkbox (its change relays the flags) and the given engine. */
function setupPage(city, { ready = true, relief = true } = {}) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  const panel = new Node("section");
  panel.hidden = true;
  const reliefBox = new Node("input");
  const api = {
    city: () => city,
    $: (id) => (id === "energy-panel" ? panel : id === "relief" && relief ? reliefBox : null),
    redraw: () => { api.redraws = (api.redraws ?? 0) + 1; ui.update(api); },
    isReady: () => ready,
    reliefBox,
  };
  ui.setup(api);
  ui.update(api);
  return { api, panel };
}

const byId = (panel, id) => panel.find((n) => n.attributes.id === id)[0];
const rules = (panel) => byId(panel, "energy-rules");
const note = (panel) => byId(panel, "energy-note");
const listItems = (panel, id) => byId(panel, id).children.map((c) => c.textContent);
const norm = (s) => s.replace(/[  ]/g, " ");

describe("the panel and the switch", () => {
  test("h2 «Énergie», the switch «Énergie étendue», the two lists and the note", () => {
    const { panel } = setupPage(new MockCity(1, { energy: true }));
    assert.equal(panel.hidden, false);
    assert.equal(byId(panel, "energy-heading").textContent, "Énergie");
    const label = panel.find((n) => n.attributes.class === "energy-switch")[0];
    assert.equal(label.textContent, "Énergie étendue");
    assert.ok(byId(panel, "energy-stats"));
    assert.ok(byId(panel, "energy-plants"));
    assert.equal(note(panel).textContent, noteText(false));
  });

  test("the switch writes the engine flag, relays the change to the relief box and updates the note", () => {
    const city = new MockCity(1, { energy: true });
    const { api, panel } = setupPage(city);
    rules(panel).checked = true;
    rules(panel).onchange();
    ui.update(api);
    assert.equal(city.energy_rules(), true);
    assert.deepEqual(api.reliefBox.events, ["change"]);
    assert.equal(note(panel).textContent, noteText(true));
  });

  test("without the relief box the switch redraws the map instead", () => {
    const city = new MockCity(1, { energy: true });
    const { api, panel } = setupPage(city, { relief: false });
    rules(panel).checked = true;
    rules(panel).onchange();
    assert.equal(city.energy_rules(), true);
    assert.equal(api.redraws, 1);
  });

  test("the box follows the engine after a change made elsewhere (a load, a new city)", () => {
    const city = new MockCity(1, { energy: true });
    const { api, panel } = setupPage(city);
    city.set_energy_rules(true);
    ui.update(api);
    assert.equal(rules(panel).checked, true);
    city.new_random_city(3);
    ui.update(api);
    assert.equal(rules(panel).checked, false);
  });
});

describe("the statistics and the plants", () => {
  test("six statistics lines from the engine, zeros while the rule is off", () => {
    const city = new MockCity(1, { energy: true });
    const { api, panel } = setupPage(city);
    assert.equal(listItems(panel, "energy-stats").length, 6);
    assert.equal(norm(listItems(panel, "energy-stats")[0]), "Production : 0");
    city.set_energy_rules(true);
    ui.update(api);
    assert.deepEqual(listItems(panel, "energy-stats").map(norm), [
      "Production : 1 200", "Consommation : 900", "Achetée aux voisins : 50",
      "Centrales : 3", "Centrales en fin de vie : 1", "Pollution de l'air produite : 40",
    ]);
    assert.equal(ENERGY_FIXED[0], 1200);
  });

  test("the plants: one line each with name, age and power, or the sentence for none", () => {
    const city = new MockCity(1, { energy: true });
    const { api, panel } = setupPage(city);
    assert.deepEqual(listItems(panel, "energy-plants"), [NO_PLANTS_TEXT]);
    city.set_energy_rules(true);
    ui.update(api);
    const lines = listItems(panel, "energy-plants").map(norm);
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "Centrale au gaz : âge 3 ans, puissance 100 %");
    assert.equal(lines[1], "Éolienne : âge 16 ans, puissance 92 %");
  });

  test("the lists are rebuilt only when their lines change", () => {
    const city = new MockCity(1, { energy: true });
    city.set_energy_rules(true);
    const { api, panel } = setupPage(city);
    const stats = byId(panel, "energy-stats");
    const plants = byId(panel, "energy-plants");
    const [s0, p0] = [stats.replaced, plants.replaced];
    ui.update(api);
    assert.equal(stats.replaced, s0, "same numbers, no rebuild");
    assert.equal(plants.replaced, p0, "same plants, no rebuild");
  });
});

describe("hidden without the engine API or before it is ready", () => {
  test("hidden when the engine lacks an energy method", () => {
    const { panel } = setupPage(new MockCity(1));
    assert.equal(panel.hidden, true);
    const half = new MockCity(1, { energy: true });
    half.power_plants = undefined; // defined on the prototype: hide it on the instance
    assert.equal(setupPage(half).panel.hidden, true);
  });

  test("nothing is shown before the engine is ready, and nothing is built", () => {
    const { panel } = setupPage(new MockCity(1, { energy: true }), { ready: false });
    assert.equal(panel.hidden, true);
    assert.equal(panel.children.length, 0);
  });
});
