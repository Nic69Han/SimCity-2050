// The «Densités de zonage» panel (web/zoning-ui.js) against the mock engine, with a fake DOM.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../zoning-ui.js";
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
  globalThis.document = {
    createElement: (t) => new Node(t),
    // not used by the panel: only the Event constructor below
  };
  globalThis.Event = class { constructor(type) { this.type = type; } };
  const panel = new Node("section");
  const reliefBox = new Node("input");
  let redraws = 0;
  const elements = { "zoning-panel": panel, relief: relief ? reliefBox : null };
  const api = { city: () => city, $: (id) => elements[id] ?? null, redraw: () => { redraws++; }, isReady: () => true };
  ui.setup(api);
  return { api, panel, reliefBox, redraws: () => redraws };
}
const byId = (panel, id) => panel.find((n) => n.id === id)[0];

describe("setup and feature detection", () => {
  test("hidden without the API", () => {
    const { api, panel } = page({});
    ui.update(api);
    assert.equal(panel.hidden, true);
  });

  test("hidden until the engine is ready", () => {
    const city = new MockCity(1, { densities: true });
    const { api, panel } = page(city);
    api.isReady = () => false;
    ui.update(api);
    assert.equal(panel.hidden, true);
  });

  test("the panel is hidden at setup, and the update that follows shows it", () => {
    const city = new MockCity(1, { densities: true });
    const { api, panel } = page(city);
    assert.equal(panel.hidden, true);
    ui.update(api);
    assert.equal(panel.hidden, false);
  });
});

describe("the panel", () => {
  test("title, switch and both texts", () => {
    const city = new MockCity(1, { densities: true });
    const { api, panel } = page(city);
    ui.update(api);
    assert.equal(byId(panel, "zoning-heading").textContent, "Densités de zonage");
    assert.equal(panel.attributes["aria-labelledby"], "zoning-heading");
    assert.equal(byId(panel, "zoning-rules").attributes.type, "checkbox");
    assert.equal(byId(panel, "zoning-rules").tagName, "input");
    assert.equal(byId(panel, "zoning-state").textContent,
      "Zones légères : 0 · moyennes : 0 · denses : 0 · fermes : 0 (0 emplois agricoles)");
    assert.match(byId(panel, "zoning-note").textContent, /^Désactivé/);
  });

  test("the switch drives the engine, relays the change on the relief checkbox and the text follows", () => {
    const city = new MockCity(1, { densities: true, rubble: 0 });
    const { api, panel, reliefBox, redraws } = page(city);
    ui.update(api);
    const box = byId(panel, "zoning-rules");
    assert.equal(box.checked, false);
    box.checked = true;
    box.onchange();
    assert.equal(city.density_rules(), true);
    assert.deepEqual(reliefBox.events, ["change"], "the palette refreshes through the relief change");
    assert.equal(redraws(), 0);
    ui.update(api);
    assert.match(byId(panel, "zoning-note").textContent, /outil Zonage/);
  });

  test("without the relief checkbox the switch redraws the page", () => {
    const city = new MockCity(1, { densities: true });
    const { api, panel, redraws } = page(city, { relief: false });
    ui.update(api);
    const box = byId(panel, "zoning-rules");
    box.checked = true;
    box.onchange();
    assert.equal(redraws(), 1);
  });

  test("the statistics follow the placed zones, and the switch follows the engine after a load", () => {
    const city = new MockCity(1, { densities: true, rubble: 0 });
    const { api, panel } = page(city);
    city.set_density_rules(true);
    city.place_zone(1, 1, 20, 20);
    city.place_zone(3, 2, 25, 20);
    ui.update(api);
    assert.equal(byId(panel, "zoning-rules").checked, true);
    assert.equal(byId(panel, "zoning-state").textContent,
      "Zones légères : 1 · moyennes : 1 · denses : 0 · fermes : 0 (0 emplois agricoles)");
    city.load_cty();
    ui.update(api);
    assert.equal(byId(panel, "zoning-rules").checked, false);
    assert.match(byId(panel, "zoning-state").textContent, /^Zones légères : 0 · /);
  });

  test("off: the zones count as dense in the statistics", () => {
    const city = new MockCity(1, { densities: true, rubble: 0 });
    const { api, panel } = page(city);
    city.set_density_rules(true);
    city.place_zone(1, 1, 20, 20);
    city.set_density_rules(false);
    ui.update(api);
    assert.match(byId(panel, "zoning-state").textContent, /^Zones légères : 0 · moyennes : 0 · denses : 1 · /);
    assert.match(byId(panel, "zoning-note").textContent, /^Désactivé : toutes les zones sont denses/);
  });

  test("the texts are not rewritten when they have not changed", () => {
    const city = new MockCity(1, { densities: true });
    const { api, panel } = page(city);
    ui.update(api);
    const state = byId(panel, "zoning-state");
    let writes = 0;
    let current = state.textContent;
    Object.defineProperty(state, "textContent", {
      get() { return current; },
      set(v) { writes++; current = v; },
    });
    ui.update(api);
    ui.update(api);
    assert.equal(writes, 0, "the same text is not set again");
  });
});
