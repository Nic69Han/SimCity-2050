// The sprites layer with a fake THREE and a fake context (the scene itself is not drawn here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../view3d-sprites.js";
import { CAPACITY } from "../view3d-sprites-model.js";
import { cornerAltitudes } from "../view3d-model.js";
import { LAYERS } from "../view3d-layers.js";

const W = 8, H = 8;

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

function fakeCtx(city) {
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
    grid: () => ({ w: W, h: H }),
    corners: () => cornerAltitudes(new Uint8Array(W * H).fill(10), W, H),
    requestRender() { this.renderRequests++; },
  };
}

// A city whose sprites() the test controls. Counts the reads.
function fakeCity(flat = []) {
  const city = {
    reads: 0,
    flat,
    sprites: () => { city.reads++; return city.flat; },
  };
  return city;
}

// One engine record: [kind, frame, x, y, xHot, yHot, width, height].
const rec = (kind, x, y) => [kind, 1, x, y, 0, 0, 32, 32];
const flat = (...recs) => Int32Array.from(recs.flat());
const mesh = (ctx) => ctx.scene.children[0];
const stats = (ctx) => ctx.canvas.spritesStats();

test("dispose and frame before mount are harmless", () => {
  const layer = createLayer();
  layer.frame({ city: () => null }, 1);
  layer.dispose({ canvas: {}, scene: { remove() {} } });
});

test("registered as a light layer named sprites", () => {
  const l = LAYERS.find((x) => x.name === "sprites");
  assert.equal(l.heavy, false);
});

test("one mesh of the capacity, in the scene, not culled, with its colours", () => {
  const ctx = fakeCtx(fakeCity());
  const layer = createLayer();
  layer.mount(ctx);
  assert.equal(ctx.scene.children.length, 1);
  assert.equal(mesh(ctx).capacity, CAPACITY);
  assert.equal(mesh(ctx).frustumCulled, false);
  assert.equal(mesh(ctx).instanceColor.array.length, CAPACITY * 3);
  assert.equal(mesh(ctx).count, 0);
  layer.dispose(ctx);
});

test("the first frame reads at once; then the engine is read every READ_INTERVAL seconds", () => {
  const city = fakeCity(flat(rec(1, 16, 16)));
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 0.016);
  assert.equal(city.reads, 1);
  layer.frame(ctx, 0.1);
  layer.frame(ctx, 0.1);
  assert.equal(city.reads, 1, "0.2 s: not yet due");
  layer.frame(ctx, 0.1);
  assert.equal(city.reads, 2, "0.3 s since the last read");
  layer.dispose(ctx);
});

test("a negative or non-finite step does not advance the clock", () => {
  const city = fakeCity(flat(rec(1, 16, 16)));
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 0);
  layer.frame(ctx, -5);
  layer.frame(ctx, Number.NaN);
  assert.equal(city.reads, 1);
  layer.dispose(ctx);
});

test("each box is written at its place: a train on tile (2, 3), its base on the terrain", () => {
  const city = fakeCity(flat([1, 1, 32, 48, 0, 0, 32, 32]));
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  assert.equal(mesh(ctx).count, 1);
  const m = mesh(ctx).instanceMatrix.array;
  assert.equal(m[12], 2, "x of the tile");
  assert.equal(m[14], 3, "z of the tile");
  assert.ok(Math.abs(m[13] - (2.5 + 0.1)) < 1e-6, "on the terrain (2.5), centred on half a box (cy 0.1)");
  assert.equal(mesh(ctx).instanceMatrix.needsUpdate, true);
  assert.equal(mesh(ctx).instanceColor.needsUpdate, true);
  assert.deepEqual(stats(ctx), { sprites: 1, boxes: 1, dropped: 0, reads: 1 });
  assert.equal(ctx.renderRequests, 1);
  layer.dispose(ctx);
});

test("the sprites follow the engine: a new read moves them", () => {
  const city = fakeCity(flat(rec(1, 16, 16)));
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  assert.equal(mesh(ctx).instanceMatrix.array[12], 1);
  city.flat = flat(rec(1, 80, 16));
  layer.frame(ctx, 0.3);
  assert.equal(mesh(ctx).instanceMatrix.array[12], 5);
  layer.dispose(ctx);
});

test("no sprites: nothing drawn, and an empty list is read like any other", () => {
  const city = fakeCity(flat());
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  assert.equal(mesh(ctx).count, 0);
  assert.deepEqual(stats(ctx), { sprites: 0, boxes: 0, dropped: 0, reads: 1 });
  layer.dispose(ctx);
});

test("nothing drawn when the engine has no sprites() method (the mock engine)", () => {
  const ctx = fakeCtx({ width: () => W });
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  assert.equal(mesh(ctx).count, 0);
  assert.deepEqual(stats(ctx), { sprites: 0, boxes: 0, dropped: 0, reads: 0 });
  layer.dispose(ctx);
});

test("a sprite that was drawn and then disappears clears the mesh", () => {
  const city = fakeCity(flat(rec(5, 16, 16)));
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  assert.equal(mesh(ctx).count, 1);
  city.flat = flat();
  layer.frame(ctx, 0.3);
  assert.equal(mesh(ctx).count, 0);
  layer.dispose(ctx);
});

test("nothing read before the grid or the terrain is known", () => {
  const city = fakeCity(flat(rec(1, 16, 16)));
  const ctx = fakeCtx(city);
  ctx.corners = () => null;
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  assert.equal(city.reads, 0);
  assert.equal(mesh(ctx).count, 0);
  layer.dispose(ctx);
});

test("sprites past the capacity are dropped and counted, never written past the mesh", () => {
  // 513 planes of 2 boxes each: 512 fit (1024 boxes), the 513th is dropped
  const recs = [];
  for (let i = 0; i < 513; i++) recs.push(rec(3, 16, 16));
  const city = fakeCity(flat(...recs));
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  assert.equal(mesh(ctx).count, CAPACITY);
  assert.deepEqual(stats(ctx), { sprites: 512, boxes: CAPACITY, dropped: 1, reads: 1 });
  layer.dispose(ctx);
});

test("dispose removes the mesh, disposes its geometry and material, and the hook", () => {
  const ctx = fakeCtx(fakeCity(flat(rec(1, 16, 16))));
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  const m = mesh(ctx);
  layer.dispose(ctx);
  assert.equal(ctx.scene.children.length, 0);
  assert.equal(m.disposed, true);
  assert.equal(m.geometry.disposed, true);
  assert.equal(m.material.disposed, true);
  assert.equal(ctx.canvas.spritesStats, undefined);
  layer.frame(ctx, 1);
  layer.dispose(ctx);
});
