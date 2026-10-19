// Page side of the trains and metro (docs/game-design-v06.md): genre 13 is named Gare; the traffic panel shows
// the rail rows after the transport rows, with the engine's rail_stats; the advisor warns about an idle train or
// metro line; the mock engine feeds all of it. Fake engines and a small fake document, no browser.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as agents from "../agents-model.js";
import * as ui from "../agents-ui.js";
import * as advisors from "../advisors-model.js";
import * as rail from "../advisors-rail.js";
import * as structures from "../structures-model.js";
import { readSnapshot, cheapKey } from "../advisors.js";
import { MockCity, MOCK_RAIL_STRUCTURES, MOCK_STRUCTURES, MOCK_TRANSIT_STRUCTURES, RAIL_FIXED } from "./mock-engine.mjs";

const norm = (s) => s.replace(/\s/g, " ");
const ZERO_RAIL = Object.freeze({ trains: 0, rames: 0, trainRiders: 0, metroRiders: 0, railIncome: 0, trainLines: 0, metroLines: 0 });
const TRAIN_ACTION = "Placez les gares près des quartiers résidentiels et des zones d'emploi.";
const METRO_ACTION = "Rapprochez les stations des quartiers sans voiture.";

// ---- names and records --------------------------------------------------------------------------

describe("genre 13 is the station, Gare", () => {
  test("nameOf(13) is Gare, and the v0.5 names are unchanged", () => {
    assert.equal(structures.nameOf(13), "Gare");
    assert.equal(structures.nameOf(12), "Dépôt de taxis");
    assert.equal(structures.nameOf(1), "Parc urbain");
  });

  test("a genre past the rail stays a number", () => {
    assert.equal(structures.nameOf(14), "Bâtiment n° 14");
  });
});

describe("rail_stats records", () => {
  test("seven numbers, named in order", () => {
    assert.equal(agents.RAIL_LEN, 7);
    assert.deepEqual(agents.decodeRail(Int32Array.of(2, 1, 340, 120, 900, 1, 1)), {
      trains: 2, rames: 1, trainRiders: 340, metroRiders: 120, railIncome: 900, trainLines: 1, metroLines: 1,
    });
  });

  test("a missing, empty or short array gives zeros for the missing values", () => {
    assert.deepEqual(agents.decodeRail(null), ZERO_RAIL);
    assert.deepEqual(agents.decodeRail([]), ZERO_RAIL);
    assert.deepEqual(agents.decodeRail(Int32Array.of(3, 4)), { ...ZERO_RAIL, trains: 3, rames: 4 });
  });

  test("garbage values read as 0 and never throw", () => {
    assert.deepEqual(agents.decodeRail([NaN, "x", undefined, {}, null, 1.5, 2]), { ...ZERO_RAIL, trainLines: 1, metroLines: 2 });
  });

  test("supportsRail: a function named rail_stats; no method means no rail rows", () => {
    assert.equal(agents.supportsRail({ rail_stats: () => [] }), true);
    assert.equal(agents.supportsRail({}), false);
    assert.equal(agents.supportsRail(null), false);
  });
});

describe("rail rows", () => {
  test("five rows, labels and values in order, the income in dollars", () => {
    const rows = agents.railLines(agents.decodeRail(Int32Array.of(2, 1, 340, 120, 900, 1, 1)));
    assert.deepEqual(rows, [
      ["Trains", "2"],
      ["Rames de métro", "1"],
      ["Voyageurs en train ce mois", "340"],
      ["Voyageurs en métro ce mois", "120"],
      ["Recettes du rail", "900 $"],
    ]);
  });

  test("thousands are grouped in French", () => {
    const rows = agents.railLines(agents.decodeRail(Int32Array.of(0, 0, 1234, 0, 1500, 0, 0)));
    assert.equal(norm(rows[2][1]), "1 234");
    assert.equal(norm(rows[4][1]), "1 500 $");
  });

  test("no argument shows zeros", () => {
    assert.deepEqual(agents.railLines(), agents.railLines(agents.decodeRail()));
    assert.equal(agents.railLines()[4][1], "0 $");
  });
});

// ---- the traffic panel --------------------------------------------------------------------------

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.checked = false;
    this._text = "";
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
  }
  find(pred, out = []) {
    if (pred(this)) out.push(this);
    for (const c of this.children) c.find(pred, out);
    return out;
  }
}

/** A fake City: the switch, the traffic and transport answers, and the rail answer (absent with withRail false). */
function fakeRailCity({ rules = true, rail = [2, 1, 340, 120, 900, 1, 1], withRail = true, withTransport = true } = {}) {
  const city = {
    rules, rail, rreads: 0,
    agent_rules: () => city.rules,
    set_agent_rules(on) {
      city.rules = Boolean(on);
    },
    agent_stats: () => (city.rules ? Int32Array.of(12, 340, 42, 3, 5678) : Int32Array.of(0, 0, 0, 0, 0)),
    transport_stats: () => (city.rules ? Int32Array.of(2, 1, 25, 340, 60, 1200) : Int32Array.of(0, 0, 0, 0, 0, 0)),
    rail_stats() {
      city.rreads++;
      return city.rules ? Int32Array.from(city.rail) : Int32Array.of(0, 0, 0, 0, 0, 0, 0);
    },
  };
  if (!withRail) delete city.rail_stats;
  if (!withTransport) delete city.transport_stats;
  return city;
}

function setupPage(city) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  const panel = new Node("section");
  panel.hidden = true;
  const api = {
    city: () => city,
    $: (id) => (id === "agents-panel" ? panel : null),
    redraw: () => ui.update(api),
    isReady: () => true,
    describe: () => ({ label: "Haight" }),
  };
  ui.setup(api);
  return { api, panel };
}

const statsOf = (panel) => panel.find((n) => n.attributes.id === "agent-stats")[0];
const rowsOf = (panel) => statsOf(panel).children.map((li) => [li.children[0].textContent, norm(li.children[1].textContent)]);

describe("agents panel rail rows", () => {
  test("rule on with rail_stats: the five rail rows follow the transport rows", () => {
    const { api, panel } = setupPage(fakeRailCity());
    ui.update(api);
    const rows = rowsOf(panel);
    assert.equal(rows.length, 16);
    assert.deepEqual(rows.slice(11), agents.railLines(agents.decodeRail(Int32Array.from(RAIL_FIXED))));
    assert.equal(rows[5][0], "Bus en service");
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
    assert.equal(rowsOf(panel)[10][0], "Recettes des transports");
  });

  test("without transport_stats the rail rows follow the five traffic rows", () => {
    const { api, panel } = setupPage(fakeRailCity({ withTransport: false }));
    ui.update(api);
    const rows = rowsOf(panel);
    assert.equal(rows.length, 10);
    assert.equal(rows[5][0], "Trains");
    assert.equal(rows[6][0], "Rames de métro");
  });

  test("a short rail answer gives zeros for the missing values", () => {
    const { api, panel } = setupPage(fakeRailCity({ rail: [3, 4] }));
    ui.update(api);
    const rows = rowsOf(panel);
    assert.deepEqual(rows.slice(11).map((r) => r[1]), ["3", "4", "0", "0", "0 $"]);
  });

  test("a new rail value shows after the reading window, as the other rows do", () => {
    const city = fakeRailCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    city.rail = [9, 1, 340, 120, 900, 1, 1];
    for (let i = 0; i < ui.READ_EVERY; i++) ui.update(api);
    assert.equal(rowsOf(panel)[11][1], "9");
  });

  test("the mock engine shows the rail rows after the transport rows", () => {
    const { api, panel } = setupPage(new MockCity(1));
    api.city().set_agent_rules(true);
    ui.update(api);
    const rows = rowsOf(panel);
    assert.equal(rows.length, 16);
    assert.deepEqual(rows[11], ["Trains", "2"]);
    assert.deepEqual(rows[15], ["Recettes du rail", "900 $"]);
  });
});

// ---- the advisor -------------------------------------------------------------------------------

// A calm city with the agents rule on and the given rail counts; nothing else in Urbanisme to say.
const railSnap = (r, agents = true) => ({
  funds: 50000, cashFlow: 500, taxRate: 7, funding: { road: 100, fire: 100, police: 100 },
  problems: [], demand: { res: 100, com: 100, ind: 100 }, population: 1000, populationDelta: 20,
  moneyHistory: [128, 128, 130], pollutionHistory: [10, 10, 10],
  rules: { agents }, rail: { ...ZERO_RAIL, ...r },
});
const planning = (s) => advisors.advise(s).find((a) => a.id === "planning");

describe("rail advice findings", () => {
  test("a train line with no train rider this month: attention, with the French words", () => {
    const a = planning(railSnap({ trainLines: 1, trainRiders: 0 }));
    assert.equal(a.severity, "attention");
    assert.equal(a.diagnosis, "Les trains roulent à vide.");
    assert.equal(a.action, TRAIN_ACTION);
  });

  test("a metro line with no metro rider this month: attention, with the French words", () => {
    const a = planning(railSnap({ metroLines: 2, metroRiders: 0 }));
    assert.equal(a.severity, "attention");
    assert.equal(a.diagnosis, "Le métro roule à vide.");
    assert.equal(a.action, METRO_ACTION);
  });

  test("a train line with riders, or no line at all, gives no rail finding", () => {
    assert.deepEqual(rail.railFindings(railSnap({ trainLines: 1, trainRiders: 1 })), []);
    assert.deepEqual(rail.railFindings(railSnap({ trainLines: 0, trainRiders: 0 })), []);
    assert.deepEqual(rail.railFindings(railSnap({ metroLines: 0, metroRiders: 0 })), []);
    assert.notEqual(planning(railSnap({ trainLines: 1, trainRiders: 1 })).action, TRAIN_ACTION);
  });

  test("a metro line with riders gives no metro finding", () => {
    assert.deepEqual(rail.railFindings(railSnap({ metroLines: 1, metroRiders: 5 })), []);
  });

  test("both idle lines give two findings, the train one first", () => {
    const list = rail.railFindings(railSnap({ trainLines: 1, metroLines: 1 }));
    assert.deepEqual(list.map((f) => f.diagnosis), ["Les trains roulent à vide.", "Le métro roule à vide."]);
    assert.equal(planning(railSnap({ trainLines: 1, metroLines: 1 })).action, TRAIN_ACTION);
  });

  test("a rail finding alone keeps Urbanisme visible at attention", () => {
    const only = { rules: { agents: true }, rail: { ...ZERO_RAIL, metroLines: 1 } };
    assert.equal(planning(only).severity, "attention");
  });

  test("rule off: the rail block is ignored, even with idle lines", () => {
    assert.deepEqual(rail.railFindings(railSnap({ trainLines: 1 }, false)), []);
    assert.equal(planning(railSnap({ trainLines: 1 }, false)).severity, "ok");
  });

  test("garbage in the rail block never throws and gives no finding", () => {
    for (const bad of [null, 5, "x", [], { trainLines: NaN }, { trainLines: {} }]) {
      const s = { ...railSnap({}), rail: bad };
      assert.ok(Array.isArray(advisors.advise(s)));
      assert.deepEqual(rail.railFindings(s), []);
    }
    assert.deepEqual(rail.railFindings(null), []);
  });
});

// ---- the snapshot reader and the cheap key ------------------------------------------------------

/** A fake engine for the reader: the rail answer and a count of the calls to it. */
function readerCity({ agents = true, rail = [0, 0, 340, 0, 0, 1, 0], withRail = true } = {}) {
  const calls = [];
  const city = {
    agents,
    agent_rules: () => (calls.push("agent_rules"), city.agents),
    rail_stats: () => (calls.push("rail_stats"), Int32Array.from(rail)),
  };
  if (!withRail) delete city.rail_stats;
  return { city, calls };
}

describe("snapshot reader and cheap key for the rail", () => {
  test("rule on: rail_stats is read and decoded into the snapshot", () => {
    const { city, calls } = readerCity();
    const s = readSnapshot(city);
    assert.equal(s.rail.trainRiders, 340);
    assert.equal(s.rail.trainLines, 1);
    assert.ok(calls.includes("rail_stats"));
  });

  test("rule off: rail_stats is never called and nothing is in the snapshot", () => {
    const { city, calls } = readerCity({ agents: false });
    assert.equal(readSnapshot(city).rail, undefined);
    cheapKey(city);
    assert.equal(calls.includes("rail_stats"), false);
  });

  test("no rail_stats method: no rail block", () => {
    const { city } = readerCity({ withRail: false });
    assert.equal(readSnapshot(city).rail, undefined);
  });

  test("cheapKey changes when the train riders (index 2) or the metro riders (index 3) change", () => {
    const base = cheapKey(readerCity({ rail: [0, 0, 340, 120, 0, 1, 1] }).city);
    assert.notEqual(base, cheapKey(readerCity({ rail: [0, 0, 341, 120, 0, 1, 1] }).city));
    assert.notEqual(base, cheapKey(readerCity({ rail: [0, 0, 340, 121, 0, 1, 1] }).city));
    assert.equal(base, cheapKey(readerCity({ rail: [0, 0, 340, 120, 0, 1, 1] }).city), "stable when nothing changes");
  });

  test("cheapKey ignores the rail with the rule off", () => {
    const a = cheapKey(readerCity({ agents: false, rail: [0, 0, 1, 0, 0, 0, 0] }).city);
    const b = cheapKey(readerCity({ agents: false, rail: [0, 0, 9, 0, 0, 0, 0] }).city);
    assert.equal(a, b);
  });
});

describe("the mock engine feeds the rail rows and the advisor", () => {
  test("rail_stats: seven zeros with the rule off, the fixed numbers with it on", () => {
    const city = new MockCity(1);
    assert.deepEqual(Array.from(city.rail_stats()), [0, 0, 0, 0, 0, 0, 0]);
    city.set_agent_rules(true);
    assert.deepEqual(Array.from(city.rail_stats()), Array.from(RAIL_FIXED));
    city.set_agent_rules(false);
    assert.deepEqual(Array.from(city.rail_stats()), [0, 0, 0, 0, 0, 0, 0]);
  });

  test("the mock's rail riders keep the advisor quiet (no idle line)", () => {
    const city = new MockCity(1);
    city.set_agent_rules(true);
    const s = readSnapshot(city);
    assert.equal(s.rail.trainLines, 1);
    assert.deepEqual(rail.railFindings(s), []);
  });

  test("the mock's rail numbers, idle: the advisor warns about the train line", () => {
    const city = new MockCity(1);
    city.set_agent_rules(true);
    const s = readSnapshot(city);
    // quiet the jam and the waiting riders (earlier findings of Urbanisme), as the transport test does
    const quiet = { ...s, agents: { ...s.agents, saturated: 0, meanTicks: 0 }, transport: { waiting: 0 }, rail: { ...s.rail, trainRiders: 0 } };
    assert.equal(planning(quiet).action, TRAIN_ACTION);
  });

  test("rail_stats is in the cheap key: the mock's rail riders change the key", () => {
    const city = new MockCity(1);
    city.set_agent_rules(true);
    const before = cheapKey(city);
    city.rail_stats = () => Int32Array.of(2, 1, 0, 120, 900, 1, 1);
    assert.notEqual(cheapKey(city), before);
  });
});

describe("the mock catalog gets the station only with the rail option", () => {
  const genres = (city) => structures.decodeCatalog(city.structure_catalog()).map((r) => r.genre);

  test("structures alone: the v0.4 catalog, no station", () => {
    assert.deepEqual(genres(new MockCity(1, { structures: true })), MOCK_STRUCTURES.map((m) => m.genre));
    assert.deepEqual(genres(new MockCity(1, { structures: true })), [1, 2, 3]);
  });

  test("structures and rail: the station, genre 13, 2x2, named Gare", () => {
    const city = new MockCity(1, { structures: true, rail: true });
    const decoded = structures.decodeCatalog(city.structure_catalog());
    assert.deepEqual(decoded.map((r) => r.genre), [1, 2, 3, 13]);
    const station = decoded.find((r) => r.genre === 13);
    assert.equal(station.width, 2);
    assert.equal(station.height, 2);
    assert.equal(station.cost, MOCK_RAIL_STRUCTURES[0].cost);
    assert.equal(structures.nameOf(station.genre), "Gare");
  });

  test("structures, transit and rail: the transit genres come before the station", () => {
    const g = genres(new MockCity(1, { structures: true, transit: true, rail: true }));
    assert.deepEqual(g, [...MOCK_STRUCTURES, ...MOCK_TRANSIT_STRUCTURES, ...MOCK_RAIL_STRUCTURES].map((m) => m.genre));
  });

  test("the rail option alone adds no catalog: the buildings are not there", () => {
    assert.equal(new MockCity(1, { rail: true }).structure_catalog, undefined);
  });

  test("the station can be placed where a 2x2 building fits", () => {
    const city = new MockCity(1, { structures: true, rail: true, funds: 100000 });
    city.set_structure_rules(true);
    let placed = null;
    for (let x = 1; x < 39 && !placed; x++) {
      for (let y = 1; y < 29 && !placed; y++) {
        if (city.place_structure(13, x, y) === 1) placed = [x, y];
      }
    }
    assert.ok(placed, "a free spot exists on the mock map");
    const [st] = city.structures();
    assert.equal(st, 13);
  });
});
