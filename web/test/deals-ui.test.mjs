// Tests of the deals panel (web/deals-ui.js) with a small fake document and a fake engine that
// follows the contract of the wasm adapter (crates/micropolis-wasm/src/deals.rs).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../deals-ui.js";

const BASE = [[100, 5], [4, 60], [150, 4], [5, 50], [200, 6], [6, 70], [250, 4], [8, 55]];

/** A fake City: a power surplus, a water surplus and a deal list; the rules are the engine's. */
function fakeCity({ power = 700, water = 0, rules = false } = {}) {
  const city = {
    rules, power, water, deals: [], calls: [], reads: 0,
    deals_rules: () => city.rules,
    set_deals_rules(on) {
      city.calls.push(["rules", on]);
      city.rules = on;
      if (!on) city.deals = [];
    },
    free: (r) => (r === 0 ? city.power : city.water) - city.deals.filter((d) => d.resource === r).reduce((s, d) => s + d.amount, 0),
    status(i) {
      const [n, r] = [i >> 1, i & 1];
      if (city.deals.some((d) => d.neighbour === n && d.resource === r)) return -2;
      return city.free(r) >= BASE[i][0] ? 1 : -3;
    },
    deal_offers() {
      city.reads++;
      if (!city.rules) return new Int32Array();
      return Int32Array.from(BASE.flatMap(([a, p], i) => [i >> 1, i & 1, a, p, a * p, city.status(i)]));
    },
    active_deals: () => Int32Array.from(city.deals.flatMap((d) => [d.neighbour, d.resource, d.amount, d.price, d.amount * d.price, d.covered === false ? 0 : 1, (d.amount * d.price) / 2])),
    accept_deal(i) {
      city.calls.push(["accept", i]);
      if (i < 0 || i >= 8) return 0;
      const code = city.status(i);
      if (code === 1) city.deals.push({ neighbour: i >> 1, resource: i & 1, amount: BASE[i][0], price: BASE[i][1] });
      return code;
    },
    cancel_deal(i) {
      city.calls.push(["cancel", i]);
      if (i < 0 || i >= city.deals.length) return 0;
      city.deals.splice(i, 1);
      return 1;
    },
    surplus: () => (city.rules ? Int32Array.from([city.free(0), city.free(1)]) : Int32Array.from([0, 0])),
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
    this.disabled = false;
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
    $: (id) => (id === "deals-panel" ? panel : null),
    redraw: () => ui.update(api),
    isReady: () => ready,
    describe: () => page,
  };
  ui.setup(api);
  return { api, panel, page };
}

const byId = (panel, id) => panel.find((n) => n.attributes.id === id)[0];
const rows = (panel, id) => byId(panel, id).children;
const buttons = (row) => row.find((n) => n.tagName === "button");
const norm = (s) => s.replace(/[\u00a0\u202f]/g, " ");
const flush = (api) => { for (let i = 0; i < ui.READ_EVERY; i++) ui.update(api); };

describe("deals panel", () => {
  test("hidden until the engine answers, and hidden when the engine lacks the API", () => {
    const { api, panel } = setupPage({});
    assert.equal(panel.hidden, true);
    ui.update(api);
    assert.equal(panel.hidden, true);
    assert.equal(panel.children.length, 0);
    const half = fakeCity();
    delete half.cancel_deal;
    const page = setupPage(half);
    ui.update(page.api);
    assert.equal(page.panel.hidden, true);
    const early = setupPage(fakeCity(), { ready: false });
    ui.update(early.api);
    assert.equal(early.panel.hidden, true);
  });

  test("with the rule off only the switch is offered, and reading never writes", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    assert.equal(panel.hidden, false);
    assert.equal(panel.find((n) => n.tagName === "h2")[0].textContent, "Accords avec les voisins");
    const box = byId(panel, "deals-rules");
    assert.equal(box.checked, false);
    assert.equal(panel.find((n) => n.attributes.class === "deal-details")[0].hidden, true);
    assert.deepEqual(city.calls, []);
  });

  test("ticking the switch asks the engine and then lists surplus, offers and the total", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    const box = byId(panel, "deals-rules");
    box.checked = true;
    box.onchange();
    assert.deepEqual(city.calls, [["rules", true]]);
    assert.equal(panel.find((n) => n.attributes.class === "deal-details")[0].hidden, false);
    assert.equal(norm(byId(panel, "deal-surplus").textContent), "Surplus disponible : électricité 700 unités, eau 0 unités.");
    const offers = rows(panel, "deal-offers");
    assert.equal(offers.length, 8);
    const first = norm(offers[0].textContent);
    assert.match(first, /Valmont \(nord\) · Électricité/);
    assert.match(first, /100 unités d'électricité par an à 5 \$ l'unité/);
    assert.match(first, /Recette : 500 \$ par an/);
    assert.equal(buttons(offers[0])[0].disabled, false);
    // Not enough water: the button is off and says why.
    const water = buttons(offers[1])[0];
    assert.equal(water.disabled, true);
    assert.equal(water.attributes.title, "Surplus insuffisant pour honorer cet accord.");
    assert.equal(byId(panel, "deal-total").textContent, "Aucun accord en cours.");
  });

  test("Signer signs through the engine and the deal appears with its income and a Résilier button", () => {
    const city = fakeCity({ rules: true });
    const { api, panel } = setupPage(city);
    ui.update(api);
    buttons(rows(panel, "deal-offers")[0])[0].onclick();
    assert.deepEqual(city.calls, [["accept", 0]]);
    const active = rows(panel, "deal-active");
    assert.equal(active.length, 1);
    const text = norm(active[0].textContent);
    assert.match(text, /Valmont \(nord\) · Électricité/);
    assert.match(text, /Recette : 500 \$ par an/);
    assert.match(text, /Honoré/);
    assert.equal(norm(byId(panel, "deal-total").textContent), "Recettes des accords : 500 $ par an (1 en cours).");
    assert.equal(byId(panel, "deal-notice").textContent, "Accord signé.");
    // The same offer cannot be signed again; the surplus fell by the amount.
    assert.equal(buttons(rows(panel, "deal-offers")[0])[0].disabled, true);
    assert.equal(norm(byId(panel, "deal-surplus").textContent), "Surplus disponible : électricité 600 unités, eau 0 unités.");
  });

  test("a refused signature shows the engine's reason", () => {
    const city = fakeCity({ rules: true });
    const { api, panel } = setupPage(city);
    ui.update(api);
    city.power = 0; // the surplus vanishes before the page re-reads
    const sign = buttons(rows(panel, "deal-offers")[0])[0];
    sign.onclick();
    assert.equal(byId(panel, "deal-notice").textContent, "Surplus insuffisant pour honorer cet accord.");
    assert.equal(byId(panel, "deal-notice").attributes.class, "deal-notice deal-bad");
  });

  test("Résilier cancels through the engine and says nothing about a break", () => {
    const city = fakeCity({ rules: true });
    const { api, panel } = setupPage(city);
    ui.update(api);
    buttons(rows(panel, "deal-offers")[0])[0].onclick();
    const [cancel] = buttons(rows(panel, "deal-active")[0]);
    assert.equal(norm(cancel.attributes.title), "Résilier coûte une pénalité de 250 $.");
    cancel.onclick();
    assert.deepEqual(city.calls.at(-1), ["cancel", 0]);
    assert.equal(rows(panel, "deal-active").length, 0);
    assert.equal(byId(panel, "deal-notice").textContent, "Accord résilié.");
  });

  test("a deal that vanishes by itself is announced as broken; a threatened one is flagged", () => {
    const city = fakeCity({ rules: true });
    const { api, panel } = setupPage(city);
    ui.update(api);
    buttons(rows(panel, "deal-offers")[0])[0].onclick();
    city.deals[0].covered = false;
    flush(api);
    const row = rows(panel, "deal-active")[0];
    assert.equal(row.attributes.class, "deal-row deal-threatened");
    assert.match(row.textContent, /Menacé/);
    city.deals = []; // the engine broke it at a collection
    flush(api);
    assert.equal(rows(panel, "deal-active").length, 0);
    assert.equal(byId(panel, "deal-notice").textContent, "Accord rompu : Valmont (nord) · Électricité. Une pénalité a été payée.");
  });

  test("after a load or a new city the panel follows the engine and never writes to it", () => {
    const city = fakeCity({ rules: true });
    const { api, panel, page } = setupPage(city);
    ui.update(api);
    buttons(rows(panel, "deal-offers")[0])[0].onclick();
    city.calls.length = 0;
    // Another city is loaded: the rule is off there, and no deal is called "broken".
    city.rules = false;
    city.deals = [];
    page.label = "Kyoto";
    ui.update(api);
    assert.equal(byId(panel, "deals-rules").checked, false);
    assert.equal(rows(panel, "deal-active").length, 0);
    assert.doesNotMatch(byId(panel, "deal-notice").textContent, /rompu/);
    assert.deepEqual(city.calls, [], "update() never writes");
    // Another city with the rule on and a deal already signed.
    city.rules = true;
    city.deals = [{ neighbour: 2, resource: 0, amount: 200, price: 6 }];
    page.label = "Tokyo";
    ui.update(api);
    assert.equal(byId(panel, "deals-rules").checked, true);
    assert.equal(rows(panel, "deal-active").length, 1);
    assert.doesNotMatch(byId(panel, "deal-notice").textContent, /rompu/);
    assert.deepEqual(city.calls, []);
  });

  test("a load that replaces the deals is not announced as a break", () => {
    const city = fakeCity({ rules: true });
    const { api, panel, page } = setupPage(city);
    ui.update(api);
    buttons(rows(panel, "deal-offers")[0])[0].onclick();
    byId(panel, "deal-notice").textContent = "";
    city.deals = [];
    page.label = "Autre ville";
    flush(api);
    assert.doesNotMatch(byId(panel, "deal-notice").textContent, /rompu/);
  });

  test("update() is cheap: the engine is scanned once in READ_EVERY calls and the DOM is not rewritten", () => {
    const city = fakeCity({ rules: true });
    const { api, panel } = setupPage(city);
    ui.update(api);
    const writes = () => panel.find(() => true).reduce((n, node) => n + node.sets + (node.replaced ?? 0), 0);
    const [before, reads] = [writes(), city.reads];
    for (let i = 0; i < 5 * ui.READ_EVERY; i++) ui.update(api);
    assert.equal(writes(), before);
    assert.ok(city.reads - reads <= 5, `${city.reads - reads} scans in ${5 * ui.READ_EVERY} updates`);
    city.power = 900;
    flush(api);
    assert.match(norm(byId(panel, "deal-surplus").textContent), /électricité 900 unités/);
  });
});
