// The pointer seam shared by the flat map and the 3D view (web/input.js attachPointer): a view
// may give the tile of an event itself (tileOf), and its listeners go when the signal is aborted.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { attachPointer } from "../input.js";

// A canvas stand-in: an EventTarget with the two methods attachPointer calls.
class FakeCanvas extends EventTarget {
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100 };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

const fire = (canvas, type, x = 1, y = 1) =>
  canvas.dispatchEvent(Object.assign(new Event(type), { button: 0, clientX: x, clientY: y, pointerId: 1 }));

describe("attachPointer with a view's own tile picking", () => {
  test("the tile comes from handlers.tileOf, not from the map geometry", () => {
    const canvas = new FakeCanvas();
    const downs = [];
    attachPointer(canvas, {
      mapSize: () => { throw new Error("the map size is not needed with tileOf"); },
      tileOf: (ev) => ({ x: ev.clientX + 10, y: ev.clientY + 20 }),
      onDown: (tile) => downs.push(tile),
      onMove() {},
      onUp() {},
      onLeave() {},
    });
    fire(canvas, "pointerdown", 2, 3);
    assert.deepEqual(downs, [{ x: 12, y: 23 }]);
  });

  test("a null tile from the view is ignored", () => {
    const canvas = new FakeCanvas();
    const downs = [];
    attachPointer(canvas, {
      mapSize: () => ({ w: 1, h: 1 }),
      tileOf: () => null,
      onDown: (tile) => downs.push(tile),
      onMove() {},
      onUp() {},
      onLeave() {},
    });
    fire(canvas, "pointerdown");
    assert.deepEqual(downs, []);
  });

  test("aborting the signal removes every listener", () => {
    const canvas = new FakeCanvas();
    const calls = [];
    const controller = new AbortController();
    attachPointer(canvas, {
      mapSize: () => ({ w: 10, h: 10 }),
      tileOf: () => ({ x: 0, y: 0 }),
      onDown: () => calls.push("down"),
      onMove: () => calls.push("move"),
      onUp: () => calls.push("up"),
      onLeave: () => calls.push("leave"),
    }, { signal: controller.signal });
    fire(canvas, "pointermove");
    controller.abort();
    fire(canvas, "pointerdown");
    fire(canvas, "pointermove");
    fire(canvas, "pointerup");
    fire(canvas, "pointerleave");
    assert.deepEqual(calls, ["move"]);
  });
});
