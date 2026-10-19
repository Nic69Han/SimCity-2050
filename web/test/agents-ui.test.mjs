// Tests of the «Circulation simulée» panel (web/agents-ui.js) with a small fake document and a fake
// engine that follows the agents contract; the mock engine's agent methods are tested at the end.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../agents-ui.js";
import { MockCity } from "./mock-engine.mjs";

/** A fake City: the switch and five numbers; `calls` records what the page asked of it. */
function fakeCity({ rules = false, stats = [12, 340, 42, 3, 5678] } = {}) {
  const city = {
    rules, stats, calls: [], reads: 0,
    agent_rules: () => city.rules,
    set_agent_rules(on) {
      city.calls.push(["rules", on]);
      city.rules = Boolean(on);
    },
    agent_stats() {
      city.reads++;
      return city.rules ? Int32Array.from(city.stats) : Int32Array.of(0, 0, 0, 0, 0);
    },
  };
  return city;
}

// ---- fake document ------------------------------------------------------------------------

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.checked = false;
    this.sets = 0;
    this._text = "";
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this.sets++;
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
    this.replaced = (this.replaced ?? 0) + 1;
  }
  find(pred, out = []) {
    if (pred(this)) out.push(this);
    for (const c of this.children) c.find(pred, out);
    return out;
  }
}

function setupPage(city, { ready = true } = {}) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  const panel = new Node("section");
  panel.hidden = true;
  const page = { label: "Haight" };
  const api = {
    city: () => city,
    $: (id) => (id === "agents-panel" ? panel : null),
    redraw: () => ui.update(api),
    isReady: () => ready,
    describe: () => page,
  };
  ui.setup(api);
  return { api, panel, page };
}

const byId = (panel, id) => panel.find((n) => n.attributes.id === id)[0];
const statsOf = (panel) => byId(panel, "agent-stats");
const rowTexts = (panel) => statsOf(panel).children.map((li) => li.textContent.replace(/[  ]/g, " "));
const flush = (api) => { for (let i = 0; i < ui.READ_EVERY; i++) ui.update(api); };
const writes = (panel) => panel.find(() => true).reduce((n, node) => n + node.sets + (node.replaced ?? 0), 0);

describe("agents panel", () => {
  test("hidden until the engine answers, and hidden when the engine lacks the API", () => {
    const { api, panel } = setupPage({});
    ui.update(api);
    assert.equal(panel.hidden, true);
    assert.equal(panel.children.length, 0);
    const half = fakeCity();
    delete half.agent_stats;
    const partial = setupPage(half);
    ui.update(partial.api);
    assert.equal(partial.panel.hidden, true);
    const early = setupPage(fakeCity(), { ready: false });
    ui.update(early.api);
    assert.equal(early.panel.hidden, true);
  });

  test("with the rule off the switch and the state are shown, and no stats are read", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    assert.equal(panel.hidden, false);
    assert.equal(panel.find((n) => n.tagName === "h2")[0].textContent, "Circulation simulée");
    assert.equal(byId(panel, "agents-rules").checked, false);
    assert.equal(byId(panel, "agent-state").textContent, "Désactivée : aucune voiture ne circule.");
    assert.equal(statsOf(panel).hidden, true);
    assert.equal(city.reads, 0);
    assert.deepEqual(city.calls, [], "update() never writes to the engine");
  });

  test("ticking the switch asks the engine, redraws, and shows the five stats", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    const box = byId(panel, "agents-rules");
    box.checked = true;
    box.onchange();
    assert.deepEqual(city.calls, [["rules", true]]);
    assert.equal(byId(panel, "agent-state").textContent, "Activée : les voitures roulent sur les routes.");
    assert.equal(statsOf(panel).hidden, false);
    assert.deepEqual(rowTexts(panel), [
      "Voitures en route12",
      "Trajets terminés340",
      "Durée moyenne d'un trajet42 pas",
      "Tuiles saturées3",
      "Habitants motorisés5 678",
    ]);
  });

  test("unticking the switch removes the stats again", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    const box = byId(panel, "agents-rules");
    box.checked = true;
    box.onchange();
    assert.equal(statsOf(panel).children.length, 5);
    box.checked = false;
    box.onchange();
    assert.deepEqual(city.calls.at(-1), ["rules", false]);
    assert.equal(statsOf(panel).hidden, true);
    assert.equal(statsOf(panel).children.length, 0);
  });

  test("update() reads the stats once in READ_EVERY calls and rewrites the DOM only when the text changes", () => {
    const city = fakeCity({ rules: true });
    const { api, panel } = setupPage(city);
    ui.update(api);
    const [before, reads] = [writes(panel), city.reads];
    for (let i = 0; i < 5 * ui.READ_EVERY; i++) ui.update(api);
    assert.equal(writes(panel), before, "no DOM write when nothing changed");
    assert.ok(city.reads - reads <= 5, `${city.reads - reads} reads in ${5 * ui.READ_EVERY} updates`);
    city.stats = [20, 340, 42, 3, 5678];
    flush(api);
    assert.equal(rowTexts(panel)[0], "Voitures en route20");
  });

  test("a new reading inside the throttle window waits for the next READ_EVERY-th call", () => {
    const city = fakeCity({ rules: true });
    const { api, panel } = setupPage(city);
    ui.update(api);
    city.stats = [99, 340, 42, 3, 5678];
    for (let i = 1; i < ui.READ_EVERY; i++) ui.update(api);
    assert.equal(rowTexts(panel)[0], "Voitures en route12", "still the old value inside the window");
    ui.update(api);
    assert.equal(rowTexts(panel)[0], "Voitures en route99");
  });

  test("after another city or a load the switch and the stats follow the engine at once", () => {
    const city = fakeCity({ rules: true });
    const { api, panel, page } = setupPage(city);
    ui.update(api);
    // Another city: the rule is off there.
    city.rules = false;
    page.label = "Kyoto";
    ui.update(api);
    assert.equal(byId(panel, "agents-rules").checked, false);
    assert.equal(statsOf(panel).hidden, true);
    assert.deepEqual(city.calls, [], "update() never writes");
    // Another city with the rule on and other numbers.
    city.rules = true;
    city.stats = [3, 4, 5, 6, 7];
    page.label = "Tokyo";
    ui.update(api);
    assert.equal(byId(panel, "agents-rules").checked, true);
    assert.equal(rowTexts(panel)[0], "Voitures en route3");
    assert.deepEqual(city.calls, []);
  });

  test("a load of the same city name with the rule on still re-reads the stats at once (game id)", () => {
    const city = fakeCity({ rules: true });
    const { api, panel } = setupPage(city);
    let game = { id: 1, kind: "sample" };
    api.game = () => game;
    ui.update(api);
    assert.equal(rowTexts(panel)[0], "Voitures en route12");
    // A save loaded over it: same label in the selector, the rule still on, other numbers.
    city.stats = [3, 4, 5, 6, 7];
    game = { id: 2, kind: "save" };
    ui.update(api);
    assert.equal(rowTexts(panel)[0], "Voitures en route3");
  });

  test("a rule changed by the engine without a new city is noticed on the next update", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    city.rules = true;
    ui.update(api);
    assert.equal(byId(panel, "agents-rules").checked, true);
    assert.equal(statsOf(panel).children.length, 5);
  });
});

describe("mock engine agents", () => {
  test("off by default: no vehicles, zero stats, zero load", () => {
    const city = new MockCity(1);
    assert.equal(city.agent_rules(), false);
    assert.deepEqual([...city.agent_stats()], [0, 0, 0, 0, 0]);
    assert.equal(city.vehicles(100).length, 0);
    assert.equal(city.traffic_load().length, 40 * 30);
    assert.ok(city.traffic_load().every((v) => v === 0));
  });

  test("on: vehicles are records of 5 and capped by max", () => {
    const city = new MockCity(1);
    city.set_agent_rules(true);
    assert.equal(city.agent_rules(), true);
    const all = city.vehicles(100);
    assert.equal(all.length % 5, 0);
    const count = all.length / 5;
    assert.ok(count > 2, "a few cars");
    for (let i = 0; i < count; i++) {
      const [id, kind, x16, y16, dir] = all.subarray(i * 5, i * 5 + 5);
      assert.equal(id, i + 1);
      assert.equal(kind, 0);
      assert.ok(dir >= 0 && dir <= 3);
      assert.ok(x16 >= 0 && y16 >= 0);
    }
    assert.equal(city.vehicles(2).length, 10, "capped by max");
    assert.equal(city.vehicles(0).length, 0);
    const twin = new MockCity(1);
    twin.set_agent_rules(true);
    assert.deepEqual([...twin.vehicles(3)], [...city.vehicles(3)], "deterministic");
    const stats = city.agent_stats();
    assert.equal(stats[0], count, "active cars match the list");
    assert.ok(city.traffic_load().some((v) => v > 0));
  });

  test("a new city or a load switches the rule off again", () => {
    const city = new MockCity(1);
    city.set_agent_rules(true);
    city.new_random_city(2);
    assert.equal(city.agent_rules(), false);
    city.set_agent_rules(true);
    city.load_cty();
    assert.equal(city.agent_rules(), false);
  });
});

// ---- transport rows (docs/game-design-v05.md): after the five traffic rows, read in the same throttle ----

/** A fake City with the transport answer too; `treads` counts transport_stats() calls. */
function fakeTransportCity({ rules = true, transport = [2, 1, 25, 340, 60, 1200] } = {}) {
  const city = fakeCity({ rules });
  city.transport = transport;
  city.treads = 0;
  city.transport_stats = () => {
    city.treads++;
    return city.rules ? Int32Array.from(city.transport) : Int32Array.of(0, 0, 0, 0, 0, 0);
  };
  return city;
}

const TRANSPORT_LABELS = [
  "Bus en service", "Taxis en service", "Voyageurs en attente",
  "Voyages en bus ce mois", "Courses de taxi ce mois", "Recettes des transports",
];

describe("agents panel transport rows", () => {
  test("with transport_stats the six rows follow the five traffic rows, in order", () => {
    const { api, panel } = setupPage(fakeTransportCity());
    ui.update(api);
    const items = statsOf(panel).children;
    assert.equal(items.length, 11);
    assert.deepEqual(items.slice(5).map((li) => li.children[0].textContent), TRANSPORT_LABELS);
    const values = items.slice(5).map((li) => li.children[1].textContent.replace(/[\s\u00a0\u202f]/g, " "));
    assert.deepEqual(values, ["2", "1", "25", "340", "60", "1 200 $"]);
  });

  test("the transport rows are not there while the traffic rule is off, and transport_stats is not read", () => {
    const city = fakeTransportCity({ rules: false });
    const { api, panel } = setupPage(city);
    ui.update(api);
    assert.equal(city.treads, 0);
    assert.equal(statsOf(panel).hidden, true);
    assert.equal(statsOf(panel).children.length, 0);
  });

  test("an engine without transport_stats keeps the five traffic rows", () => {
    const city = fakeCity({ rules: true });
    const { api, panel } = setupPage(city);
    ui.update(api);
    assert.equal(statsOf(panel).children.length, 5);
  });

  test("a short transport answer gives zeros for the missing values", () => {
    const city = fakeTransportCity({ transport: [3, 4] });
    const { api, panel } = setupPage(city);
    ui.update(api);
    const values = statsOf(panel).children.slice(5).map((li) => li.children[1].textContent.replace(/[\s  ]/g, " "));
    assert.deepEqual(values, ["3", "4", "0", "0", "0", "0 $"]);
  });

  test("transport_stats is read once in READ_EVERY calls, and the waiting count shows after the window", () => {
    const city = fakeTransportCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    const reads = city.treads;
    for (let i = 0; i < 5 * ui.READ_EVERY; i++) ui.update(api);
    assert.ok(city.treads - reads <= 5, `${city.treads - reads} reads in ${5 * ui.READ_EVERY} updates`);
    const before = writes(panel);
    for (let i = 0; i < 5 * ui.READ_EVERY; i++) ui.update(api);
    assert.equal(writes(panel), before, "no DOM write when nothing changed");
    city.transport = [2, 1, 99, 340, 60, 1200];
    flush(api);
    assert.equal(rowTexts(panel)[7], "Voyageurs en attente99");
  });

  test("another city with the rule on shows the transport numbers of that city at once", () => {
    const city = fakeTransportCity();
    const { api, panel, page } = setupPage(city);
    api.game = () => page;
    ui.update(api);
    city.transport = [0, 0, 7, 0, 0, 0];
    page.label = "Kyoto";
    ui.update(api);
    assert.equal(rowTexts(panel)[7], "Voyageurs en attente7");
  });
});

// ---- rail rows (docs/game-design-v06.md): after the transport rows, read in the same throttle ----

/** A fake City with the rail answer too; `rreads` counts rail_stats() calls. withRail false removes the method. */
function fakeRailCity({ rules = true, rail = [2, 1, 340, 120, 900, 1, 1], withRail = true } = {}) {
  const city = fakeTransportCity({ rules });
  city.rail = rail;
  city.rreads = 0;
  city.rail_stats = () => {
    city.rreads++;
    return city.rules ? Int32Array.from(city.rail) : Int32Array.of(0, 0, 0, 0, 0, 0, 0);
  };
  if (!withRail) delete city.rail_stats;
  return city;
}

const RAIL_LABELS = ["Trains", "Rames de métro", "Voyageurs en train ce mois", "Voyageurs en métro ce mois", "Recettes du rail"];
/** [label, value] of each row, the value with plain spaces. */
const pairsOf = (panel) => statsOf(panel).children.map((li) => [
  li.children[0].textContent, li.children[1].textContent.replace(/[\s  ]/g, " "),
]);

describe("agents panel rail rows", () => {
  test("rule on with rail_stats: the five rail rows follow the transport rows", () => {
    const { api, panel } = setupPage(fakeRailCity());
    ui.update(api);
    const rows = pairsOf(panel);
    assert.equal(rows.length, 16);
    assert.deepEqual(rows.slice(5, 11).map((r) => r[0]), TRANSPORT_LABELS);
    assert.deepEqual(rows.slice(11), [
      ["Trains", "2"],
      ["Rames de métro", "1"],
      ["Voyageurs en train ce mois", "340"],
      ["Voyageurs en métro ce mois", "120"],
      ["Recettes du rail", "900 $"],
    ]);
  });

  test("rule off: no rail row, and rail_stats is never read", () => {
    const city = fakeRailCity({ rules: false });
    const { api, panel } = setupPage(city);
    ui.update(api);
    assert.equal(city.rreads, 0);
    assert.equal(statsOf(panel).hidden, true);
    assert.equal(statsOf(panel).children.length, 0);
  });

  test("an engine without rail_stats keeps the traffic and transport rows only", () => {
    const { api, panel } = setupPage(fakeRailCity({ withRail: false }));
    ui.update(api);
    assert.equal(statsOf(panel).children.length, 11);
    assert.equal(pairsOf(panel)[10][0], "Recettes des transports");
  });

  test("without transport_stats the rail rows follow the five traffic rows", () => {
    const city = fakeRailCity();
    delete city.transport_stats;
    const { api, panel } = setupPage(city);
    ui.update(api);
    const rows = pairsOf(panel);
    assert.equal(rows.length, 10);
    assert.deepEqual(rows.slice(5).map((r) => r[0]), RAIL_LABELS);
  });

  test("a short rail answer gives zeros for the missing values", () => {
    const { api, panel } = setupPage(fakeRailCity({ rail: [3, 4] }));
    ui.update(api);
    assert.deepEqual(pairsOf(panel).slice(11).map((r) => r[1]), ["3", "4", "0", "0", "0 $"]);
  });

  test("a new rail value shows after the reading window, as the other rows do", () => {
    const city = fakeRailCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    city.rail = [9, 1, 340, 120, 900, 1, 1];
    flush(api);
    assert.equal(pairsOf(panel)[11][1], "9");
  });

  test("the mock engine shows the rail rows after the transport rows", () => {
    const { api, panel } = setupPage(new MockCity(1));
    api.city().set_agent_rules(true);
    ui.update(api);
    const rows = pairsOf(panel);
    assert.equal(rows.length, 16);
    assert.deepEqual(rows[11], ["Trains", "2"]);
    assert.deepEqual(rows[15], ["Recettes du rail", "900 $"]);
  });
});
