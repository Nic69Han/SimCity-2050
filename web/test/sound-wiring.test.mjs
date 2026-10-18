// Wiring of the tool sounds: tools.js reports each tool result (onToolResult), sound-model.js turns it
// into a sound, the rate limit still applies. Pure chain, no browser (the Web Audio part is in e2e/sound).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ToolStroke } from "../input.js";
import { callsFor, readCatalog, onToolResult, strokeEngineOf } from "../tools.js";
import { soundForToolResult, createLimiter, MAX_PLAYS_PER_SECOND } from "../sound-model.js";
import { MockCity } from "./mock-engine.mjs";

function setup(opts) {
  const city = new MockCity(1, opts);
  const catalog = readCatalog(city);
  const calls = new Map(catalog.map((t) => [t.id, callsFor(city, t)]));
  const id = (key) => catalog.find((t) => t.key === key).id;
  const stroke = new ToolStroke(strokeEngineOf(calls));
  return { city, id, stroke };
}

// What sound.js does: every result -> a sound key, filtered by the limiter.
function played(now = () => 0) {
  const keys = [];
  const limiter = createLimiter();
  const off = onToolResult((e) => {
    const s = soundForToolResult(e);
    if (s && limiter.allow(now())) keys.push(s.key);
  });
  return { keys, off };
}

describe("tool results reach the sounds", () => {
  test("a built road plays build; no money and a blocked tile play their refusals", () => {
    const { id, stroke } = setup({ funds: 5, rubble: 0 });
    const p = played();
    try {
      stroke.down(id("road"), { x: 20, y: 20 }); // road costs more than 5 $ -> no money
      assert.deepEqual(p.keys, ["noMoney"]);
      stroke.up();
    } finally {
      p.off();
    }
    const rich = setup({ funds: 100000, rubble: 0 });
    const q = played();
    try {
      rich.stroke.down(rich.id("road"), { x: 20, y: 20 });
      rich.stroke.up();
      rich.stroke.down(rich.id("road"), { x: 5, y: 5 }); // lake
      assert.deepEqual(q.keys, ["build", "refused"]);
    } finally {
      q.off();
    }
  });

  test("the rate limit is kept: a burst of builds plays at most MAX_PLAYS_PER_SECOND", () => {
    const { id, stroke } = setup({ funds: 1e9, rubble: 0 });
    const p = played();
    try {
      for (let i = 0; i < 20; i++) {
        stroke.down(id("road"), { x: 12 + i, y: 20 });
        stroke.up();
      }
      assert.equal(p.keys.length, MAX_PLAYS_PER_SECOND);
    } finally {
      p.off();
    }
  });

  test("after unsubscribing nothing plays", () => {
    const { id, stroke } = setup({ funds: 100000, rubble: 0 });
    const p = played();
    p.off();
    stroke.down(id("road"), { x: 20, y: 20 });
    assert.deepEqual(p.keys, []);
  });
});
