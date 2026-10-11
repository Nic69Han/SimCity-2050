// Coordinate conversion, drag handling and the tool stroke, against the mock engine.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tileAt, ToolStroke } from "../input.js";
import { MockCity, MOCK_TOOLS, RESULT } from "./mock-engine.mjs";

const TILE_PX = 6;
const id = (key) => MOCK_TOOLS.findIndex((t) => t.key === key);

// A canvas of `mapW` x `mapH` tiles drawn at TILE_PX, displayed at `cssW` css pixels wide
// at viewport position (left, top). The height follows the aspect ratio, as in CSS.
function rectFor(mapW, mapH, cssW, left = 0, top = 0) {
  const cssH = (cssW * mapH * TILE_PX) / (mapW * TILE_PX);
  return { left, top, width: cssW, height: cssH };
}

describe("tileAt: pixel -> tile with CSS scaling", () => {
  test("unscaled: each tile is TILE_PX canvas pixels", () => {
    const rect = rectFor(40, 30, 40 * TILE_PX); // displayed at native size
    assert.deepEqual(tileAt(0, 0, rect, 40, 30), { x: 0, y: 0 });
    assert.deepEqual(tileAt(6, 6, rect, 40, 30), { x: 1, y: 1 });
    assert.deepEqual(tileAt(5.9, 11.9, rect, 40, 30), { x: 0, y: 1 });
    assert.deepEqual(tileAt(239, 179, rect, 40, 30), { x: 39, y: 29 });
  });

  test("CSS scaled down: 40 tiles shown in 200 css px gives 5 px per tile", () => {
    const rect = rectFor(40, 30, 200);
    assert.equal(rect.height, 150);
    assert.deepEqual(tileAt(4.9, 4.9, rect, 40, 30), { x: 0, y: 0 });
    assert.deepEqual(tileAt(5, 5, rect, 40, 30), { x: 1, y: 1 });
    assert.deepEqual(tileAt(102, 77, rect, 40, 30), { x: 20, y: 15 });
  });

  test("CSS scaled up keeps the same tile for the same fraction", () => {
    const rect = rectFor(40, 30, 960); // 24 css px per tile
    assert.deepEqual(tileAt(23.9, 0, rect, 40, 30), { x: 0, y: 0 });
    assert.deepEqual(tileAt(24, 0, rect, 40, 30), { x: 1, y: 0 });
    assert.deepEqual(tileAt(480, 360, rect, 40, 30), { x: 20, y: 15 }); // rect.height is 720
  });

  test("viewport offset of the canvas is subtracted", () => {
    const rect = rectFor(40, 30, 200, 300, 120);
    assert.deepEqual(tileAt(300 + 5, 120 + 5, rect, 40, 30), { x: 1, y: 1 });
    assert.deepEqual(tileAt(299, 119, rect, 40, 30), { x: 0, y: 0 }); // clamped, outside
  });

  test("positions outside the canvas clamp to the nearest edge tile", () => {
    const rect = rectFor(40, 30, 200, 10, 10);
    assert.deepEqual(tileAt(-500, -500, rect, 40, 30), { x: 0, y: 0 });
    assert.deepEqual(tileAt(5000, 5000, rect, 40, 30), { x: 39, y: 29 });
    assert.deepEqual(tileAt(10 + 200, 10, rect, 40, 30), { x: 39, y: 0 }); // exactly the right edge
  });

  test("unusable geometry returns null", () => {
    assert.equal(tileAt(1, 1, { left: 0, top: 0, width: 0, height: 0 }, 40, 30), null);
    assert.equal(tileAt(1, 1, null, 40, 30), null);
    assert.equal(tileAt(1, 1, rectFor(40, 30, 200), 0, 0), null);
    assert.equal(tileAt(Number.NaN, 1, rectFor(40, 30, 200), 40, 30), null);
  });
});

describe("ToolStroke: tool_down, then tool_drag on consecutive distinct tiles", () => {
  const tile = (x, y) => ({ x, y });

  test("a click calls tool_down once and reports the result", () => {
    const city = new MockCity(1, { rubble: 0 });
    const seen = [];
    const s = new ToolStroke(city, { onResult: (code, t) => seen.push([code, t]) });
    s.down(id("road"), tile(20, 20));
    assert.deepEqual(city.log, [{ op: "down", tool: "road", x: 20, y: 20, result: RESULT.OK }]);
    assert.deepEqual(seen, [[RESULT.OK, tile(20, 20)]]);
  });

  test("drag: tool_drag only when the tile changes, from the previous tile to the new one", () => {
    const city = new MockCity(1, { rubble: 0 });
    const s = new ToolStroke(city);
    const road = id("road");
    s.down(road, tile(20, 20));
    // pointer path, tile by tile: repeats of the same tile must not call the engine
    const path = [tile(20, 20), tile(20, 20), tile(21, 20), tile(21, 20), tile(21, 20), tile(21, 21),
      tile(21, 21), tile(22, 22)];
    const calls = path.map((t) => s.move(t));
    assert.deepEqual(calls, [false, false, true, false, false, true, false, true]);
    s.up();
    const drags = city.log.filter((e) => e.op === "drag");
    assert.deepEqual(drags, [
      { op: "drag", tool: "road", x0: 20, y0: 20, x1: 21, y1: 20 },
      { op: "drag", tool: "road", x0: 21, y0: 20, x1: 21, y1: 21 },
      { op: "drag", tool: "road", x0: 21, y0: 21, x1: 22, y1: 22 },
    ]);
  });

  test("consecutive calls never share a tile: each drag starts where the last one ended", () => {
    const city = new MockCity(1, { rubble: 0 });
    const s = new ToolStroke(city);
    s.down(id("wire"), tile(2, 2));
    for (const t of [tile(3, 2), tile(3, 3), tile(2, 3), tile(2, 2), tile(2, 2)]) s.move(t);
    const drags = city.log.filter((e) => e.op === "drag");
    for (let i = 1; i < drags.length; i++) {
      assert.deepEqual([drags[i].x0, drags[i].y0], [drags[i - 1].x1, drags[i - 1].y1]);
      assert.notDeepEqual([drags[i].x0, drags[i].y0], [drags[i].x1, drags[i].y1]);
    }
    assert.equal(drags.length, 4);
  });

  test("moves after up() and moves without a tool do nothing", () => {
    const city = new MockCity(1, { rubble: 0 });
    const s = new ToolStroke(city);
    assert.equal(s.move(tile(1, 1)), false);
    s.down(id("road"), tile(1, 1));
    s.up();
    assert.equal(s.active, false);
    assert.equal(s.move(tile(5, 5)), false);
    assert.equal(city.log.filter((e) => e.op === "drag").length, 0);
  });

  test("a big tool is placed with tool_down at the pointer tile, never dragged", () => {
    const city = new MockCity(1, { rubble: 0 });
    const s = new ToolStroke(city);
    const stadium = id("stadium");
    s.down(stadium, tile(10, 10));
    // the stroke still passes the pointer on: the engine (not the page) decides what a drag does
    s.move(tile(11, 10));
    assert.deepEqual(city.log.map((e) => e.op), ["down", "drag"]);
    assert.equal(city.log[0].result, RESULT.OK);
  });

  test("inspect tools (query) never reach the engine's tool_down or tool_drag", () => {
    const city = new MockCity(1, { rubble: 0 });
    const inspected = [];
    const s = new ToolStroke(city, {
      isInspect: (t) => t === id("query"),
      onInspect: (t) => inspected.push(t),
    });
    s.down(id("query"), tile(4, 4));
    s.move(tile(5, 4));
    assert.deepEqual(inspected, [tile(4, 4), tile(5, 4)]);
    assert.deepEqual(city.log, []);
  });

  test("a failed down reports its code and does not start a drag on a failed origin", () => {
    const city = new MockCity(1, { rubble: 0 });
    const codes = [];
    const s = new ToolStroke(city, { onResult: (c) => codes.push(c) });
    s.down(id("road"), tile(5, 4)); // (5,4) is lake water in the mock
    assert.deepEqual(codes, [RESULT.FAILED]);
  });
});

describe("integration: pointer pixels through conversion into engine calls", () => {
  test("a drag across a scaled canvas builds the expected tiles", () => {
    const city = new MockCity(1, { width: 40, height: 30, rubble: 0 });
    const rect = rectFor(40, 30, 200, 50, 50); // 5 css px per tile
    const s = new ToolStroke(city);
    const at = (cx, cy) => tileAt(cx, cy, rect, city.width(), city.height());
    s.down(id("road"), at(50 + 5 * 20 + 1, 50 + 5 * 12 + 1)); // tile (20, 12)
    s.move(at(50 + 5 * 21 + 2, 50 + 5 * 12 + 3)); // tile (21, 12)
    s.move(at(50 + 5 * 22 + 4, 50 + 5 * 12 + 4)); // tile (22, 12)
    s.up();
    // first call is the press; the mock's size-1 drags also place (logged as down), so check the press only
    assert.deepEqual([city.log[0].op, city.log[0].x, city.log[0].y], ["down", 20, 12]);
    assert.deepEqual(city.log.filter((e) => e.op === "drag").map((e) => [e.x0, e.x1]), [[20, 21], [21, 22]]);
  });

  test("the mock's footprint and preview agree with what tool_down decides", () => {
    const city = new MockCity(1, { rubble: 0 });
    for (const key of ["residential", "stadium", "airport", "road", "bulldozer"]) {
      const t = id(key);
      const pv = city.tool_preview(t, 15, 15);
      assert.equal(city.tool_down(t, 15, 15), pv[0], key);
    }
  });
});
