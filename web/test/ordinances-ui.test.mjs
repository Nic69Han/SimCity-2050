// Tests of the ordinances panel (web/ordinances-ui.js) with a small fake document and a fake
// engine that follows the contract of the wasm adapter (crates/micropolis-wasm/src/ordinances.rs).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../ordinances-ui.js";

const KEYS = ["community_policing", "pollution_control", "recycling", "tourism", "industry_incentives",
  "beautification", "curfew", "city_promotion"];
const EFFECTS = [
  [0, -15, 0, 0, 0, 0, 0], [0, 0, -15, 0, 0, 0, 0], [0, 0, -8, 0, 0, 0, 0], [0, 0, 0, 0, 0, 8, 0],
  [0, 0, 0, 0, 0, 0, 8], [0, 0, 0, 10, 0, 0, 0], [0, -8, 0, 0, -3, 0, 0], [0, 0, 0, 0, 8, 0, 0],
];
const BASE = [200, 300, 150, 150, 200, 250, 100, 200];
const PER_1000 = [30, 40, 25, 20, 25, 35, 15, 30];

/** A fake City: an active set and a population; costs follow the engine's formula. */
function fakeCity({ population = 10000 } = {}) {
  const city = {
    mask: 0,
    population,
    calls: [],
    ordinance_count: () => KEYS.length,
    ordinance_key: (i) => KEYS[i] ?? "",
    ordinance_info(i) {
      if (i < 0 || i >= KEYS.length) return new Int32Array();
      const info = Int32Array.from(EFFECTS[i]);
      info[0] = BASE[i] + PER_1000[i] * Math.floor(city.population / 1000);
      return info;
    },
    ordinance_active: (i) => i >= 0 && i < KEYS.length && (city.mask & (1 << i)) !== 0,
    set_ordinance(i, on) {
      city.calls.push([i, on]);
      if (i < 0 || i >= KEYS.length) return false;
      city.mask = on ? city.mask | (1 << i) : city.mask & ~(1 << i);
      return true;
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
    this.sets = 0; // how many times textContent was written
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
  const api = {
    city: () => city,
    $: (id) => (id === "ordinances-panel" ? panel : null),
    redraw: () => ui.update(api),
    isReady: () => ready,
  };
  ui.setup(api);
  return { api, panel };
}

const boxes = (panel) => panel.find((n) => n.tagName === "input");
const total = (panel) => panel.find((n) => n.attributes.id === "ord-total")[0].textContent;
const norm = (s) => s.replace(/[  ]/g, " ");

describe("ordinances panel", () => {
  test("hidden until the engine answers, and hidden when the engine lacks the API", () => {
    const { api, panel } = setupPage({});
    assert.equal(panel.hidden, true);
    ui.update(api);
    assert.equal(panel.hidden, true);
    assert.equal(panel.children.length, 0);
    const half = fakeCity();
    delete half.set_ordinance;
    const page = setupPage(half);
    ui.update(page.api);
    assert.equal(page.panel.hidden, true);
  });

  test("nothing is shown before the engine is ready", () => {
    const { api, panel } = setupPage(fakeCity(), { ready: false });
    ui.update(api);
    assert.equal(panel.hidden, true);
  });

  test("shows the heading, one checkbox per ordinance with name, cost and effect, and the total", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    assert.equal(panel.hidden, false);
    assert.equal(panel.find((n) => n.tagName === "h2")[0].textContent, "Ordonnances");
    assert.equal(boxes(panel).length, 8);
    const rows = panel.find((n) => n.tagName === "li");
    assert.equal(rows.length, 8);
    const first = norm(rows[0].textContent);
    assert.match(first, /Police de proximité/);
    assert.match(first, /500 \$ par an/); // 200 + 30 * 10
    assert.match(first, /Criminalité −15 %/);
    assert.equal(norm(total(panel)), "Aucune ordonnance en vigueur.");
    assert.ok(boxes(panel).every((b) => b.checked === false));
    assert.deepEqual(city.calls, [], "reading never writes");
  });

  test("a click asks the engine and the panel shows the engine's answer and the new total", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    const [first, , , , , , curfew] = boxes(panel);
    first.checked = true;
    first.onchange();
    curfew.checked = true;
    curfew.onchange();
    assert.deepEqual(city.calls, [[0, true], [6, true]]);
    assert.equal(city.mask, 0b100_0001);
    assert.equal(norm(total(panel)), "Coût total : 750 $ par an (2 en vigueur)."); // 500 + 250
    first.checked = false;
    first.onchange();
    assert.equal(city.mask, 0b100_0000);
    assert.equal(norm(total(panel)), "Coût total : 250 $ par an (1 en vigueur).");
  });

  test("a refused change unticks the box again", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    city.set_ordinance = () => false;
    const [box] = boxes(panel);
    box.checked = true;
    box.onchange();
    assert.equal(box.checked, false);
  });

  test("after a new city or a load the panel follows the engine and never writes to it", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    boxes(panel)[2].checked = true;
    boxes(panel)[2].onchange();
    assert.equal(boxes(panel)[2].checked, true);
    // A load replaces the state: another set is active, a bigger population.
    city.calls.length = 0;
    city.mask = 0b1000;
    city.population = 50000;
    ui.update(api);
    assert.deepEqual(boxes(panel).map((b) => b.checked), [false, false, false, true, false, false, false, false]);
    assert.match(norm(total(panel)), /Coût total : 1 150 \$ par an \(1 en vigueur\)\./); // 150 + 20 * 50
    // A new city with nothing active: the page does not re-apply the earlier choice.
    city.mask = 0;
    ui.update(api);
    assert.ok(boxes(panel).every((b) => !b.checked));
    assert.deepEqual(city.calls, [], "update() never calls set_ordinance");
    assert.equal(city.mask, 0);
  });

  test("update() is cheap: no DOM write while the engine's numbers do not change", () => {
    const city = fakeCity();
    const { api, panel } = setupPage(city);
    ui.update(api);
    const writes = () => panel.find(() => true).reduce((n, node) => n + node.sets + (node.replaced ?? 0), 0);
    const before = writes();
    for (let i = 0; i < 50; i++) ui.update(api);
    assert.equal(writes(), before);
    city.population = 20000; // costs change: the texts are rewritten, the rows are kept
    const rowsBefore = panel.find((n) => n.tagName === "li");
    ui.update(api);
    assert.ok(writes() > before);
    assert.deepEqual(panel.find((n) => n.tagName === "li"), rowsBefore);
  });
});
