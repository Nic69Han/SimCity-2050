// The 2D map layers (web/map-layers.js): the list is empty for now, and the painter draws the
// visible layers in order, asking for a full repaint of the tiles around them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MAP_LAYERS, createMapLayers } from "../map-layers.js";

function layer(name, on, log) {
  return {
    name,
    visible: (city) => on.value && city.ok !== false,
    draw: (ctx, city, scale) => log.push([name, ctx, city, scale]),
  };
}

describe("the page's layers", () => {
  test("the water and metro layers, in this order, each well formed; the list cannot be changed", () => {
    assert.deepEqual(MAP_LAYERS.map((l) => l.name), ["densities", "water", "transit", "structures", "vehicles"]);
    for (const l of MAP_LAYERS) {
      assert.equal(typeof l.visible, "function", l.name);
      assert.equal(typeof l.draw, "function", l.name);
    }
    assert.throws(() => MAP_LAYERS.push({}), TypeError);
  });

  test("while no layer is visible the tiles keep their dirty-rectangle repaint", () => {
    // the city of a plain game: no extended rule on, no network built
    const layers = createMapLayers();
    for (let i = 0; i < 3; i++) assert.deepEqual(layers.plan({}), { active: [], full: false });
  });
});

describe("the painter", () => {
  test("draws only the visible layers, in order, with the context, city and scale", () => {
    const log = [];
    const a = layer("a", { value: true }, log);
    const hidden = layer("hidden", { value: false }, log);
    const c = layer("c", { value: true }, log);
    const painter = createMapLayers([a, hidden, c]);
    const city = { id: 1 };
    const ctx = { id: "ctx" };
    const plan = painter.plan(city);
    assert.deepEqual(plan.active.map((l) => l.name), ["a", "c"]);
    assert.equal(plan.full, true, "a layer draws over the tiles, which start clean");
    painter.draw(ctx, city, 8, plan.active);
    assert.deepEqual(log, [["a", ctx, city, 8], ["c", ctx, city, 8]]);
  });

  test("one more full repaint erases the last layer, then the dirty-rectangle path returns", () => {
    const on = { value: true };
    const painter = createMapLayers([layer("a", on, [])]);
    assert.equal(painter.plan({}).full, true);
    assert.equal(painter.plan({}).full, true);
    on.value = false;
    assert.deepEqual(painter.plan({}), { active: [], full: true });
    assert.deepEqual(painter.plan({}), { active: [], full: false });
    on.value = true;
    assert.equal(painter.plan({}).full, true);
  });

  test("visibility is asked of the city given to plan", () => {
    const painter = createMapLayers([layer("a", { value: true }, [])]);
    assert.equal(painter.plan({ ok: false }).active.length, 0);
    assert.equal(painter.plan({ ok: true }).active.length, 1);
  });
});
