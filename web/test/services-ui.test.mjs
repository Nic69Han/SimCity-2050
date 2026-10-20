// Tests of the public services panel (web/services-ui.js) with a fake document, the mock engine (services:
// true) and the real map-layer-coverage-model.js: the coverage choice must reach the map layer's kind without
// throwing (the layer throws a RangeError on any value but null or 0..2).
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../services-ui.js";
import { coverageViewState, setCoverageView } from "../map-layer-coverage-model.js";
import { noteText } from "../services-model.js";
import { MockCity, SERVICES_FIXED } from "./mock-engine.mjs";

// ---- fake document ------------------------------------------------------------------------

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.checked = false;
    this.value = "";
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
    for (const n of nodes) {
      this.children.push(n);
      if (n.tagName === "option" && this.tagName === "select" && this.children.filter((c) => c.tagName === "option").length === 1) {
        this.value = n.attributes.value;
      }
    }
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

/** A page with the services panel, the relief checkbox (its change relays the flags) and the given engine. */
function setupPage(city, { ready = true, relief = true } = {}) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  const panel = new Node("section");
  panel.hidden = true;
  const reliefBox = new Node("input");
  const api = {
    city: () => city,
    $: (id) => (id === "services-panel" ? panel : id === "relief" && relief ? reliefBox : null),
    redraw: () => { api.redraws = (api.redraws ?? 0) + 1; ui.update(api); },
    isReady: () => ready,
    reliefBox,
  };
  ui.setup(api);
  ui.update(api);
  return { api, panel };
}

const byId = (panel, id) => panel.find((n) => n.attributes.id === id)[0];
const select = (panel) => byId(panel, "services-view");
const rules = (panel) => byId(panel, "services-rules");
const note = (panel) => byId(panel, "services-note");
const items = (panel) => panel.find((n) => n.tagName === "li");
const viewLabel = (panel) => panel.find((n) => n.attributes.class === "services-view")[0];
const pick = (panel, key, api) => {
  select(panel).value = key;
  select(panel).onchange();
  return api;
};

beforeEach(() => setCoverageView(null));

describe("the coverage choice", () => {
  test("each option drives the coverage kind to null, 0, 1 or 2 without throwing", () => {
    const city = new MockCity(1, { services: true });
    city.set_service_rules(true);
    const { api, panel } = setupPage(city);
    const expected = [["", null], ["education", 0], ["health", 1], ["security", 2]];
    for (const [key, kind] of expected) {
      assert.doesNotThrow(() => pick(panel, key, api));
      assert.equal(coverageViewState().kind, kind, `option "${key}"`);
    }
  });

  test("the option labels are «Aucune», «Éducation», «Santé», «Sécurité», in that order", () => {
    const { panel } = setupPage(new MockCity(1, { services: true }));
    const labels = select(panel).children.map((o) => o.textContent);
    assert.deepEqual(labels, ["Aucune", "Éducation", "Santé", "Sécurité"]);
  });

  test("a choice redraws the map once, and choosing the same kind again still does not throw", () => {
    const city = new MockCity(1, { services: true });
    city.set_service_rules(true);
    const { api, panel } = setupPage(city);
    assert.equal(api.redraws ?? 0, 0);
    pick(panel, "health", api);
    assert.equal(api.redraws, 1);
    assert.doesNotThrow(() => pick(panel, "health", api));
    assert.equal(coverageViewState().kind, 1);
  });

  test("the rule off resets the choice to «Aucune» and drops the kind", () => {
    const city = new MockCity(1, { services: true });
    city.set_service_rules(true);
    const { api, panel } = setupPage(city);
    pick(panel, "security", api);
    assert.equal(coverageViewState().kind, 2);
    city.set_service_rules(false);
    ui.update(api);
    assert.equal(select(panel).value, "");
    assert.equal(coverageViewState().kind, null);
  });
});

describe("the rule switch and the note", () => {
  test("the switch writes the engine flag, relays the change to the relief box and shows the note", () => {
    const city = new MockCity(1, { services: true });
    const { api, panel } = setupPage(city);
    assert.equal(panel.hidden, false);
    assert.equal(viewLabel(panel).hidden, true, "the choice is hidden while the rule is off");
    rules(panel).checked = true;
    rules(panel).onchange();
    ui.update(api); // the redraw that follows the relief relay
    assert.equal(city.service_rules(), true);
    assert.deepEqual(api.reliefBox.events, ["change"]);
    assert.equal(viewLabel(panel).hidden, false);
    assert.equal(note(panel).textContent, noteText(true));
  });

  test("without the relief box the switch redraws the map instead", () => {
    const city = new MockCity(1, { services: true });
    const { api, panel } = setupPage(city, { relief: false });
    rules(panel).checked = true;
    rules(panel).onchange();
    assert.equal(city.service_rules(), true);
    assert.equal(api.redraws, 1);
  });

  test("the note says the rule is off at start", () => {
    const { panel } = setupPage(new MockCity(1, { services: true }));
    assert.equal(note(panel).textContent, noteText(false));
    assert.match(note(panel).textContent, /^Désactivé/);
  });
});

describe("the statistics", () => {
  test("seven lines from the engine's numbers, rebuilt only when they change", () => {
    const city = new MockCity(1, { services: true });
    const { api, panel } = setupPage(city);
    assert.equal(items(panel).length, 7, "zeros while the rule is off");
    city.set_service_rules(true);
    ui.update(api);
    assert.equal(items(panel)[2].textContent, "Écoles : 340 / 400 élèves");
    assert.equal(items(panel)[6].textContent.replace(/[  ]/g, " "), "Couverture santé : 45 %");
    const stats = panel.find((n) => n.attributes.id === "services-stats")[0];
    const before = stats.replaced;
    ui.update(api);
    assert.equal(stats.replaced, before, "same numbers, no rebuild");
    assert.equal(SERVICES_FIXED[1], 72);
  });
});

describe("hidden without the engine API or before it is ready", () => {
  test("hidden when the engine lacks a services method", () => {
    const city = new MockCity(1);
    const { panel } = setupPage(city);
    assert.equal(panel.hidden, true);
    const half = new MockCity(1, { services: true });
    half.service_stats = undefined; // the mock defines it on its prototype: hide it on the instance
    const page = setupPage(half);
    assert.equal(page.panel.hidden, true);
  });

  test("nothing is shown before the engine is ready, and nothing is built", () => {
    const { panel } = setupPage(new MockCity(1, { services: true }), { ready: false });
    assert.equal(panel.hidden, true);
    assert.equal(panel.children.length, 0);
  });
});
