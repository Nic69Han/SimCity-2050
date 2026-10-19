// The «Bâtiments étendus» panel (web/structures-ui.js): pure texts, and the panel with a fake DOM.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../structures-ui.js";
import { MockCity } from "./mock-engine.mjs";

class Node {
  constructor(tag) { this.tagName = tag; this.attributes = {}; this.children = []; this.hidden = false; this.textContent = ""; this.checked = false; }
  setAttribute(k, v) { this.attributes[k] = v; if (k === "id") this.id = v; }
  append(...n) { this.children.push(...n); }
  replaceChildren(...n) { this.children = n; }
  find(pred) { return [this, ...this.children.flatMap((c) => (c instanceof Node ? c.find(pred) : []))].filter(pred); }
}

function page(city) {
  globalThis.document = { createElement: (t) => new Node(t) };
  const panel = new Node("section");
  let redraws = 0;
  const api = { city: () => city, $: (id) => (id === "structures-panel" ? panel : null), redraw: () => { redraws++; }, isReady: () => true };
  ui.setup(api);
  return { api, panel, redraws: () => redraws };
}
const byId = (panel, id) => panel.find((n) => n.id === id)[0];

describe("texts", () => {
  test("off, none, one, many", () => {
    assert.match(ui.summaryText(false, 3, 10), /^Désactivés/);
    assert.equal(ui.summaryText(true, 0, 0), "Activés : aucun bâtiment, entretien 0 $ par mois.");
    assert.equal(ui.summaryText(true, 1, 25), "Activés : 1 bâtiment, entretien 25 $ par mois.");
    assert.match(ui.summaryText(true, 2, 1500), /^Activés : 2 bâtiments, entretien 1\s500 \$ par mois\.$/);
  });
  test("odd input never throws", () => {
    assert.match(ui.summaryText(true, NaN, undefined), /aucun bâtiment, entretien 0 \$/);
  });
});

describe("panel", () => {
  test("hidden without the API", () => {
    const { api, panel } = page({});
    ui.update(api);
    assert.equal(panel.hidden, true);
  });
  test("the switch drives the engine and the text follows it", () => {
    const city = new MockCity(1, { structures: true });
    const { api, panel, redraws } = page(city);
    ui.update(api);
    assert.equal(panel.hidden, false);
    const box = byId(panel, "structures-rules");
    assert.equal(box.checked, false);
    box.checked = true;
    box.onchange();
    assert.equal(city.structure_rules(), true);
    assert.equal(redraws(), 1);
    ui.update(api);
    assert.match(byId(panel, "structures-state").textContent, /^Activés : aucun bâtiment/);
  });
});
