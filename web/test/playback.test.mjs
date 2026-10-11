// The play loop: one animation-frame loop at most, cancelled on pause; ticks per frame by speed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createPlayback, ticksPerFrame, TICKS_PER_FRAME } from "../playback.js";

// A fake animation-frame queue: request() queues a callback under an id, cancel() removes it,
// run() runs every queued callback once (as one display frame does).
function fakeFrames() {
  const queue = new Map();
  let next = 1;
  return {
    queue,
    request(cb) {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    cancel(id) {
      queue.delete(id);
    },
    run() {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb();
    },
  };
}

describe("ticks per frame", () => {
  test("speed 1, 2, 3 run 1, 4 and 16 ticks (the slider's values)", () => {
    assert.deepEqual(TICKS_PER_FRAME, { 1: 1, 2: 4, 3: 16 });
    assert.equal(ticksPerFrame(1), 1);
    assert.equal(ticksPerFrame(2), 4);
    assert.equal(ticksPerFrame(3), 16);
  });
  test("any other speed runs one tick, never zero or a crash", () => {
    for (const s of [0, 4, -1, NaN, undefined]) assert.equal(ticksPerFrame(s), 1, String(s));
  });
});

describe("playback loop", () => {
  test("nothing runs until play is set", () => {
    const f = fakeFrames();
    let ticks = 0;
    createPlayback({ tick: () => ticks++, request: f.request, cancel: f.cancel });
    f.run();
    assert.equal(ticks, 0);
    assert.equal(f.queue.size, 0);
  });

  test("play runs one tick per frame until pause", () => {
    const f = fakeFrames();
    let ticks = 0;
    const p = createPlayback({ tick: () => ticks++, request: f.request, cancel: f.cancel });
    p.set(true);
    assert.equal(p.playing, true);
    f.run();
    f.run();
    assert.equal(ticks, 2);
    p.set(false);
    assert.equal(p.playing, false);
    f.run();
    assert.equal(ticks, 2, "no tick after pause");
    assert.equal(f.queue.size, 0, "the pending frame was cancelled");
  });

  test("Lecture, Pause, Lecture within one frame leaves one loop (not two: no double speed)", () => {
    const f = fakeFrames();
    let ticks = 0;
    const p = createPlayback({ tick: () => ticks++, request: f.request, cancel: f.cancel });
    p.set(true);
    p.set(false);
    p.set(true);
    assert.equal(f.queue.size, 1, "one frame pending");
    f.run();
    assert.equal(ticks, 1, "one tick for one frame");
    assert.equal(f.queue.size, 1, "the loop continues as one");
  });

  test("setting play twice does not add a second loop", () => {
    const f = fakeFrames();
    let ticks = 0;
    const p = createPlayback({ tick: () => ticks++, request: f.request, cancel: f.cancel });
    p.set(true);
    p.set(true);
    p.set(true);
    assert.equal(f.queue.size, 1);
    f.run();
    assert.equal(ticks, 1);
  });

  test("many toggles keep the loop count at one, and pausing stops everything", () => {
    const f = fakeFrames();
    let ticks = 0;
    const p = createPlayback({ tick: () => ticks++, request: f.request, cancel: f.cancel });
    for (let i = 0; i < 25; i++) {
      p.set(i % 2 === 0);
      assert.ok(f.queue.size <= 1, `at most one frame pending after toggle ${i}`);
    }
    p.set(true);
    f.run();
    p.set(false);
    f.run();
    assert.equal(f.queue.size, 0);
  });

  test("a tick that pauses the loop does not leave a frame behind", () => {
    const f = fakeFrames();
    let p;
    p = createPlayback({ tick: () => p.set(false), request: f.request, cancel: f.cancel });
    p.set(true);
    f.run();
    assert.equal(p.playing, false);
    assert.equal(f.queue.size, 0);
  });

  test("the default frame functions are looked up when the loop starts (wrappable)", () => {
    const saved = globalThis.requestAnimationFrame;
    const saved2 = globalThis.cancelAnimationFrame;
    const seen = [];
    globalThis.requestAnimationFrame = (cb) => {
      seen.push("request");
      return saved ? 7 : 7;
    };
    globalThis.cancelAnimationFrame = (id) => seen.push(`cancel ${id}`);
    try {
      const p = createPlayback({ tick() {} });
      p.set(true);
      p.set(false);
      assert.deepEqual(seen, ["request", "cancel 7"]);
    } finally {
      globalThis.requestAnimationFrame = saved;
      globalThis.cancelAnimationFrame = saved2;
    }
  });
});
