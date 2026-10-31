// Tests of the challenges panel (web/challenges-ui.js) with a fake page and the mock engine: the list and its buttons,
// starting through the page's own paths (city selector, «Nouvelle ville»), progress and time left, the verdicts announced
// in a role="status" line, one evaluation per game month, the best results in localStorage (and without it), the
// abandon when another city is loaded, and the engine-dependent challenges.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../challenges-ui.js";
import { CHALLENGES, STORAGE_KEY, MONTHS_PER_YEAR } from "../challenges-model.js";
import { MockCity } from "./mock-engine.mjs";

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this._text = "";
    this.handlers = {};
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
    this._text = "";
    this.children = nodes;
  }
  dispatchEvent(event) {
    this.handlers[event.type]?.(event);
  }
  click() {
    this.onclick?.();
  }
  find(pred, out = []) {
    if (pred(this)) out.push(this);
    for (const c of this.children) c.find(pred, out);
    return out;
  }
}
globalThis.Event ??= class { constructor(type) { this.type = type; } };

// A mock engine whose clock, population and funds the test sets. A month is advanced by hand.
class TimedCity extends MockCity {
  now = 1900 * MONTHS_PER_YEAR;
  pop = 0;
  money = 1000;
  reads = 0;
  year() { return Math.floor(this.now / MONTHS_PER_YEAR); }
  month() { return this.now % MONTHS_PER_YEAR; }
  population() { this.reads++; return this.pop; }
  funds() { return this.money; }
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); } };
}

// The page: the panel, the selector, the seed box and button; loading a city bumps the game id and redraws.
function setupPage(city, { newcity = true, ready = true, storage = memoryStorage() } = {}) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  globalThis.localStorage = storage;
  const nodes = {
    "challenges-panel": new Node("section"), city: new Node("select"), seed: new Node("input"),
    "newcity-btn": new Node("button"), newcity: new Node("div"), relief: new Node("input"),
  };
  nodes.newcity.hidden = !newcity;
  const page = { game: { id: 1 }, ready, loads: [], reliefEvents: 0 };
  const load = (what) => {
    page.loads.push(what);
    page.game = { id: page.game.id + 1 };
    api.redraw();
  };
  nodes.city.handlers.change = () => load(`sample:${nodes.city.value}`);
  nodes["newcity-btn"].onclick = () => load(`seed:${nodes.seed.value}`);
  nodes.relief.handlers.change = () => { page.reliefEvents++; };
  const api = {
    city: () => city,
    $: (id) => nodes[id] ?? null,
    redraw: () => ui.update(api),
    isReady: () => page.ready,
    game: () => page.game,
  };
  ui.setup(api);
  return { api, page, nodes, panel: nodes["challenges-panel"], storage };
}

const startButtons = (panel) => panel.find((n) => n.tagName === "button" && n.textContent === ui.START_TEXT);
const buttonOf = (panel, id) => startButtons(panel)[CHALLENGES.findIndex((c) => c.id === id)];
const status = (panel) => panel.find((n) => n.attributes.role === "status")[0].textContent;
const running = (panel) => panel.find((n) => n.attributes.class === "challenge-running")[0];
const newcityWith = (extra) => new TimedCity(1, extra);

describe("the panel", () => {
  test("hidden until the page is ready, then a title and a «Commencer» per challenge", () => {
    const { api, panel, page } = setupPage(newcityWith(), { ready: false });
    api.redraw();
    assert.equal(panel.hidden, true);
    page.ready = true;
    api.redraw();
    assert.equal(panel.hidden, false);
    assert.equal(panel.find((n) => n.tagName === "h2")[0].textContent, "Défis");
    assert.equal(startButtons(panel).length, CHALLENGES.length);
    assert.equal(running(panel).hidden, true);
    assert.equal(panel.find((n) => n.attributes.role === "status").length, 1);
  });

  test("a challenge that needs missing engine methods is disabled with a reason", () => {
    const { api, panel } = setupPage(newcityWith());
    api.redraw();
    assert.equal(buttonOf(panel, "all-rewards").disabled, true);
    assert.equal(buttonOf(panel, "first-year").disabled, false);
    assert.match(panel.textContent, /Indisponible avec ce moteur/u);
  });

  test("a seed challenge is disabled when the page cannot make a new city", () => {
    const { api, panel } = setupPage(newcityWith(), { newcity: false });
    api.redraw();
    assert.equal(buttonOf(panel, "new-town").disabled, true);
    assert.match(panel.textContent, /graine/u);
  });

  test("the rewards and power challenges are offered with the extended rules", () => {
    const { api, panel } = setupPage(newcityWith({ rewards: true, energy: true }));
    api.redraw();
    assert.equal(buttonOf(panel, "all-rewards").disabled, false);
    assert.equal(buttonOf(panel, "power-ok").disabled, false);
  });
});

describe("starting", () => {
  test("a sample challenge loads its city through the selector's change handler", () => {
    const { api, panel, page, nodes } = setupPage(newcityWith());
    api.redraw();
    buttonOf(panel, "first-year").click();
    assert.deepEqual(page.loads, ["sample:haight"]);
    assert.equal(nodes.city.value, "haight");
    assert.equal(running(panel).hidden, false);
    assert.match(running(panel).textContent, /Une année sans faillite/u);
    assert.match(running(panel).textContent, /Fonds : 1\s?000 \$/u);
    assert.match(running(panel).textContent, /Il reste 1 an\./u);
  });

  test("a seed challenge uses the seed box and the «Nouvelle ville» button", () => {
    const { api, panel, page, nodes } = setupPage(newcityWith());
    api.redraw();
    buttonOf(panel, "new-town").click();
    assert.deepEqual(page.loads, ["seed:2050"]);
    assert.equal(nodes.seed.value, "2050");
    assert.equal(running(panel).hidden, false);
  });

  test("the challenge begins only when the page reports a new game (an async sample load)", () => {
    const city = newcityWith();
    const { api, panel, page, nodes } = setupPage(city);
    nodes.city.handlers.change = () => {}; // the sample arrives later
    api.redraw();
    buttonOf(panel, "first-year").click();
    assert.equal(running(panel).hidden, true);
    assert.match(status(panel), /Chargement/u);
    page.game = { id: page.game.id + 1 };
    api.redraw();
    assert.equal(running(panel).hidden, false);
    assert.equal(status(panel), "");
  });

  test("the rules the challenge needs are switched on after the load, and the relief box relays them", () => {
    const city = newcityWith({ rewards: true });
    const { api, panel, page } = setupPage(city);
    api.redraw();
    assert.equal(city.reward_rules(), false);
    buttonOf(panel, "all-rewards").click();
    assert.equal(city.reward_rules(), true);
    assert.equal(page.reliefEvents, 1);
  });

  test("nothing starts while the page is not ready or the challenge is blocked", () => {
    const { api, panel, page } = setupPage(newcityWith());
    api.redraw();
    buttonOf(panel, "all-rewards").click();
    assert.deepEqual(page.loads, []);
  });
});

describe("progress and verdicts", () => {
  let city;
  let env;
  beforeEach(() => {
    city = newcityWith();
    env = setupPage(city);
    env.api.redraw();
  });
  const month = (n = 1) => {
    city.now += n;
    env.api.redraw();
  };

  test("the time left and the figures follow the months", () => {
    buttonOf(env.panel, "first-year").click();
    city.money = 777;
    month(5);
    assert.match(running(env.panel).textContent, /Fonds : 777 \$/u);
    assert.match(running(env.panel).textContent, /Il reste 7 mois\./u);
  });

  test("a hold challenge is won at the deadline and announced", () => {
    buttonOf(env.panel, "first-year").click();
    month(11);
    assert.equal(status(env.panel), "");
    month(1);
    assert.match(status(env.panel), /^Défi gagné : « Une année sans faillite » en 1 an\.$/u);
    assert.equal(running(env.panel).hidden, true);
    assert.match(env.panel.textContent, /Meilleur : gagné en 1 an/u);
  });

  test("a hold challenge is lost as soon as the funds run out", () => {
    buttonOf(env.panel, "first-year").click();
    month(3);
    city.money = -5;
    month(1);
    assert.match(status(env.panel), /^Défi perdu/u);
    assert.equal(running(env.panel).hidden, true);
    assert.match(env.panel.textContent, /Déjà tenté : perdu/u);
  });

  test("a reach challenge is won when the population gets there", () => {
    buttonOf(env.panel, "new-town").click();
    month(10);
    assert.equal(status(env.panel), "");
    city.pop = 10000;
    month(1);
    assert.match(status(env.panel), /^Défi gagné : « Une ville neuve de 10 000 habitants » en 11 mois\.$/u);
  });

  test("a reach challenge is lost when the deadline passes", () => {
    buttonOf(env.panel, "new-town").click();
    month(25 * MONTHS_PER_YEAR);
    assert.match(status(env.panel), /délai est dépassé/u);
  });

  test("the rewards challenge is won when five rewards are unlocked", () => {
    city = newcityWith({ rewards: true });
    env = setupPage(city);
    env.api.redraw();
    buttonOf(env.panel, "all-rewards").click();
    for (const genre of [50, 51, 52, 53, 54]) city.mock_unlock_reward(genre);
    month(1);
    assert.match(status(env.panel), /^Défi gagné : « Toutes les récompenses/u);
  });

  test("the engine is judged once per game month, not at every redraw", () => {
    buttonOf(env.panel, "new-town").click();
    month(1);
    const before = city.reads;
    for (let i = 0; i < 20; i++) env.api.redraw();
    assert.equal(city.reads, before, "no new reading inside the same month");
    month(1);
    assert.ok(city.reads > before);
  });

  test("loading another city abandons the challenge", () => {
    buttonOf(env.panel, "first-year").click();
    env.page.game = { id: env.page.game.id + 1 };
    env.api.redraw();
    assert.equal(running(env.panel).hidden, true);
    assert.match(status(env.panel), /Défi abandonné/u);
  });

  test("«Abandonner» stops the challenge without a result", () => {
    buttonOf(env.panel, "first-year").click();
    env.panel.find((n) => n.attributes.id === "challenge-giveup")[0].click();
    env.api.redraw();
    assert.equal(running(env.panel).hidden, true);
    assert.equal(status(env.panel), "");
    assert.equal(env.storage.data[STORAGE_KEY], undefined);
  });

  test("starting another challenge replaces the running one", () => {
    buttonOf(env.panel, "first-year").click();
    buttonOf(env.panel, "new-town").click();
    assert.match(running(env.panel).textContent, /Une ville neuve/u);
  });
});

describe("best results in localStorage", () => {
  test("a result is written, and read back at the next setup", () => {
    const city = newcityWith();
    const env = setupPage(city);
    env.api.redraw();
    buttonOf(env.panel, "first-year").click();
    city.now += 12;
    env.api.redraw();
    assert.deepEqual(JSON.parse(env.storage.data[STORAGE_KEY]), { "first-year": { result: "won", months: 12 } });
    const again = setupPage(newcityWith(), { storage: env.storage });
    again.api.redraw();
    assert.match(again.panel.textContent, /Meilleur : gagné en 1 an/u);
  });

  test("a bad stored text is ignored", () => {
    const env = setupPage(newcityWith(), { storage: memoryStorage({ [STORAGE_KEY]: "{oops" }) });
    env.api.redraw();
    assert.match(env.panel.textContent, /Pas encore tenté/u);
  });

  test("without storage, or when it throws, the challenge still ends and shows its result", () => {
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
    for (const storage of [throwing, undefined]) {
      const city = newcityWith();
      const env = setupPage(city, { storage });
      globalThis.localStorage = storage;
      env.api.redraw();
      buttonOf(env.panel, "first-year").click();
      city.now += 12;
      env.api.redraw();
      assert.match(status(env.panel), /^Défi gagné/u);
      assert.match(env.panel.textContent, /Meilleur : gagné en 1 an/u, "kept in memory");
    }
  });
});
