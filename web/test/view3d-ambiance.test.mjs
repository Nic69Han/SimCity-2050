// Tests for the ambiance layer (web/view3d-ambiance.js) against the real Three.js build (no WebGL
// needed): the checkbox «Cycle jour/nuit» in #view3d-controls, the lights and daylight written per
// frame, the water material re-applied on a new terrain and restored on dispose, and no growth of
// the scene across many frames.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../vendor/three.module.min.js";
import { createLayer } from "../view3d-ambiance.js";
import { DAY_SECONDS, MIN_LIGHT } from "../view3d-ambiance-model.js";

// A minimal DOM: elements with children, hidden, style.cssText, listeners; and getElementById.
function fakeDocument() {
  const byId = new Map();
  const doc = {
    createElement(tag) {
      const listeners = new Map();
      const el = {
        tag, children: [], parent: null, hidden: false, style: { cssText: "" }, type: "", checked: false,
        get childElementCount() { return this.children.length; },
        append(...nodes) {
          for (const n of nodes) {
            if (typeof n === "string") { el.text = (el.text ?? "") + n; continue; }
            n.parent = el;
            el.children.push(n);
          }
        },
        remove() {
          if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el);
          el.parent = null;
        },
        addEventListener(type, fn) { listeners.set(type, fn); },
        removeEventListener(type) { listeners.delete(type); },
        dispatch(type) { listeners.get(type)?.(); },
      };
      return el;
    },
    getElementById(id) { return byId.get(id) ?? null; },
    add(id, el) { byId.set(id, el); },
  };
  return doc;
}

// The context a layer gets from view3d.js (the parts the layer uses), with a host in the page.
function fakeContext({ hostChildren = [], hostHidden = true } = {}) {
  const doc = fakeDocument();
  const host = doc.createElement("div");
  host.hidden = hostHidden;
  host.append(...hostChildren);
  doc.add("view3d-controls", host);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd6ea);
  const lights = { hemi: new THREE.HemisphereLight(), sun: new THREE.DirectionalLight() };
  lights.sun.target.position.set(32, 0, 24);
  scene.add(lights.hemi, lights.sun, lights.sun.target);
  const ctx = {
    THREE, scene, lights, canvas: { ownerDocument: doc },
    grid: () => ({ w: 64, h: 48 }),
    water: () => ctx.waterMesh,
    waterMesh: null,
  };
  return { ctx, doc, host, scene, lights };
}

function waterMesh() {
  return new THREE.Mesh(new THREE.PlaneGeometry(64, 48), new THREE.MeshLambertMaterial({ color: 0x2a5fb0 }));
}

describe("the «Cycle jour/nuit» control", () => {
  test("mount appends one checkbox to the shared container, on by default; dispose removes only it", () => {
    const camera = { tag: "button", parent: null, children: [], remove() {} };
    const { ctx, host } = fakeContext({ hostChildren: [camera], hostHidden: true });
    const layer = createLayer();
    layer.mount(ctx);
    assert.equal(host.hidden, false, "the container is shown while the layer is mounted");
    assert.equal(host.children.length, 2);
    const label = host.children[1];
    const input = label.children[0];
    assert.equal(input.type, "checkbox");
    assert.equal(input.checked, true, "the cycle is on by default");
    assert.equal(label.text.trim(), "Cycle jour/nuit");
    layer.dispose(ctx);
    assert.deepEqual(host.children, [camera], "only the layer's element is removed");
    assert.equal(host.hidden, false, "the container keeps the camera control, so it stays shown");
  });

  test("with nothing else in the container, dispose hides it again", () => {
    const { ctx, host } = fakeContext({ hostHidden: true });
    const layer = createLayer();
    layer.mount(ctx);
    layer.dispose(ctx);
    assert.equal(host.children.length, 0);
    assert.equal(host.hidden, true);
  });

  test("a missing container fails early with a named error", () => {
    const { ctx, doc } = fakeContext();
    doc.add("view3d-controls", null);
    assert.throws(() => createLayer().mount(ctx), /#view3d-controls is missing/);
  });

  test("unticking the box pauses the day; the sun stays where it was", () => {
    const { ctx, host, lights } = fakeContext();
    const layer = createLayer();
    layer.mount(ctx);
    const input = host.children[0].children[0];
    layer.frame(ctx, 0.1);
    const sunBefore = lights.sun.position.toArray();
    input.checked = false;
    input.dispatch("change");
    for (let i = 0; i < 100; i++) layer.frame(ctx, 0.1);
    assert.deepEqual(lights.sun.position.toArray(), sunBefore, "paused: the sun does not move");
    input.checked = true;
    input.dispatch("change");
    layer.frame(ctx, 1);
    assert.notDeepEqual(lights.sun.position.toArray(), sunBefore, "resumed: the sun moves again");
    layer.dispose(ctx);
  });
});

describe("the day and the lights", () => {
  test("mount writes the sky: daylight in userData, the hemisphere floor, the background", () => {
    const { ctx, scene, lights } = fakeContext();
    const layer = createLayer();
    layer.mount(ctx);
    const d = scene.userData.daylight;
    assert.ok(d >= 0 && d <= 1, `daylight ${d}`);
    assert.ok(lights.hemi.intensity >= MIN_LIGHT);
    assert.equal(scene.background.isColor, true);
    layer.dispose(ctx);
  });

  test("frame keeps daylight within [0, 1] over a full day, and it goes both ways", () => {
    const { ctx, scene } = fakeContext();
    const layer = createLayer();
    layer.mount(ctx);
    let min = 1, max = 0;
    for (let i = 0; i < Math.round(DAY_SECONDS / 0.1); i++) {
      layer.frame(ctx, 0.1);
      const d = scene.userData.daylight;
      assert.ok(d >= 0 && d <= 1, `daylight ${d}`);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    assert.ok(min < 0.05 && max > 0.95, `the day spans night to day: ${min} .. ${max}`);
    layer.dispose(ctx);
  });

  test("a long frame step counts as the bounded step (a hidden tab does not jump the day)", () => {
    const a = fakeContext(), b = fakeContext();
    const la = createLayer(), lb = createLayer();
    la.mount(a.ctx);
    lb.mount(b.ctx);
    la.frame(a.ctx, 1000);
    lb.frame(b.ctx, 0.1);
    assert.equal(a.scene.userData.daylight, b.scene.userData.daylight);
    la.dispose(a.ctx);
    lb.dispose(b.ctx);
  });

  test("many frames do not grow the scene or the objects the layer writes into", () => {
    const { ctx, scene, lights } = fakeContext();
    const layer = createLayer();
    layer.mount(ctx);
    const children = scene.children.length;
    const keys = Object.keys(scene.userData).length;
    const sunPos = lights.sun.position, sunColour = lights.sun.color, bg = scene.background;
    for (let i = 0; i < 20000; i++) layer.frame(ctx, 0.1);
    assert.equal(scene.children.length, children);
    assert.equal(Object.keys(scene.userData).length, keys);
    assert.equal(lights.sun.position, sunPos);
    assert.equal(lights.sun.color, sunColour);
    assert.equal(scene.background, bg);
    layer.dispose(ctx);
  });
});

describe("the water", () => {
  test("update puts the animated material on the water plane, and again on a new plane", () => {
    const { ctx } = fakeContext();
    const layer = createLayer();
    layer.mount(ctx);
    const first = waterMesh(), firstOriginal = first.material;
    ctx.waterMesh = first;
    layer.update(ctx, { fresh: true, dirty: [] });
    assert.notEqual(first.material, firstOriginal, "the water has the layer's material");
    assert.ok(first.material.map?.isTexture, "the water is animated with a texture");
    assert.deepEqual(first.material.map.repeat.toArray().slice(0, 2), [8, 6], "the texture covers 8 tiles");

    const material = first.material;
    layer.update(ctx, { fresh: false, dirty: [] });
    assert.equal(first.material, material, "the same plane is not applied twice");

    const second = waterMesh(), secondOriginal = second.material;
    ctx.waterMesh = second; // a terrain rebuild made a new plane
    layer.update(ctx, { fresh: true, dirty: [] });
    assert.equal(second.material.map, material.map, "the new plane has the animated material");
    assert.equal(second.material, material);

    layer.dispose(ctx);
    assert.equal(second.material, secondOriginal, "dispose restores the original material on the current plane");
  });

  test("update with no water yet does nothing", () => {
    const { ctx } = fakeContext();
    const layer = createLayer();
    layer.mount(ctx);
    layer.update(ctx, { fresh: true, dirty: [] });
    layer.dispose(ctx);
  });
});
