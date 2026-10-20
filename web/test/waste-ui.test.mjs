// The «Déchets» panel (web/waste-ui.js) against the mock engine, with a fake DOM.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../waste-ui.js";
import { wasteViewState, setWasteView } from "../map-layer-waste-model.js";
import { statsLines, decodeStats, noteText } from "../waste-model.js";
import { MockCity } from "./mock-engine.mjs";

class Node {
  constructor(tag) { this.tagName = tag; this.attributes = {}; this.children = []; this.hidden = false; this.textContent = ""; this.checked = false; this.events = []; }
  setAttribute(k, v) { this.attributes[k] = v; if (k === "id") this.id = v; }
  append(...n) { this.children.push(...n); }
  replaceChildren(...n) { this.children = n; }
  dispatchEvent(ev) { this.events.push(ev.type); }
  find(pred) { return [this, ...this.children.flatMap((c) => (c instanceof Node ? c.find(pred) : []))].filter(pred); }
}

// A page with the panel and the relief checkbox (the switch relays through its change event).
function page(city, { relief = true } = {}) {
  globalThis.document = { createElement: (t) => new Node(t) };
  globalThis.Event = class { constructor(type) { this.type = type; } };
  setWasteView(false);
  const panel = new Node("section");
  const reliefBox = new Node("input");
  let redraws = 0;
  const elements = { "waste-panel": panel, relief: relief ? reliefBox : null };
  const api = { city: () => city, $: (id) => elements[id] ?? null, redraw: () => { redraws++; }, isReady: () => true };
  ui.setup(api);
  return { api, panel, reliefBox, redraws: () => redraws };
}
const byId = (panel, id) => panel.find((n) => n.id === id)[0];
const viewLabelOf = (panel) => panel.find((n) => n.tagName === "label" && n.attributes.for === "waste-view")[0];
const items = (panel) => panel.find((n) => n.tagName === "li");

describe("setup and feature detection", () => {
  test("hidden without the API", () => {
    const { api, panel } = page({});
    ui.update(api);
    assert.equal(panel.hidden, true);
  });

  test("hidden until the engine is ready", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel } = page(city);
    api.isReady = () => false;
    ui.update(api);
    assert.equal(panel.hidden, true);
  });

  test("the panel is hidden at setup, and the update that follows shows it", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel } = page(city);
    assert.equal(panel.hidden, true);
    ui.update(api);
    assert.equal(panel.hidden, false);
  });
});

describe("the panel", () => {
  test("title, switch, view label and the note", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel } = page(city);
    ui.update(api);
    assert.equal(byId(panel, "waste-heading").textContent, "Déchets");
    assert.equal(panel.attributes["aria-labelledby"], "waste-heading");
    assert.equal(byId(panel, "waste-rules").attributes.type, "checkbox");
    assert.equal(byId(panel, "waste-view").attributes.type, "checkbox");
    assert.equal(byId(panel, "waste-note").textContent, noteText(false));
  });

  test("the switch drives the engine, relays the change on the relief checkbox and the view label shows", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel, reliefBox, redraws } = page(city);
    ui.update(api);
    const box = byId(panel, "waste-rules");
    assert.equal(box.checked, false);
    assert.equal(viewLabelOf(panel).hidden, true);
    box.checked = true;
    box.onchange();
    assert.equal(city.waste_rules(), true);
    assert.deepEqual(reliefBox.events, ["change"], "the palette refreshes through the relief change");
    assert.equal(redraws(), 0);
    ui.update(api);
    assert.equal(viewLabelOf(panel).hidden, false);
    assert.equal(byId(panel, "waste-note").textContent, noteText(true));
  });

  test("without the relief checkbox the switch redraws the page", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel, redraws } = page(city, { relief: false });
    ui.update(api);
    const box = byId(panel, "waste-rules");
    box.checked = true;
    box.onchange();
    assert.equal(city.waste_rules(), true);
    assert.equal(redraws(), 1);
  });

  test("the seven statistics and the note are rendered from the engine numbers", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel } = page(city);
    city.set_waste_rules(true);
    city.set_mock_waste([10, 5, 1, 0, 600, 0, 0]);
    ui.update(api);
    const texts = items(panel).map((n) => n.textContent);
    assert.equal(texts.length, 7);
    assert.deepEqual(texts, statsLines(decodeStats([10, 5, 1, 0, 600, 0, 0])));
    assert.equal(byId(panel, "waste-note").textContent, noteText(true));
  });

  test("the statistics are not rewritten when they have not changed", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel } = page(city);
    city.set_waste_rules(true);
    city.set_mock_waste([3, 2, 1, 0, 4, 9, 0]);
    ui.update(api);
    const stats = byId(panel, "waste-stats");
    let writes = 0;
    const replace = stats.replaceChildren.bind(stats);
    stats.replaceChildren = (...n) => { writes++; replace(...n); };
    ui.update(api);
    ui.update(api);
    assert.equal(writes, 0, "the same lines are not set again");
  });

  test("the switch follows the engine after a load", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel } = page(city);
    city.set_waste_rules(true);
    ui.update(api);
    assert.equal(byId(panel, "waste-rules").checked, true);
    city.load_cty();
    ui.update(api);
    assert.equal(byId(panel, "waste-rules").checked, false);
  });
});

describe("the «Voir les ordures sur la carte» view", () => {
  test("it calls setWasteView and redraws", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel, redraws } = page(city);
    city.set_waste_rules(true);
    ui.update(api);
    const view = byId(panel, "waste-view");
    view.checked = true;
    view.onchange();
    assert.equal(wasteViewState().show, true);
    assert.equal(redraws(), 1);
  });

  test("the view is dropped with the rule: unchecked, state false, label hidden", () => {
    const city = new MockCity(1, { structures: true, waste: true });
    const { api, panel } = page(city);
    city.set_waste_rules(true);
    ui.update(api);
    const view = byId(panel, "waste-view");
    view.checked = true;
    view.onchange();
    city.set_waste_rules(false);
    ui.update(api);
    assert.equal(view.checked, false);
    assert.equal(wasteViewState().show, false, "the view goes with the rule");
    assert.equal(viewLabelOf(panel).hidden, true, "the view label is hidden with the rule");
    assert.equal(byId(panel, "waste-note").textContent, noteText(false));
  });
});
