// The night layer with a fake THREE and a fake context (nothing is drawn). The fake THREE has no light
// classes: a layer that added a light would throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../view3d-night.js";
import { LAYERS } from "../view3d-layers.js";
import { WINDOW_CAPACITY, LAMP_CAPACITY, MAX_WINDOWS_PER_VOLUME, LAMP_SPACING, windowCountOf, levelsOf } from "../view3d-night-model.js";
import { cornerAltitudes } from "../view3d-model.js";
import { GENRE } from "../view3d-structures-model.js";

const W = 4, H = 4;
const ROAD = 77;

class FakeArray {
  constructor(n) { this.array = new Float32Array(n); this.usage = null; this.needsUpdate = false; }
  setUsage(u) { this.usage = u; }
}

function fakeThree() {
  class InstancedMesh {
    constructor(geometry, material, capacity) {
      this.geometry = geometry; this.material = material; this.capacity = capacity;
      this.instanceMatrix = new FakeArray(capacity * 16);
      this.count = 0; this.visible = true; this.frustumCulled = true; this.disposed = false;
    }
    dispose() { this.disposed = true; }
  }
  class MeshBasicMaterial {
    constructor(opts = {}) {
      this.color = { hex: 0, setHex(v) { this.hex = v; } };
      this.opacity = 1; this.transparent = false; this.disposed = false;
      Object.assign(this, opts);
      if (opts.color !== undefined) this.color = { hex: opts.color, setHex(v) { this.hex = v; } };
    }
    dispose() { this.disposed = true; }
  }
  class BoxGeometry { constructor() { this.disposed = false; } dispose() { this.disposed = true; } }
  class Group {
    constructor() { this.children = []; }
    add(...o) { this.children.push(...o); }
  }
  return { InstancedMesh, MeshBasicMaterial, BoxGeometry, Group, DynamicDrawUsage: "dynamic" };
}

// A fake context: one chunk (index 0) holds `volumes`; `tiles` is the engine's tile array; `records` the
// structures (Int32Array) with `rules` the structure rule flag; `daylight` written to scene.userData.
function fakeCtx({ volumes = [], tiles = new Uint16Array(W * H), records = new Int32Array(0), rules = true, daylight } = {}) {
  const scene = {
    children: [], userData: daylight === undefined ? {} : { daylight },
    add(o) { this.children.push(o); },
    remove(o) { this.children = this.children.filter((c) => c !== o); },
  };
  const city = {
    structure_rules: () => rules,
    structures: () => records,
  };
  const state = { corners: cornerAltitudes(new Uint8Array(W * H).fill(10), W, H) };
  return {
    THREE: fakeThree(),
    scene,
    canvas: {},
    renderRequests: 0,
    city: () => city,
    grid: () => ({ w: W, h: H, count: 1 }),
    corners: () => state.corners,
    snapshot: () => ({ w: W, h: H, tiles }),
    chunkVolumes: (c) => (c === 0 ? volumes : []),
    requestRender() { this.renderRequests++; },
  };
}

const vol = (over = {}) => ({ kind: "residential", x: 1, y: 1, base: 0.5, sx: 0.78, sy: 1, sz: 0.78, rgb: [1, 1, 1], ...over });
const meshes = (ctx) => ctx.scene.children[0].children; // [windows, posts, heads]
const stats = (ctx) => ctx.canvas.nightStats();
const LIT = 0xffd65a;

test("dispose and update before mount are harmless", () => {
  const layer = createLayer();
  layer.update({ city: () => null }, { fresh: true, dirty: [] });
  layer.frame({ scene: { userData: {} } });
  layer.dispose({ canvas: {}, scene: { remove() {} } });
});

test("registered as a light layer named night", () => {
  const l = LAYERS.find((x) => x.name === "night");
  assert.ok(l, "in the layer list");
  assert.equal(l.heavy, false);
});

test("the layer exposes only the lifecycle methods and adds no light", () => {
  const layer = createLayer();
  assert.deepEqual(Object.keys(layer).sort(), ["dispose", "frame", "mount", "update"]);
  const ctx = fakeCtx({ volumes: [vol()] });
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [0] });
  layer.frame(ctx, 0.1);
  assert.equal(ctx.scene.children.length, 1, "one group, no light object");
  layer.dispose(ctx);
});

test("mount: one group of three instanced meshes with the named capacities, not culled", () => {
  const ctx = fakeCtx();
  const layer = createLayer();
  layer.mount(ctx);
  const [windows, posts, heads] = meshes(ctx);
  assert.equal(windows.capacity, WINDOW_CAPACITY);
  assert.equal(posts.capacity, LAMP_CAPACITY);
  assert.equal(heads.capacity, LAMP_CAPACITY);
  for (const mesh of [windows, posts, heads]) assert.equal(mesh.frustumCulled, false);
  layer.dispose(ctx);
});

test("nightStats before any frame: day (daylight absent), nothing hidden-but-drawn", () => {
  const ctx = fakeCtx({ volumes: [vol()] });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [0] });
  const windows = windowCountOf(levelsOf(1)); // a volume of height 1: 3 storeys, 6 windows
  assert.deepEqual(stats(ctx), { intensity: 0, windows, lamps: 0, dropped: 0 }, "windows counted, meshes hidden in day");
  assert.equal(meshes(ctx)[0].visible, false);
  layer.dispose(ctx);
});

test("frame applies the intensity: hidden at day, lit and opaque at night, fading between", () => {
  const ctx = fakeCtx({ volumes: [vol()] });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [0] });
  const [windows, , heads] = meshes(ctx);
  ctx.scene.userData.daylight = 0;
  layer.frame(ctx, 0.1);
  assert.equal(stats(ctx).intensity, 1);
  assert.equal(windows.visible, true);
  assert.equal(windows.material.opacity, 1);
  assert.equal(windows.material.color.hex, LIT, "full night: the lit colour");
  ctx.scene.userData.daylight = 0.5;
  layer.frame(ctx, 0.1);
  assert.equal(stats(ctx).intensity, 0.5);
  assert.equal(windows.material.opacity, 0.5);
  assert.notEqual(windows.material.color.hex, LIT, "dusk: between dark and lit");
  assert.equal(heads.material.opacity, 0.5);
  ctx.scene.userData.daylight = 1;
  layer.frame(ctx, 0.1);
  assert.equal(stats(ctx).intensity, 0);
  assert.equal(windows.visible, false);
  assert.equal(heads.visible, false);
  layer.dispose(ctx);
});

test("the windows of the zone volumes are drawn, trees are not", () => {
  const volumes = [vol(), vol({ kind: "tree", x: 2 }), vol({ kind: "industrial", x: 3, sy: 1.8 })];
  const ctx = fakeCtx({ volumes });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [0] });
  const expected = windowCountOf(levelsOf(1)) + windowCountOf(levelsOf(1.8));
  assert.equal(meshes(ctx)[0].count, expected);
  assert.equal(stats(ctx).windows, expected);
  layer.dispose(ctx);
});

test("street lamps: a post and a head per lamp tile, from the engine's tiles", () => {
  const tiles = new Uint16Array(W * H).fill(ROAD);
  const ctx = fakeCtx({ tiles });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [0] });
  const expected = Math.ceil((W * H) / LAMP_SPACING);
  assert.equal(stats(ctx).lamps, expected);
  assert.equal(meshes(ctx)[1].count, expected);
  assert.equal(meshes(ctx)[2].count, expected);
  layer.dispose(ctx);
});

test("extended buildings: powered records get windows, unpowered ones none, rule off none", () => {
  const records = Int32Array.from([GENRE.GAS, 0, 0, 2, 2, 1, GENRE.GAS, 2, 2, 2, 2, 0]);
  const ctx = fakeCtx({ records });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [0] });
  assert.equal(stats(ctx).windows, 2 * (2 + 2) * 2, "the powered gas plant only");
  ctx.city = () => ({ structure_rules: () => false, structures: () => records });
  layer.update(ctx, { fresh: true, dirty: [0] });
  assert.equal(stats(ctx).windows, 0, "the rule off: nothing");
  layer.dispose(ctx);
});

test("placements are rebuilt only when the terrain or the structures change", () => {
  const ctx = fakeCtx({ volumes: [vol()] });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [0] });
  const windows = meshes(ctx)[0];
  windows.instanceMatrix.needsUpdate = false;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(windows.instanceMatrix.needsUpdate, false, "nothing changed: nothing rewritten");
  layer.update(ctx, { fresh: false, dirty: [0] });
  assert.equal(windows.instanceMatrix.needsUpdate, true, "a dirty chunk: rebuilt");
  windows.instanceMatrix.needsUpdate = false;
  ctx.corners = () => cornerAltitudes(new Uint8Array(W * H).fill(12), W, H); // new terrain
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(windows.instanceMatrix.needsUpdate, true, "new corners: rebuilt");
  layer.dispose(ctx);
});

test("a full city drops the windows past the capacity and counts them", () => {
  const volumes = Array.from({ length: 2000 }, (_, i) => vol({ x: i % 2, y: Math.floor(i / 2), sy: 9 }));
  const ctx = fakeCtx({ volumes });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [0] });
  assert.equal(stats(ctx).windows, WINDOW_CAPACITY);
  assert.equal(stats(ctx).dropped, 2000 * MAX_WINDOWS_PER_VOLUME - WINDOW_CAPACITY);
  layer.dispose(ctx);
});

test("dispose removes the group, releases the meshes and the hook", () => {
  const ctx = fakeCtx({ volumes: [vol()] });
  const layer = createLayer();
  layer.mount(ctx);
  const [windows, posts, heads] = meshes(ctx);
  layer.dispose(ctx);
  assert.equal(ctx.scene.children.length, 0);
  assert.equal(windows.material.disposed, true);
  assert.equal(posts.material.disposed, true);
  assert.equal(heads.material.disposed, true);
  assert.equal(ctx.canvas.nightStats, undefined);
  layer.dispose(ctx); // a second dispose is harmless
});
