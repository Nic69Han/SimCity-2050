// The tool result hook of tools.js (onToolResult): {kind, result, cost?} after every tool call of the
// page, listeners independent, tool behaviour unchanged. Driven through the same adapter setupTools uses.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ToolStroke } from "../input.js";
import { RESULT, callsFor, readCatalog, onToolResult, strokeEngineOf } from "../tools.js";
import { MockCity } from "./mock-engine.mjs";

function setup(opts = {}) {
  const city = new MockCity(1, { rubble: 0, ...opts });
  const catalog = readCatalog(city);
  const calls = new Map(catalog.map((t) => [t.id, callsFor(city, t)]));
  const id = (key) => catalog.find((t) => t.key === key).id;
  return { city, id, engine: strokeEngineOf(calls), stroke: new ToolStroke(strokeEngineOf(calls)) };
}
const record = () => {
  const events = [];
  const off = onToolResult((e) => events.push(e));
  return { events, off };
};

describe("onToolResult", () => {
  test("a click reports kind down, the result code and the preview cost", () => {
    const { city, id, stroke } = setup();
    const price = city.tool_preview(id("road"), 20, 20)[1];
    const r = record();
    try {
      assert.equal(stroke.down(id("road"), { x: 20, y: 20 }), RESULT.OK);
      assert.deepEqual(r.events, [{ kind: "down", result: RESULT.OK, cost: price }]);
    } finally {
      r.off();
    }
  });

  test("refusals are reported with their code", () => {
    const { id, engine } = setup({ funds: 1 });
    const r = record();
    try {
      engine.tool_down(id("road"), 20, 20);
      engine.tool_down(id("road"), 5, 5); // a lake tile: refused before the price is looked at
      assert.deepEqual(r.events.map((e) => e.result), [RESULT.NO_MONEY, RESULT.FAILED]);
    } finally {
      r.off();
    }
    const rich = setup();
    const q = record();
    try {
      rich.engine.tool_down(rich.id("road"), 5, 5);
      assert.deepEqual(q.events.map((e) => e.result), [RESULT.FAILED]);
    } finally {
      q.off();
    }
  });

  test("a drag reports kind drag; the result is a code when the call gives one, else null", () => {
    const { id, engine, city } = setup();
    const r = record();
    try {
      engine.tool_drag(id("road"), 20, 20, 22, 20);
      assert.equal(r.events.length, 1);
      assert.equal(r.events[0].kind, "drag");
      assert.ok(r.events[0].result === null || typeof r.events[0].result === "number");
      assert.equal("cost" in r.events[0], false);
      assert.ok(city.log.length > 0, "the engine was called");
    } finally {
      r.off();
    }
    const extra = strokeEngineOf(new Map([[1, { preview: () => [1, 0], down: () => 1, drag: () => 1 }]]));
    const q = record();
    try {
      extra.tool_drag(1, 0, 0, 1, 0);
      assert.deepEqual(q.events, [{ kind: "drag", result: 1 }]);
    } finally {
      q.off();
    }
  });

  test("extra tools (calls of an extra module) report too, without a usable preview no cost", () => {
    const e = strokeEngineOf(new Map([[9, { preview: () => null, down: () => RESULT.OK, drag: () => RESULT.OK }]]));
    const r = record();
    try {
      e.tool_down(9, 1, 1);
      assert.deepEqual(r.events, [{ kind: "down", result: RESULT.OK }]);
    } finally {
      r.off();
    }
  });

  test("unsubscribe stops one listener only; the tool still works with no listener", () => {
    const { id, engine, city } = setup();
    const a = record();
    const b = record();
    a.off();
    engine.tool_down(id("road"), 20, 20);
    assert.equal(a.events.length, 0);
    assert.equal(b.events.length, 1);
    b.off();
    const before = city.log.length;
    assert.equal(engine.tool_down(id("road"), 21, 20), RESULT.OK);
    assert.equal(city.log.length, before + 1);
  });

  test("tool behaviour is unchanged: same engine calls and results with and without a listener", () => {
    const run = (listen) => {
      const { id, engine, city } = setup();
      const r = listen ? record() : null;
      const out = [engine.tool_down(id("road"), 20, 20), engine.tool_down(id("residential"), 25, 20)];
      engine.tool_drag(id("road"), 20, 22, 24, 22);
      r?.off();
      return { out, log: JSON.stringify(city.log), funds: city.funds() };
    };
    assert.deepEqual(run(true), run(false));
  });

  test("a listener that throws is reported and does not stop the others or the tool", () => {
    const { id, engine } = setup();
    const errors = [];
    const original = console.error;
    console.error = (...a) => errors.push(a);
    const bad = onToolResult(() => {
      throw new Error("boom");
    });
    const good = record();
    try {
      assert.equal(engine.tool_down(id("road"), 20, 20), RESULT.OK);
      assert.equal(good.events.length, 1);
      assert.equal(errors.length, 1);
    } finally {
      console.error = original;
      bad();
      good.off();
    }
  });
});
