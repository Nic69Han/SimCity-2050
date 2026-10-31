// The catastrophes and highways panel (web/disasters2-ui.js) with a fake document and the mock engine
// (disasters2: true, highways: true): the sections follow the engine's methods, the switches write the engine
// flags and relay the change to the relief box, the buttons trigger the disasters and tell the answer, the lines
// follow the engine, and the view checkbox drives the 2D layer's state.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../disasters2-ui.js";
import { TRIGGERS, RULE_OFF_TEXT, IMPOSSIBLE_TEXT, NO_DROUGHT_TEXT, NO_LAST_TEXT } from "../disasters2-model.js";
import { highwaysViewState, setHighwaysView } from "../map-layer-highways-model.js";
import { MockCity, MOCK_TOOLS } from "./mock-engine.mjs";

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

/** A page with the disasters panel, the relief checkbox and the given engine. */
function setupPage(city, { ready = true, relief = true } = {}) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  const panel = new Node("section");
  panel.hidden = true;
  const reliefBox = new Node("input");
  const api = {
    city: () => city,
    $: (id) => (id === "disasters2-panel" ? panel : id === "relief" && relief ? reliefBox : null),
    redraw: () => { api.redraws += 1; ui.update(api); },
    isReady: () => ready,
    reliefBox,
    redraws: 0,
  };
  ui.setup(api);
  ui.update(api);
  return { api, panel };
}

const byId = (panel, id) => panel.find((n) => n.attributes.id === id)[0];
const linesOf = (panel, id) => byId(panel, id).children.map((c) => c.textContent);
const dRules = (panel) => byId(panel, "disasters2-rules");
const hRules = (panel) => byId(panel, "highways-rules");
const hView = (panel) => byId(panel, "highways-view");
const status = (panel) => byId(panel, "disasters2-status").textContent;
const road = MOCK_TOOLS.findIndex((t) => t.key === "road");

function fullCity(options = {}) {
  return new MockCity(1, { disasters2: true, highways: true, rubble: 0, ...options });
}

describe("the panel and its sections", () => {
  test("h2 «Catastrophes et autoroutes», both switches, the view box, the status and the lines", () => {
    const { panel } = setupPage(fullCity());
    assert.equal(panel.hidden, false);
    assert.equal(byId(panel, "disasters2-heading").textContent, "Catastrophes et autoroutes");
    assert.equal(panel.attributes["aria-labelledby"], "disasters2-heading");
    const labels = panel.find((n) => n.tagName === "span").map((n) => n.textContent);
    assert.ok(labels.includes("Catastrophes étendues"));
    assert.ok(labels.includes("Autoroutes"));
    assert.ok(labels.includes("Voir les autoroutes sur la carte"));
    assert.ok(byId(panel, "disasters2-stats"));
    assert.ok(byId(panel, "highways-stats"));
    assert.equal(byId(panel, "disasters2-status").attributes.role, "status");
  });

  test("the panel is hidden without the engine's methods, and each section follows its own methods", () => {
    const { panel } = setupPage(new MockCity(1));
    assert.equal(panel.hidden, true);
    const onlyDisasters = setupPage(new MockCity(1, { disasters2: true })).panel;
    assert.equal(onlyDisasters.hidden, false);
    assert.equal(byId(onlyDisasters, "disasters2-section").hidden, false);
    assert.equal(byId(onlyDisasters, "highways-section").hidden, true);
    const onlyHighways = setupPage(new MockCity(1, { highways: true })).panel;
    assert.equal(byId(onlyHighways, "disasters2-section").hidden, true);
    assert.equal(byId(onlyHighways, "highways-section").hidden, false);
  });

  test("nothing happens before the engine is ready, and setup hides the panel", () => {
    const { panel } = setupPage(fullCity(), { ready: false });
    assert.equal(panel.hidden, true);
    assert.equal(panel.children.length, 0);
  });
});

describe("the disasters section", () => {
  test("the four triggers are shown only while the rule is on, with their French labels", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    const triggers = byId(panel, "disasters2-triggers");
    assert.equal(triggers.hidden, true);
    city.set_disaster2_rules(true);
    ui.update(api);
    assert.equal(triggers.hidden, false);
    assert.deepEqual(
      TRIGGERS.map((t) => byId(panel, `trigger-${t.kind}`).textContent),
      ["Déclencher une émeute", "Déclencher un OVNI", "Déclencher une météorite", "Déclencher une sécheresse"],
    );
  });

  test("the switch writes the engine flag, relays the change to the relief box and shows the note", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    dRules(panel).checked = true;
    dRules(panel).onchange();
    assert.equal(city.disaster2_rules(), true);
    assert.deepEqual(api.reliefBox.events, ["change"]);
    ui.update(api);
    assert.equal(byId(panel, "disasters2-triggers").hidden, false);
    assert.match(panel.find((n) => n.attributes.class === "disasters2-note")[0].textContent, /à la demande/);
  });

  test("without the relief box the switch redraws the map instead", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city, { relief: false });
    dRules(panel).checked = true;
    dRules(panel).onchange();
    assert.equal(city.disaster2_rules(), true);
    assert.equal(api.redraws, 1);
  });

  test("the drought and the last disaster lines follow the engine", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    assert.deepEqual(linesOf(panel, "disasters2-stats"), [NO_DROUGHT_TEXT, NO_LAST_TEXT]);
    city.set_disaster2_rules(true);
    ui.update(api);
    city.trigger_disaster(3);
    ui.update(api);
    assert.deepEqual(linesOf(panel, "disasters2-stats"), [
      NO_DROUGHT_TEXT, "Dernière catastrophe : Météorite en (20, 15)",
    ]);
  });

  test("a trigger calls the engine, tells the answer on the status line and redraws the map", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    city.set_disaster2_rules(true);
    ui.update(api);
    byId(panel, "trigger-3").onclick();
    assert.equal(status(panel), "Météorite déclenchée.");
    assert.equal(api.redraws, 1);
    assert.equal(linesOf(panel, "disasters2-stats")[1], "Dernière catastrophe : Météorite en (20, 15)");
  });

  test("a drought triggered: the months left, and no place", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    city.set_disaster2_rules(true);
    ui.update(api);
    byId(panel, "trigger-4").onclick();
    assert.equal(status(panel), "Sécheresse déclenchée.");
    assert.deepEqual(linesOf(panel, "disasters2-stats"), [
      "Sécheresse : 12 mois restants", "Dernière catastrophe : Sécheresse",
    ]);
    city.mock_set_drought(7);
    ui.update(api);
    assert.equal(linesOf(panel, "disasters2-stats")[0], "Sécheresse : 7 mois restants");
  });

  test("a trigger with the rule off, and an impossible one, say so on the status line", () => {
    const city = fullCity();
    const { panel } = setupPage(city);
    byId(panel, "trigger-1").onclick();
    assert.equal(status(panel), RULE_OFF_TEXT);
    city.set_disaster2_rules(true);
    city.trigger_disaster = () => -1; // the mock never refuses; a stub stands for the engine's «impossible»
    byId(panel, "trigger-1").onclick();
    assert.equal(status(panel), IMPOSSIBLE_TEXT);
  });

  test("the status line keeps its text until the next trigger", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    city.set_disaster2_rules(true);
    ui.update(api);
    byId(panel, "trigger-2").onclick();
    ui.update(api);
    assert.equal(status(panel), "OVNI déclenché.");
  });

  test("the lines are rebuilt only when they change", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    const list = byId(panel, "disasters2-stats");
    const before = list.replaced;
    ui.update(api);
    ui.update(api);
    assert.equal(list.replaced, before, "same statistics: no rebuild");
    city.set_disaster2_rules(true);
    city.trigger_disaster(1);
    ui.update(api);
    assert.equal(list.replaced, before + 1);
  });
});

describe("the highways section", () => {
  test("the switch, the tiles and the upkeep lines, and the view box", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    assert.deepEqual(linesOf(panel, "highways-stats").map((s) => s.replace(/\s/g, " ")), [
      "Autoroutes : 0 tuiles", "Entretien : 0 $ par an",
    ]);
    hRules(panel).checked = true;
    hRules(panel).onchange();
    assert.equal(city.highway_rules(), true);
    assert.deepEqual(api.reliefBox.events, ["change"]);
    ui.update(api);
    assert.equal(panel.find((n) => n.attributes.for === "highways-view")[0].hidden, false);
  });

  test("the tiles and the upkeep follow the placed highways", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    city.set_highway_rules(true);
    for (let x = 20; x <= 23; x++) city.tool_down(road, x, 15);
    city.place_highway(20, 15);
    city.place_highway(21, 15);
    ui.update(api);
    assert.equal(linesOf(panel, "highways-stats")[0], "Autoroutes : 2 tuiles");
    assert.match(linesOf(panel, "highways-stats")[1], /^Entretien : 2\s\$ par an$/);
  });

  test("«Voir les autoroutes sur la carte» sets the view and redraws; the view ends with the rule", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    city.set_highway_rules(true);
    ui.update(api);
    hView(panel).checked = true;
    hView(panel).onchange();
    assert.equal(highwaysViewState().show, true);
    assert.equal(api.redraws, 1);
    city.set_highway_rules(false);
    ui.update(api);
    assert.equal(highwaysViewState().show, false, "the rule off ends the view");
    assert.equal(hView(panel).checked, false);
    assert.equal(panel.find((n) => n.attributes.for === "highways-view")[0].hidden, true);
    setHighwaysView(false);
  });

  test("the view box follows the module's state when another part of the page changes it", () => {
    const city = fullCity();
    const { api, panel } = setupPage(city);
    city.set_highway_rules(true);
    setHighwaysView(true);
    ui.update(api);
    assert.equal(hView(panel).checked, true);
    setHighwaysView(false);
    ui.update(api);
    assert.equal(hView(panel).checked, false);
  });
});
