// Tests for the 3D view's ambiance model (web/view3d-ambiance-model.js): the sky keyframes, their
// continuity, bounds and wrap-around at 1, the time accumulator, and the water's colour and texture.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as m from "../view3d-ambiance-model.js";

const SAMPLES = 4000;

// The sky sampled at SAMPLES phases in [0, 1).
function samples() {
  const out = [];
  for (let i = 0; i < SAMPLES; i++) out.push(m.sky(i / SAMPLES));
  return out;
}

const luminance = (c) => 0.2126 * ((c >> 16) & 0xff) + 0.7152 * ((c >> 8) & 0xff) + 0.0722 * (c & 0xff);
const channels = (c) => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];

describe("sky(): keyframes", () => {
  test("night at midnight, dawn, day at noon, dusk, night again", () => {
    assert.equal(m.sky(0).daylight, 0);
    assert.equal(m.sky(0.25).daylight, 0.5);
    assert.equal(m.sky(0.5).daylight, 1);
    assert.equal(m.sky(0.75).daylight, 0.5);
    assert.equal(m.sky(0).background, 0x0e1c38);
    assert.equal(m.sky(0.25).background, 0xf2a77c);
    assert.equal(m.sky(0.5).background, 0xbcd6ea);
    assert.equal(m.sky(0.75).background, 0xd9806a);
    assert.equal(m.sky(0.5).sunIntensity, 1.6);
    assert.equal(m.sky(0.5).hemiSky, 0xffffff);
  });

  test("the sun is overhead at noon, below the ground at midnight, on the horizon at dawn and dusk", () => {
    const noon = m.sky(0.5).sunDir, midnight = m.sky(0).sunDir;
    assert.ok(Math.abs(noon[1] - 1) < 1e-9, "noon: straight up");
    assert.ok(Math.abs(midnight[1] + 1) < 1e-9, "midnight: straight down");
    assert.ok(Math.abs(m.sky(0.25).sunDir[1]) < 1e-9, "dawn: on the horizon");
    assert.ok(Math.abs(m.sky(0.75).sunDir[1]) < 1e-9, "dusk: on the horizon");
  });

  test("night is dark blue: blue over red and green, low luminance", () => {
    const [r, g, b] = channels(m.sky(0).background);
    assert.ok(b > r && b > g, `blue dominates: ${r} ${g} ${b}`);
    assert.ok(luminance(m.sky(0).background) < 40, "dark");
    assert.ok(luminance(m.sky(0.5).background) > 150, "day is bright");
  });

  test("the hemisphere light never falls under MIN_LIGHT, at any time", () => {
    for (const s of samples()) assert.ok(s.hemiIntensity >= m.MIN_LIGHT, `${s.hemiIntensity} >= ${m.MIN_LIGHT}`);
    assert.equal(m.sky(0).hemiIntensity, m.MIN_LIGHT);
  });

  test("bounds: intensities, daylight and colours stay in range, the sun direction is a unit vector", () => {
    for (const s of samples()) {
      assert.ok(s.sunIntensity >= 0 && s.sunIntensity <= 2, `sun ${s.sunIntensity}`);
      assert.ok(s.hemiIntensity <= 2, `hemi ${s.hemiIntensity}`);
      assert.ok(s.daylight >= 0 && s.daylight <= 1, `daylight ${s.daylight}`);
      for (const c of [s.sunColour, s.hemiSky, s.hemiGround, s.background]) {
        assert.ok(Number.isInteger(c) && c >= 0 && c <= 0xffffff, `colour ${c}`);
      }
      const [x, y, z] = s.sunDir;
      assert.ok(Math.abs(x * x + y * y + z * z - 1) < 1e-9, "unit sun direction");
    }
  });

  test("continuity: consecutive samples differ by a small step, the cycle is closed", () => {
    let prev = m.sky(0), maxNum = 0, maxCol = 0, maxDir = 0;
    for (let i = 1; i <= SAMPLES; i++) {
      const s = m.sky(i / SAMPLES); // i = SAMPLES is phase 1, which must be phase 0 again
      maxNum = Math.max(maxNum, Math.abs(s.sunIntensity - prev.sunIntensity), Math.abs(s.hemiIntensity - prev.hemiIntensity), Math.abs(s.daylight - prev.daylight));
      for (const k of ["sunColour", "hemiSky", "hemiGround", "background"]) {
        const a = channels(prev[k]), b = channels(s[k]);
        for (let c = 0; c < 3; c++) maxCol = Math.max(maxCol, Math.abs(a[c] - b[c]));
      }
      for (let c = 0; c < 3; c++) maxDir = Math.max(maxDir, Math.abs(s.sunDir[c] - prev.sunDir[c]));
      prev = s;
    }
    assert.ok(maxNum < 0.005, `numbers jump by ${maxNum}`);
    assert.ok(maxCol <= 2, `a colour channel jumps by ${maxCol}`);
    assert.ok(maxDir < 0.005, `the sun jumps by ${maxDir}`);
    const end = m.sky(1 - 1e-12), start = m.sky(0);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(end.sunDir[c] - start.sunDir[c]) < 1e-9, "the sun is back");
    assert.equal(end.background, start.background);
  });

  test("wraps around at 1: a phase outside [0, 1) reads the same sky", () => {
    assert.deepEqual(m.sky(1.25), m.sky(0.25));
    assert.deepEqual(m.sky(-0.75), m.sky(0.25));
    assert.deepEqual(m.sky(3.5), m.sky(0.5));
  });

  test("skyAt writes into the given object and keeps its arrays (no growth per call)", () => {
    const out = m.createSky();
    const dir = out.sunDir;
    for (let i = 0; i < 5000; i++) m.skyAt(i / 5000, out);
    assert.equal(out.sunDir, dir, "the same direction array");
    assert.equal(out.sunDir.length, 3);
    assert.deepEqual(Object.keys(out).sort(), Object.keys(m.createSky()).sort());
  });

  test("a non-finite phase is rejected with a named error", () => {
    assert.throws(() => m.sky(NaN), RangeError);
    assert.throws(() => m.sky(Infinity), RangeError);
    assert.throws(() => m.skyAt(undefined, m.createSky()), RangeError);
  });
});

describe("time accumulator: advancePhase", () => {
  test("one full day of frames brings the phase back to where it started", () => {
    let p = 0.3;
    const frames = Math.round(m.DAY_SECONDS / 0.1);
    for (let i = 0; i < frames; i++) p = m.advancePhase(p, 0.1, m.DAY_SECONDS);
    assert.ok(Math.abs(p - 0.3) < 1e-9, `phase ${p}`);
  });

  test("always in [0, 1), wrapping past 1", () => {
    let p = 0.9999;
    for (let i = 0; i < 10000; i++) {
      p = m.advancePhase(p, 0.1, m.DAY_SECONDS);
      assert.ok(p >= 0 && p < 1, `phase ${p}`);
    }
    // 0.999 + 0.05 / 0.1 = 1.499: wraps to 0.499
    assert.ok(Math.abs(m.advancePhase(0.999, 0.05, 0.1) - 0.499) < 1e-9, "a step past 1 wraps");
  });

  test("bounded: a long step counts as MAX_STEP_SECONDS", () => {
    assert.equal(m.advancePhase(0, 1e4, m.DAY_SECONDS), m.advancePhase(0, m.MAX_STEP_SECONDS, m.DAY_SECONDS));
    assert.equal(m.advancePhase(0.2, 0, m.DAY_SECONDS), 0.2);
  });

  test("invalid input fails early: negative, non-finite seconds, non-positive period", () => {
    assert.throws(() => m.advancePhase(0, -1, m.DAY_SECONDS), RangeError);
    assert.throws(() => m.advancePhase(0, NaN, m.DAY_SECONDS), RangeError);
    assert.throws(() => m.advancePhase(0, 0.1, 0), RangeError);
  });
});

describe("water", () => {
  test("waterColour: the day blue at full daylight, darker at night", () => {
    assert.equal(m.waterColour(1), m.WATER_DAY);
    assert.equal(m.waterColour(0), m.WATER_NIGHT);
    assert.ok(luminance(m.WATER_NIGHT) < luminance(m.WATER_DAY));
    assert.equal(m.waterColour(7), m.WATER_DAY, "clamped");
  });

  test("the ripple is tileable and in [0.8, 1]", () => {
    const n = m.RIPPLE_SIZE;
    for (let y = 0; y < n; y += 7) {
      for (let x = 0; x < n; x += 5) {
        const v = m.rippleValue(x, y, n);
        assert.ok(v >= 0.8 && v <= 1, `value ${v}`);
        assert.ok(Math.abs(v - m.rippleValue(x + n, y, n)) < 1e-9, "periodic in x");
        assert.ok(Math.abs(v - m.rippleValue(x, y + n, n)) < 1e-9, "periodic in y");
      }
    }
  });

  test("the ripple texture: RGBA bytes, opaque grey", () => {
    const n = m.RIPPLE_SIZE;
    const data = m.rippleTexture(n);
    assert.equal(data.length, n * n * 4);
    for (let i = 0; i < data.length; i += 4) {
      assert.equal(data[i], data[i + 1]);
      assert.equal(data[i], data[i + 2]);
      assert.equal(data[i + 3], 255);
      assert.ok(data[i] >= 204 && data[i] <= 255, `texel ${data[i]}`);
    }
  });

  test("the ripple texture rejects a size out of 2..1024", () => {
    assert.throws(() => m.rippleTexture(1), RangeError);
    assert.throws(() => m.rippleTexture(2048), RangeError);
    assert.throws(() => m.rippleTexture(8.5), RangeError);
  });
});
