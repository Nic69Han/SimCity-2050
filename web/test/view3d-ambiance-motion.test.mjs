// Tests of the reduced-motion rule of the ambiance (prefers-reduced-motion: reduce): the pure rule
// (view3d-ambiance-model.js) and the layer (view3d-ambiance.js) with the real Three.js build: under the
// preference the day stays at full day, the water does not move, the cycle checkbox is off and disabled;
// without it, the layer moves as before.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../vendor/three.module.min.js";
import { createLayer } from "../view3d-ambiance.js";
import {
  motionFor, prefersReducedMotion, skyAt, createSky, MEDIA_REDUCED_MOTION, REDUCED_PHASE, START_PHASE,
} from "../view3d-ambiance-model.js";

describe("the reduced-motion rule (pure)", () => {
  test("the preference is read from the query of the window, and nothing without a window", () => {
    const asked = [];
    const yes = (q) => { asked.push(q); return { matches: true }; };
    assert.equal(prefersReducedMotion(yes), true);
    assert.deepEqual(asked, [MEDIA_REDUCED_MOTION]);
    assert.equal(prefersReducedMotion(() => ({ matches: false })), false);
    assert.equal(prefersReducedMotion(undefined), false, "no window: nothing is reduced");
    assert.equal(prefersReducedMotion(() => null), false, "no answer: nothing is reduced");
  });

  test("the reduced motion freezes the cycle at full day and the water", () => {
    assert.deepEqual(motionFor(true), { cycle: REDUCED_PHASE, cycles: false, waterMoves: false });
    assert.equal(skyAt(REDUCED_PHASE, createSky()).daylight, 1, "full day");
  });

  test("without the preference, the values are those of the layer before this rule", () => {
    assert.deepEqual(motionFor(false), { cycle: START_PHASE, cycles: true, waterMoves: true });
    assert.deepEqual(motionFor(undefined), motionFor(false));
  });
});

// A minimal DOM for the layer: createElement, getElementById, and a window with matchMedia.
function fakeContext({ reduced }) {
  const byId = new Map();
  const matchMedia = (query) => ({ matches: reduced && query === MEDIA_REDUCED_MOTION });
  const win = { matchMedia };
  const doc = {
    defaultView: win,
    createElement(tag) {
      return {
        tag, children: [], parent: null, hidden: false, type: "", checked: false, disabled: false,
        style: { cssText: "" }, className: "",
        append(...nodes) { for (const n of nodes) { if (typeof n === "string") continue; n.parent = this; this.children.push(n); } },
        remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
        addEventListener() {}, removeEventListener() {},
      };
    },
    getElementById: (id) => byId.get(id) ?? null,
  };
  const host = doc.createElement("div");
  byId.set("view3d-controls", host);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd6ea);
  const lights = { hemi: new THREE.HemisphereLight(), sun: new THREE.DirectionalLight() };
  lights.sun.target.position.set(32, 0, 24);
  scene.add(lights.hemi, lights.sun, lights.sun.target);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(64, 48), new THREE.MeshLambertMaterial({ color: 0x2a5fb0 }));
  const ctx = {
    THREE, scene, lights, canvas: { ownerDocument: doc }, grid: () => ({ w: 64, h: 48 }), water: () => water,
  };
  return { ctx, host, water };
}

describe("the ambiance layer under the preference", () => {
  test("reduced motion: full day after many frames, the water still, the checkbox off and disabled", () => {
    const { ctx, host } = fakeContext({ reduced: true });
    const layer = createLayer();
    layer.mount(ctx);
    layer.update(ctx);
    for (let i = 0; i < 600; i++) layer.frame(ctx, 0.1); // 60 s of frames
    assert.equal(ctx.scene.userData.daylight, 1, "full day, whatever the time");
    const input = host.children[host.children.length - 1].children[0];
    assert.equal(input.checked, false);
    assert.equal(input.disabled, true, "the cycle cannot be turned back on");
    const material = ctx.water().material;
    assert.equal(material.map.offset.x, 0, "the water does not move");
    assert.equal(material.map.offset.y, 0);
    layer.dispose(ctx);
  });

  test("without the preference: the cycle moves the day and the water moves, as before", () => {
    const { ctx, host } = fakeContext({ reduced: false });
    const layer = createLayer();
    layer.mount(ctx);
    layer.update(ctx);
    const before = ctx.scene.userData.daylight;
    for (let i = 0; i < 40; i++) layer.frame(ctx, 0.1);
    assert.notEqual(ctx.scene.userData.daylight, before, "the day moves");
    const input = host.children[host.children.length - 1].children[0];
    assert.equal(input.checked, true);
    assert.equal(input.disabled, false);
    const material = ctx.water().material;
    assert.ok(material.map.offset.x > 0, "the water moves");
    layer.dispose(ctx);
  });
});
