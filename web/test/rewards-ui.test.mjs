// Tests of the rewards panel (web/rewards-ui.js) with a fake document and the mock engine (rewards: true): the switch writes
// the engine flag and relays the change to the relief box, the lists follow the engine, the answer buttons show only while an
// offer is proposed and answer the engine, and the lists are rebuilt only when they change.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../rewards-ui.js";
import { noteText, RULE_LABEL } from "../rewards-model.js";
import { MockCity } from "./mock-engine.mjs";

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
    this.onclick = null;
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

/** A page with the rewards panel, the relief checkbox (its change relays the flags) and the given engine. */
function setupPage(city, { ready = true, relief = true } = {}) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  const panel = new Node("section");
  panel.hidden = true;
  const reliefBox = new Node("input");
  const api = {
    city: () => city,
    $: (id) => (id === "rewards-panel" ? panel : id === "relief" && relief ? reliefBox : null),
    redraw: () => { api.redraws = (api.redraws ?? 0) + 1; ui.update(api); },
    isReady: () => ready,
    reliefBox,
  };
  ui.setup(api);
  ui.update(api);
  return { api, panel };
}

const byId = (panel, id) => panel.find((n) => n.attributes.id === id)[0];
const byClass = (panel, cls) => panel.find((n) => n.attributes.class === cls);
const rules = (panel) => byId(panel, "rewards-rules");
const note = (panel) => byId(panel, "rewards-note");
const items = (panel, id) => byId(panel, id).children;
const texts = (panel, id) => items(panel, id).map((c) => c.textContent);
const norm = (s) => s.replace(/[  ]/g, " ");
// The offer's own text, without its buttons (the buttons are children of the item).
const ownText = (li) => li._text;

describe("the panel and the switch", () => {
  test("h2 «Récompenses et accords», the switch, the lists, the statistics and the note", () => {
    const { panel } = setupPage(new MockCity(1, { rewards: true }));
    assert.equal(panel.hidden, false);
    assert.equal(byId(panel, "rewards-heading").textContent, "Récompenses et accords");
    const label = byClass(panel, "rewards-switch")[0];
    assert.equal(label.textContent, RULE_LABEL);
    assert.ok(byId(panel, "rewards-list"));
    assert.ok(byId(panel, "offers-list"));
    assert.ok(byId(panel, "rewards-stats"));
    assert.equal(note(panel).textContent, noteText(false));
  });

  test("the switch writes the engine flag, relays the change to the relief box and updates the note", () => {
    const city = new MockCity(1, { rewards: true });
    const { api, panel } = setupPage(city);
    rules(panel).checked = true;
    rules(panel).onchange();
    ui.update(api);
    assert.equal(city.reward_rules(), true);
    assert.deepEqual(api.reliefBox.events, ["change"]);
    assert.equal(note(panel).textContent, noteText(true));
  });

  test("without the relief box the switch redraws the page instead", () => {
    const city = new MockCity(1, { rewards: true });
    const { api, panel } = setupPage(city, { relief: false });
    rules(panel).checked = true;
    rules(panel).onchange();
    assert.equal(city.reward_rules(), true);
    assert.equal(api.redraws, 1);
  });

  test("the box follows the engine after a change made elsewhere (a load, a new city)", () => {
    const city = new MockCity(1, { rewards: true });
    const { api, panel } = setupPage(city);
    city.set_reward_rules(true);
    ui.update(api);
    assert.equal(rules(panel).checked, true);
    city.new_random_city(3);
    ui.update(api);
    assert.equal(rules(panel).checked, false);
  });
});

describe("the rewards list", () => {
  test("five rewards, each with its name and its status; the rule off shows none", () => {
    const city = new MockCity(1, { rewards: true });
    const { api, panel } = setupPage(city);
    assert.equal(items(panel, "rewards-list").length, 0);
    city.set_reward_rules(true);
    ui.update(api);
    const lines = texts(panel, "rewards-list").map(norm);
    assert.equal(lines.length, 5);
    assert.equal(lines[0], "Résidence du maire (Verrouillée : 2 000 habitants)");
    assert.equal(lines[2], "Statue du maire (Verrouillée : 5 000 habitants, 70 % de satisfaction)");
  });

  test("an unlocked reward reads «à poser», a placed one «Posée»", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    const { api, panel } = setupPage(city);
    city.mock_unlock_reward(51);
    ui.update(api);
    assert.equal(texts(panel, "rewards-list")[1], "Hôtel de ville (Débloquée — à poser)");
    city.mock_place_reward(51);
    ui.update(api);
    assert.equal(texts(panel, "rewards-list")[1], "Hôtel de ville (Posée)");
  });
});

describe("the offers list and its answers", () => {
  test("a state-0 offer reads «Pas encore proposé» and has no buttons", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    const { panel } = setupPage(city);
    const first = items(panel, "offers-list")[0];
    assert.equal(norm(ownText(first)), "Casino : Pas encore proposé (8 000 habitants)");
    assert.equal(byClass(first, "offer-accept").length, 0);
  });

  test("a proposed offer shows its yearly income and the two buttons; Accepter answers the engine", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    city.mock_propose_offer(60);
    const { api, panel } = setupPage(city);
    const li = items(panel, "offers-list")[0];
    assert.equal(norm(ownText(li)), "Casino rapporte 3 000 $ par an");
    const accept = byClass(li, "offer-accept")[0];
    const refuse = byClass(li, "offer-refuse")[0];
    assert.equal(accept.textContent, "Accepter");
    assert.equal(refuse.textContent, "Refuser");
    accept.onclick();
    assert.equal(city.special_offers()[2], 2, "accepted in the engine");
    assert.equal(api.redraws, 1, "the page redraws after the answer");
    const after = items(panel, "offers-list")[0];
    assert.equal(ownText(after), "Casino : Accepté");
    assert.equal(byClass(after, "offer-accept").length, 0, "no buttons once answered");
  });

  test("Refuser answers the engine with refused", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    city.mock_propose_offer(62);
    const { panel } = setupPage(city);
    const li = items(panel, "offers-list")[2];
    byClass(li, "offer-refuse")[0].onclick();
    assert.equal(city.special_offers()[8 + 2], 3);
    assert.equal(ownText(items(panel, "offers-list")[2]), "Décharge toxique : Refusé");
  });
});

describe("the statistics and the rebuilds", () => {
  test("two statistics lines from the engine, zeros while the rule is off", () => {
    const city = new MockCity(1, { rewards: true });
    const { api, panel } = setupPage(city);
    assert.deepEqual(texts(panel, "rewards-stats").map(norm), ["Satisfaction : 0 %", "Recette des accords l'an dernier : 0 $"]);
    city.set_reward_rules(true);
    ui.update(api);
    assert.equal(norm(texts(panel, "rewards-stats")[0]), "Satisfaction : 72 %");
  });

  test("the lists are rebuilt only when their data change", () => {
    const city = new MockCity(1, { rewards: true });
    city.set_reward_rules(true);
    const { api, panel } = setupPage(city);
    const lists = ["rewards-list", "offers-list", "rewards-stats"].map((id) => byId(panel, id));
    const before = lists.map((l) => l.replaced);
    ui.update(api);
    assert.deepEqual(lists.map((l) => l.replaced), before, "same data, no rebuild");
    city.mock_unlock_reward(50);
    ui.update(api);
    assert.equal(byId(panel, "rewards-list").replaced, before[0] + 1, "the reward list changed");
    assert.equal(byId(panel, "offers-list").replaced, before[1], "the offers did not");
  });
});

describe("hidden without the engine API or before it is ready", () => {
  test("hidden when the engine lacks a rewards method", () => {
    const { panel } = setupPage(new MockCity(1));
    assert.equal(panel.hidden, true);
    const half = new MockCity(1, { rewards: true });
    half.reward_stats = undefined; // defined on the prototype: hide it on the instance
    assert.equal(setupPage(half).panel.hidden, true);
  });

  test("nothing is shown before the engine is ready, and nothing is built", () => {
    const { panel } = setupPage(new MockCity(1, { rewards: true }), { ready: false });
    assert.equal(panel.hidden, true);
    assert.equal(panel.children.length, 0);
  });
});
