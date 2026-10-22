// The highways layer with a fake THREE and a fake context (the scene itself is not drawn here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../view3d-highways.js";
import { CAPACITY, HIGHWAY } from "../view3d-highways-model.js";
import { cornerAltitudes } from "../view3d-model.js";
import { LAYERS } from "../view3d-layers.js";

const W = 4, H = 3;

class FakeArray {
  constructor(n) { this.array = new Float32Array(n); this.usage = null; this.needsUpdate = false; }
  setUsage(u) { this.usage = u; }
}

function fakeThree() {
  class InstancedMesh {
    constructor(geometry, material, capacity) {
      this.geometry = geometry;
      this.material = material;
      this.capacity = capacity;
      this.instanceMatrix = new FakeArray(capacity * 16);
      this.instanceColor = null;
      this.count = 0;
      this.frustumCulled = true;
      this.disposed = false;
    }
    dispose() { this.disposed = true; }
  }
  class Geometry { constructor(...a) { this.args = a; this.disposed = false; } dispose() { this.disposed = true; } }
  class BoxGeometry extends Geometry {}
  class MeshLambertMaterial { constructor() { this.disposed = false; } dispose() { this.disposed = true; } }
  class InstancedBufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.usage = null; this.needsUpdate = false; }
    setUsage(u) { this.usage = u; }
  }
  return {
    InstancedMesh, BoxGeometry, MeshLambertMaterial, InstancedBufferAttribute, DynamicDrawUsage: "dynamic",
  };
}

// A fake scene and context. `city` is what ctx.city() returns; `corners` the terrain; (w, h) the grid.
function fakeCtx(city, { corners = cornerAltitudes(new Uint8Array(W * H).fill(10), W, H), w = W, h = H } = {}) {
  const scene = {
    children: [],
    add(o) { this.children.push(o); },
    remove(o) { this.children = this.children.filter((c) => c !== o); },
  };
  return {
    THREE: fakeThree(),
    scene,
    canvas: {},
    renderRequests: 0,
    city: () => city,
    grid: () => ({ w, h }),
    corners: () => corners,
    requestRender() { this.renderRequests++; },
  };
}

// A city whose highway rule and layer the test controls. Counts the reads of highway_layer().
function fakeCity({ rules = true, bytes = new Uint8Array(W * H) } = {}) {
  const city = {
    reads: 0,
    rules,
    bytes,
    highway_rules: () => city.rules,
    highway_layer: () => { city.reads++; return city.bytes; },
  };
  return city;
}

const decks = (ctx) => ctx.scene.children[0];
const pillars = (ctx) => ctx.scene.children[1];
const stats = (ctx) => ctx.canvas.highwaysStats();
const cells = (list, w = W, h = H) => {
  const bytes = new Uint8Array(w * h);
  for (const [x, y] of list) bytes[x * h + y] = HIGHWAY; // engine order: index = x * height + y
  return bytes;
};

test("dispose and update before mount are harmless", () => {
  const layer = createLayer();
  layer.update({ city: () => null }, { fresh: true, dirty: [] });
  layer.dispose({ canvas: {}, scene: { remove() {} } });
});

test("two meshes (decks, pillars) of the capacity, in the scene, not culled, with colours", () => {
  const ctx = fakeCtx(fakeCity({ rules: false }));
  const layer = createLayer();
  layer.mount(ctx);
  assert.equal(ctx.scene.children.length, 2);
  for (const m of ctx.scene.children) {
    assert.equal(m.capacity, CAPACITY);
    assert.equal(m.frustumCulled, false);
    assert.equal(m.instanceColor.array.length, CAPACITY * 3);
  }
  layer.dispose(ctx);
});

test("nothing is read and nothing drawn while highway_rules() is false", () => {
  const city = fakeCity({ rules: false, bytes: cells([[0, 0]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(city.reads, 0);
  assert.equal(decks(ctx).count, 0);
  assert.equal(pillars(ctx).count, 0);
  assert.deepEqual(stats(ctx), { tiles: 0, decks: 0, pillars: 0, dropped: 0, rebuilds: 1 });
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(stats(ctx).rebuilds, 1, "the same empty key: nothing rewritten");
  layer.dispose(ctx);
});

test("nothing drawn when the engine methods are missing", () => {
  const ctx = fakeCtx({ highway_layer: () => cells([[0, 0]]) });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(decks(ctx).count, 0);
  assert.equal(stats(ctx).tiles, 0);
  layer.dispose(ctx);
  const ctx2 = fakeCtx({ highway_rules: () => true });
  layer.mount(ctx2);
  layer.update(ctx2, { fresh: true, dirty: [] });
  assert.equal(decks(ctx2).count, 0);
  layer.dispose(ctx2);
});

test("nothing read before the grid or the terrain is known", () => {
  const city = fakeCity({ bytes: cells([[0, 0]]) });
  const ctx = fakeCtx(city);
  ctx.corners = () => null;
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(city.reads, 0);
  layer.dispose(ctx);
});

test("each highway tile is a deck; the pillars are on the tiles with (x + y) % 3 === 0", () => {
  // tiles (1, 2) and (3, 0): index of (1, 2) is 1 * 3 + 2 = 5. Sums 3 and 3: both carry a pillar.
  const city = fakeCity({ bytes: cells([[1, 2], [3, 0]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(decks(ctx).count, 2);
  assert.equal(pillars(ctx).count, 2);
  const d = decks(ctx).instanceMatrix.array;
  assert.equal(d[12], 1.5, "first deck: x of tile (1, 2)");
  assert.equal(d[14], 2.5, "first deck: z of tile (1, 2)");
  assert.equal(d[16 + 12], 3.5, "second deck: x of tile (3, 0)");
  assert.equal(d[16 + 14], 0.5, "second deck: z of tile (3, 0)");
  const p = pillars(ctx).instanceMatrix.array;
  assert.equal(p[12], 1.5, "first pillar: x of tile (1, 2)");
  assert.ok(p[13] < d[13], "a pillar stands below its deck");
  assert.deepEqual(stats(ctx), { tiles: 2, decks: 2, pillars: 2, dropped: 0, rebuilds: 1 });
  assert.equal(ctx.renderRequests, 1);
  layer.dispose(ctx);
});

test("the layer is read every update, rebuilt only when the bytes, the rule or the terrain changed", () => {
  const city = fakeCity({ bytes: cells([[0, 0]]) });
  const corners = cornerAltitudes(new Uint8Array(W * H).fill(10), W, H);
  const ctx = fakeCtx(city, { corners });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: false, dirty: [] });
  layer.update(ctx, { fresh: false, dirty: [] });
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(city.reads, 3);
  assert.equal(stats(ctx).rebuilds, 1, "same bytes: nothing rebuilt");
  city.bytes = cells([[0, 0], [1, 1]]); // a highway appears
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(stats(ctx).rebuilds, 2);
  assert.equal(stats(ctx).decks, 2);
  ctx.corners = () => cornerAltitudes(new Uint8Array(W * H).fill(12), W, H); // new terrain
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(stats(ctx).rebuilds, 3);
  city.rules = false;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(stats(ctx).rebuilds, 4, "the rule switched off");
  assert.equal(decks(ctx).count, 0);
  layer.dispose(ctx);
});

test("switching the rule off clears the decks; on again redraws them", () => {
  const city = fakeCity({ bytes: cells([[2, 1]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(decks(ctx).count, 1);
  city.rules = false;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(decks(ctx).count, 0);
  assert.equal(pillars(ctx).count, 0);
  city.rules = true;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(decks(ctx).count, 1);
  layer.dispose(ctx);
});

test("highway tiles past the capacity are dropped and counted", () => {
  const w = 70, h = 60; // 4200 tiles, all highway: CAPACITY decks, the rest dropped
  const city = fakeCity({ bytes: new Uint8Array(w * h).fill(HIGHWAY) });
  const ctx = fakeCtx(city, { w, h, corners: cornerAltitudes(new Uint8Array(w * h), w, h) });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(decks(ctx).count, CAPACITY);
  assert.equal(stats(ctx).tiles, w * h);
  assert.equal(stats(ctx).dropped, w * h - CAPACITY);
  layer.dispose(ctx);
});

test("a read that is not a typed array draws nothing", () => {
  const city = fakeCity({ bytes: [1, 1, 1] });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(decks(ctx).count, 0);
  assert.equal(stats(ctx).tiles, 0);
  layer.dispose(ctx);
});

test("registered as a light layer named highways", () => {
  const l = LAYERS.find((x) => x.name === "highways");
  assert.equal(l.heavy, false);
});

test("dispose removes both meshes, disposes their geometry and material, and the hook", () => {
  const ctx = fakeCtx(fakeCity({ bytes: cells([[0, 0]]) }));
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  const [a, b] = ctx.scene.children;
  layer.dispose(ctx);
  assert.equal(ctx.scene.children.length, 0);
  for (const m of [a, b]) {
    assert.equal(m.disposed, true);
    assert.equal(m.geometry.disposed, true);
    assert.equal(m.material.disposed, true);
  }
  assert.equal(ctx.canvas.highwaysStats, undefined);
  layer.dispose(ctx);
});
