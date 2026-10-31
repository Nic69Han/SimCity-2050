// Tests for the adaptive render resolution (web/view3d-perf-model.js): sample filter, bounded window,
// mean, clamping, step rules, hysteresis (interval and window reset).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as m from "../view3d-perf-model.js";

const SLOW = m.FRAME_BUDGET_MS + 50;
const FAST = m.FRAME_BUDGET_MS * m.RECOVER_FRACTION - 20;
const MID = (m.FRAME_BUDGET_MS + m.FRAME_BUDGET_MS * m.RECOVER_FRACTION) / 2;

// Feeds `count` identical frames, one every 100 ms from t0; returns the final state.
function feed(state, frameMs, count, t0 = 0, dpr = 2) {
  let s = state;
  for (let i = 0; i < count; i++) s = m.decide(s, frameMs, t0 + i * 100, dpr);
  return s;
}

describe("constants", () => {
  test("the thresholds are ordered and the ratios make sense", () => {
    assert.ok(m.FRAME_WINDOW >= m.ADAPT_MIN_FRAMES);
    assert.ok(m.RECOVER_FRACTION > 0 && m.RECOVER_FRACTION < 1);
    assert.ok(m.PIXEL_RATIO_MIN > 0 && m.PIXEL_RATIO_MIN < m.PIXEL_RATIO_MAX);
    assert.ok(m.PIXEL_RATIO_STEP > 0 && m.PIXEL_RATIO_STEP <= m.PIXEL_RATIO_MAX - m.PIXEL_RATIO_MIN);
    assert.ok(m.MAX_SAMPLE_MS > m.FRAME_BUDGET_MS);
    // the normal loop gap (15 frames a second) must not look like a slow frame
    assert.ok(1000 / 15 < m.FRAME_BUDGET_MS * m.RECOVER_FRACTION);
  });
});

describe("sampleOf", () => {
  test("keeps finite positive gaps up to MAX_SAMPLE_MS", () => {
    assert.equal(m.sampleOf(67), 67);
    assert.equal(m.sampleOf(m.MAX_SAMPLE_MS), m.MAX_SAMPLE_MS);
  });
  test("drops pauses, zero, negative and non-numbers", () => {
    assert.equal(m.sampleOf(m.MAX_SAMPLE_MS + 1), null);
    assert.equal(m.sampleOf(0), null);
    assert.equal(m.sampleOf(-5), null);
    assert.equal(m.sampleOf(NaN), null);
    assert.equal(m.sampleOf(Infinity), null);
    assert.equal(m.sampleOf(undefined), null);
  });
});

describe("pushSample and mean", () => {
  test("appends in order", () => {
    assert.deepEqual(m.pushSample([1, 2], 3), [1, 2, 3]);
  });
  test("the window never holds more than FRAME_WINDOW frames, the oldest go", () => {
    let frames = [];
    for (let i = 0; i < m.FRAME_WINDOW * 3; i++) frames = m.pushSample(frames, i);
    assert.equal(frames.length, m.FRAME_WINDOW);
    assert.equal(frames[0], m.FRAME_WINDOW * 3 - m.FRAME_WINDOW);
    assert.equal(frames.at(-1), m.FRAME_WINDOW * 3 - 1);
  });
  test("mean is null with no frame, the average otherwise", () => {
    assert.equal(m.mean([]), null);
    assert.equal(m.mean([10, 20, 30]), 20);
    assert.equal(m.mean([7]), 7);
  });
});

describe("clampRatio", () => {
  test("keeps a ratio inside the device limit", () => {
    assert.equal(m.clampRatio(1.5, 2), 1.5);
    assert.equal(m.clampRatio(3, 2), 2);
    assert.equal(m.clampRatio(3, 1.25), 1.25);
  });
  test("never goes under PIXEL_RATIO_MIN", () => {
    assert.equal(m.clampRatio(0.1, 2), m.PIXEL_RATIO_MIN);
  });
  test("a device ratio that is not a positive number counts as 1", () => {
    assert.equal(m.clampRatio(2, 0), 1);
    assert.equal(m.clampRatio(2, NaN), 1);
    assert.equal(m.clampRatio(2, undefined), 1);
  });
  test("the minimum wins over a device ratio lower than it", () => {
    assert.equal(m.clampRatio(1, 0.25), m.PIXEL_RATIO_MIN);
  });
});

describe("targetRatio", () => {
  test("steps down when the mean is over the budget", () => {
    assert.equal(m.targetRatio(1.5, SLOW, 2), 1.5 - m.PIXEL_RATIO_STEP);
  });
  test("steps up when the mean is under the recover threshold", () => {
    assert.equal(m.targetRatio(1, FAST, 2), 1 + m.PIXEL_RATIO_STEP);
  });
  test("holds in the band between the two thresholds", () => {
    assert.equal(m.targetRatio(1, MID, 2), 1);
  });
  test("a mean exactly on the budget holds", () => {
    assert.equal(m.targetRatio(1, m.FRAME_BUDGET_MS, 2), 1);
  });
  test("never goes below the minimum nor above the device limit", () => {
    assert.equal(m.targetRatio(m.PIXEL_RATIO_MIN, SLOW, 2), m.PIXEL_RATIO_MIN);
    assert.equal(m.targetRatio(2, FAST, 2), 2);
    assert.equal(m.targetRatio(1, FAST, 1), 1);
  });
  test("the result is rounded, no float drift after many steps", () => {
    let r = 2;
    for (let i = 0; i < 20; i++) r = m.targetRatio(r, SLOW, 2);
    assert.equal(r, m.PIXEL_RATIO_MIN);
    assert.equal(m.targetRatio(0.75, FAST, 2), 1);
  });
});

describe("mayChange", () => {
  test("allowed before any change", () => {
    assert.equal(m.mayChange(null, 0), true);
  });
  test("refused until ADAPT_INTERVAL_MS have passed since the last change", () => {
    assert.equal(m.mayChange(1000, 1000 + m.ADAPT_INTERVAL_MS - 1), false);
    assert.equal(m.mayChange(1000, 1000 + m.ADAPT_INTERVAL_MS), true);
  });
  test("refused for a non-finite time", () => {
    assert.equal(m.mayChange(1000, NaN), false);
  });
});

describe("decide", () => {
  test("a fresh state starts at the given ratio, empty, never changed", () => {
    assert.deepEqual(m.initial(1.5), { frames: [], pixelRatio: 1.5, changedAt: null });
  });

  test("no change before ADAPT_MIN_FRAMES frames, however slow", () => {
    const s = feed(m.initial(2), SLOW, m.ADAPT_MIN_FRAMES - 1);
    assert.equal(s.pixelRatio, 2);
    assert.equal(s.changedAt, null);
  });

  test("a slow run lowers the ratio by one step after enough frames", () => {
    const s = feed(m.initial(2), SLOW, m.ADAPT_MIN_FRAMES);
    assert.equal(s.pixelRatio, 2 - m.PIXEL_RATIO_STEP);
    assert.equal(s.changedAt, (m.ADAPT_MIN_FRAMES - 1) * 100);
  });

  test("a change clears the window", () => {
    const s = feed(m.initial(2), SLOW, m.ADAPT_MIN_FRAMES);
    assert.deepEqual(s.frames, []);
  });

  test("hysteresis: no second change inside ADAPT_INTERVAL_MS", () => {
    const first = feed(m.initial(2), SLOW, m.ADAPT_MIN_FRAMES);
    const t = first.changedAt + 100;
    const s = feed(first, SLOW, 5, t);
    assert.equal(s.pixelRatio, first.pixelRatio, "still in the interval");
  });

  test("a second change happens once the interval and enough new frames have passed", () => {
    const first = feed(m.initial(2), SLOW, m.ADAPT_MIN_FRAMES);
    const t = first.changedAt + m.ADAPT_INTERVAL_MS;
    const s = feed(first, SLOW, m.ADAPT_MIN_FRAMES, t);
    assert.equal(s.pixelRatio, 2 - 2 * m.PIXEL_RATIO_STEP);
  });

  test("a fast run raises the ratio again, up to the device limit", () => {
    const low = feed(m.initial(1), FAST, m.ADAPT_MIN_FRAMES, 0, 2);
    assert.equal(low.pixelRatio, 1 + m.PIXEL_RATIO_STEP);
    const capped = feed(m.initial(2), FAST, m.ADAPT_MIN_FRAMES * 5, 0, 2);
    assert.equal(capped.pixelRatio, 2);
  });

  test("the window is bounded, however long the run", () => {
    const s = feed(m.initial(1), MID, m.FRAME_WINDOW * 4);
    assert.equal(s.frames.length, m.FRAME_WINDOW);
  });

  test("a pause (gap over MAX_SAMPLE_MS) is not a frame", () => {
    const s = m.decide(m.initial(2), m.MAX_SAMPLE_MS * 10, 0, 2);
    assert.deepEqual(s.frames, []);
    assert.equal(s.pixelRatio, 2);
  });

  test("a device ratio lower than the current ratio pulls it down, even inside the band", () => {
    const s = feed(m.initial(2), MID, m.ADAPT_MIN_FRAMES, 0, 1.25);
    assert.equal(s.pixelRatio, 1.25);
    const slow = feed(m.initial(2), SLOW, m.ADAPT_MIN_FRAMES, 0, 1);
    assert.equal(slow.pixelRatio, 1, "the slow step 2 to 1.75 is clamped to the device ratio 1");
  });

  test("a non-finite time never changes the ratio", () => {
    const s = feed(m.initial(2), NaN, m.ADAPT_MIN_FRAMES * 2);
    assert.equal(s.pixelRatio, 2);
    assert.deepEqual(s.frames, []);
  });

  test("is deterministic: the same inputs give the same state", () => {
    const a = feed(m.initial(2), SLOW, 25);
    const b = feed(m.initial(2), SLOW, 25);
    assert.deepEqual(a, b);
  });
});
