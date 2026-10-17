// 3D view camera, pure part (web/view3d-camera-model.js): quarter turns, zoom levels, the orbit's
// maths, recentring and the camera keys. No browser and no Three.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  QUARTER_TURN, ZOOM_LEVELS, HOME_ZOOM, CAMERA_KEYS, nextQuarterTurn, zoomDistances, zoomStep,
  homeDistance, centreTarget, cameraPosition, orbitOf,
} from "../view3d-camera-model.js";
import { SHORTCUTS } from "../tools.js";
import { extraCatalog } from "../extra-tools.js";
import { MockCity } from "./mock-engine.mjs";

const TWO_PI = Math.PI * 2;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

describe("quarter turns", () => {
  test("a turn right or left moves by exactly a quarter turn from a quarter multiple", () => {
    near(nextQuarterTurn(0, 1), QUARTER_TURN, "right from 0");
    near(nextQuarterTurn(QUARTER_TURN, 1), Math.PI, "right from a quarter");
    near(nextQuarterTurn(Math.PI, -1), QUARTER_TURN, "left from a half");
    near(nextQuarterTurn(QUARTER_TURN, -1), 0, "left from a quarter");
  });

  test("off a quarter multiple, the view snaps to the next one in the chosen direction", () => {
    near(nextQuarterTurn(0.35, 1), QUARTER_TURN, "right from 0.35 rad (the opening azimuth)");
    near(nextQuarterTurn(0.35, -1), 0, "left from 0.35 rad");
    near(nextQuarterTurn(2, 1), Math.PI, "right from 2 rad");
    near(nextQuarterTurn(2, -1), QUARTER_TURN, "left from 2 rad");
  });

  test("the result stays in [0, 2π) after any number of turns, and negative azimuths wrap", () => {
    let a = 0.35;
    for (let i = 0; i < 40; i++) {
      a = nextQuarterTurn(a, i % 3 === 0 ? -1 : 1);
      assert.ok(a >= 0 && a < TWO_PI, `in range: ${a}`);
    }
    near(nextQuarterTurn(-0.5, 1), 0, "right from -0.5 rad");
    near(nextQuarterTurn(-QUARTER_TURN, -1), TWO_PI - Math.PI, "left from -a quarter");
    near(nextQuarterTurn(TWO_PI * 3, 1), QUARTER_TURN, "right from three full turns");
  });

  test("four turns to the right from the opening azimuth are a full circle back to 0", () => {
    let a = 0.35;
    for (let i = 0; i < 4; i++) a = nextQuarterTurn(a, 1);
    near(a, 0, "0.35 -> π/2 -> π -> 3π/2 -> 2π (= 0)");
  });

  test("a bad direction or azimuth is a named error, not a silent turn", () => {
    assert.throws(() => nextQuarterTurn(0, 0), RangeError);
    assert.throws(() => nextQuarterTurn(0, 2), RangeError);
    assert.throws(() => nextQuarterTurn(Number.NaN, 1), RangeError);
  });
});

describe("zoom levels", () => {
  test("the levels are increasing and the opening view is one of them", () => {
    for (let i = 1; i < ZOOM_LEVELS.length; i++) assert.ok(ZOOM_LEVELS[i] > ZOOM_LEVELS[i - 1]);
    assert.ok(ZOOM_LEVELS.includes(HOME_ZOOM), "the home zoom is a level");
    // view3d.js opens at max(w, h) * 1.1
    near(homeDistance(120), 132, "home distance on a 120 map");
  });

  test("zoomDistances scales the levels by the map's larger side", () => {
    assert.deepEqual(zoomDistances(100), ZOOM_LEVELS.map((s) => s * 100));
  });

  test("zoom in goes to the nearest level closer than the current distance, zoom out to the nearest farther", () => {
    const size = 100;
    near(zoomStep(110, true, size), 60, "in from 110");
    near(zoomStep(110, false, size), 160, "out from 110");
    // between two levels: the step lands on a level, in the asked direction
    near(zoomStep(80, true, size), 60, "in from 80");
    near(zoomStep(80, false, size), 110, "out from 80");
  });

  test("at the ends of the list the distance stays on the last level", () => {
    const size = 100;
    near(zoomStep(35, true, size), 35, "the nearest level stays nearest");
    near(zoomStep(160, false, size), 160, "the farthest level stays farthest");
    near(zoomStep(1, true, size), 35, "a distance below every level goes to the first");
    near(zoomStep(500, false, size), 160, "a distance above every level goes to the last");
  });

  test("from each level, one step in is the level before it and one step out is the level after it", () => {
    const size = 120;
    const levels = zoomDistances(size);
    for (let i = 1; i < levels.length; i++) {
      near(zoomStep(levels[i], true, size), levels[i - 1], `in from level ${i}`);
    }
    for (let i = 0; i < levels.length - 1; i++) {
      near(zoomStep(levels[i], false, size), levels[i + 1], `out from level ${i}`);
    }
  });

  test("a bad distance is a named error", () => {
    assert.throws(() => zoomStep(Number.NaN, true, 100), RangeError);
  });
});

describe("orbit maths", () => {
  test("the target and the orbit give the camera position, as view3d.js mount() places it", () => {
    const target = { x: 60, y: 0, z: 50 };
    const p = cameraPosition(target, { azimuth: 0.35, polar: 0.95, distance: 132 });
    near(p.x, 60 + 132 * Math.sin(0.95) * Math.sin(0.35), "x");
    near(p.y, 132 * Math.cos(0.95), "y");
    near(p.z, 50 + 132 * Math.sin(0.95) * Math.cos(0.35), "z");
  });

  test("orbitOf inverts cameraPosition (azimuth in [0, 2π))", () => {
    const target = { x: 10, y: 0, z: -4 };
    for (const orbit of [
      { azimuth: 0.35, polar: 0.95, distance: 132 },
      { azimuth: 3.5, polar: 0.4, distance: 30 },
      { azimuth: 0, polar: 1.2, distance: 60 },
    ]) {
      const back = orbitOf(cameraPosition(target, orbit), target);
      near(back.azimuth, orbit.azimuth, "azimuth");
      near(back.polar, orbit.polar, "polar");
      near(back.distance, orbit.distance, "distance");
    }
  });

  test("orbitOf of a camera on the target is distance 0 with polar 0", () => {
    const o = orbitOf({ x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 });
    assert.equal(o.distance, 0);
    assert.equal(o.polar, 0);
  });

  test("centreTarget is the middle of the map on the ground", () => {
    assert.deepEqual(centreTarget(120, 100), { x: 60, y: 0, z: 50 });
  });
});

describe("camera keys", () => {
  test("every key is one the tools do not use, so both keyboard systems can run side by side", () => {
    const extra = extraCatalog(new MockCity(1)).map((t) => t.shortcut);
    const toolKeys = new Set([...Object.values(SHORTCUTS), ...extra]);
    for (const key of Object.keys(CAMERA_KEYS)) {
      assert.ok(!toolKeys.has(key), `camera key ${key} collides with a tool shortcut`);
    }
  });

  test("the keys are the documented ones", () => {
    assert.deepEqual(Object.keys(CAMERA_KEYS).sort(), [",", ".", "-", "=", "Home"].sort());
    assert.equal(CAMERA_KEYS[","], "turnLeft");
    assert.equal(CAMERA_KEYS["."], "turnRight");
    assert.equal(CAMERA_KEYS["="], "zoomIn");
    assert.equal(CAMERA_KEYS["-"], "zoomOut");
    assert.equal(CAMERA_KEYS.Home, "home");
  });
});
