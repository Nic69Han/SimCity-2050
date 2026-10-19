// The farms layer with a fake THREE and a fake context (the scene itself is not drawn here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../view3d-farms.js";
import { CAPACITY, FARM } from "../view3d-farms-model.js";
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

// A fake scene, canvas and context. `city` is what ctx.city() returns; `corners` the terrain.
function fakeCtx(city, corners = cornerAltitudes(new Uint8Array(W * H).fill(10), W, H)) {
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
    corners: () => corners,
    requestRender() { this.renderRequests++; },
  };
}

// A city whose density rule and layer the test controls. Counts the reads of density_layer().
function fakeCity({ rules = true, bytes = new Uint8Array(W * H) } = {}) {
  const city = {
    reads: 0,
    rules,
    bytes,
    density_rules: () => city.rules,
    density_layer: () => { city.reads++; return city.bytes; },
  };
  return city;
}

const mesh = (ctx) => ctx.scene.children[0];
const count = (ctx) => mesh(ctx).count;
const stats = (ctx) => ctx.canvas.farmsStats();
const farmBytes = (cells) => {
  const bytes = new Uint8Array(W * H);
  for (const [x, y] of cells) bytes[x * H + y] = FARM; // engine order: index = x * height + y
  return bytes;
};

test("dispose and update before mount are harmless", () => {
  const layer = createLayer();
  layer.update({ city: () => null }, { fresh: true, dirty: [] });
  layer.dispose({ canvas: {}, scene: { remove() {} } });
});

test("registered as a light layer named farms", () => {
  const l = LAYERS.find((x) => x.name === "farms");
  assert.equal(l.heavy, false);
});

test("one mesh of the capacity, in the scene, not culled, with its colours", () => {
  const ctx = fakeCtx(fakeCity({ rules: false }));
  const layer = createLayer();
  layer.mount(ctx);
  assert.equal(ctx.scene.children.length, 1);
  assert.equal(mesh(ctx).capacity, CAPACITY);
  assert.equal(mesh(ctx).frustumCulled, false);
  assert.equal(mesh(ctx).instanceColor.array.length, CAPACITY * 3);
  layer.dispose(ctx);
});

test("nothing is read and nothing drawn while density_rules() is false", () => {
  const city = fakeCity({ rules: false, bytes: farmBytes([[0, 0]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(city.reads, 0);
  assert.equal(count(ctx), 0);
  assert.deepEqual(stats(ctx), { farms: 0, instances: 0, dropped: 0, rebuilds: 1 });
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(stats(ctx).rebuilds, 1, "the same empty key: nothing rewritten");
  layer.dispose(ctx);
});

test("nothing drawn when the engine methods are missing", () => {
  const ctx = fakeCtx({ density_layer: () => farmBytes([[0, 0]]) });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(count(ctx), 0);
  assert.equal(stats(ctx).farms, 0);
  layer.dispose(ctx);
});

test("nothing read before the grid or the terrain is known", () => {
  const city = fakeCity({ bytes: farmBytes([[0, 0]]) });
  const ctx = fakeCtx(city);
  ctx.corners = () => null;
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(city.reads, 0);
  layer.dispose(ctx);
});

test("each farm tile is one instance: at its tile centre, in column-major order", () => {
  // farms at tile (1, 2) and tile (3, 0): the index of (1, 2) is 1 * 3 + 2 = 5
  const city = fakeCity({ bytes: farmBytes([[1, 2], [3, 0]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(count(ctx), 2);
  const m = mesh(ctx).instanceMatrix.array;
  assert.equal(m[12], 1.5, "first instance: x of tile (1, 2)");
  assert.equal(m[14], 2.5, "first instance: z of tile (1, 2)");
  assert.equal(m[16 + 12], 3.5, "second instance: x of tile (3, 0)");
  assert.equal(m[16 + 14], 0.5, "second instance: z of tile (3, 0)");
  assert.equal(mesh(ctx).instanceMatrix.needsUpdate, true);
  assert.equal(mesh(ctx).instanceColor.needsUpdate, true);
  assert.deepEqual(stats(ctx), { farms: 2, instances: 2, dropped: 0, rebuilds: 1 });
  assert.equal(ctx.renderRequests, 1);
  layer.dispose(ctx);
});

test("the farms are read every frame while the rule is on, rebuilt only when something changed", () => {
  const city = fakeCity({ bytes: farmBytes([[0, 0]]) });
  const corners = cornerAltitudes(new Uint8Array(W * H).fill(10), W, H);
  const ctx = fakeCtx(city, corners);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: false, dirty: [] });
  layer.update(ctx, { fresh: false, dirty: [] });
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(city.reads, 3);
  assert.equal(stats(ctx).rebuilds, 1, "same bytes: nothing rebuilt");
  city.bytes = farmBytes([[0, 0], [1, 1]]); // a farm appears
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(stats(ctx).rebuilds, 2);
  assert.equal(stats(ctx).farms, 2);
  ctx.corners = () => cornerAltitudes(new Uint8Array(W * H).fill(12), W, H); // new terrain
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(stats(ctx).rebuilds, 3);
  city.rules = false;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(stats(ctx).rebuilds, 4, "the rule switched off");
  assert.equal(count(ctx), 0);
  layer.dispose(ctx);
});

test("switching the rule off clears the fields; on again redraws them", () => {
  const city = fakeCity({ bytes: farmBytes([[2, 1]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(count(ctx), 1);
  city.rules = false;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(count(ctx), 0);
  city.rules = true;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(count(ctx), 1);
  layer.dispose(ctx);
});

test("a farm past the capacity is dropped and counted", () => {
  const cols = CAPACITY + 2;
  const corners = cornerAltitudes(new Uint8Array(cols), cols, 1);
  const city = fakeCity({ bytes: new Uint8Array(cols).fill(FARM) });
  const ctx = fakeCtx(city, corners);
  ctx.grid = () => ({ w: cols, h: 1 });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(count(ctx), CAPACITY);
  assert.deepEqual(stats(ctx), { farms: cols, instances: CAPACITY, dropped: 2, rebuilds: 1 });
  layer.dispose(ctx);
});

test("a read that is not a typed array draws nothing", () => {
  const city = fakeCity();
  city.density_layer = () => [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(stats(ctx).farms, 0);
  assert.equal(count(ctx), 0);
  layer.dispose(ctx);
});

test("dispose removes the mesh, disposes its geometry and material, and the hook", () => {
  const ctx = fakeCtx(fakeCity({ bytes: farmBytes([[0, 0]]) }));
  const layer = createLayer();
  layer.mount(ctx);
  const m = mesh(ctx);
  layer.dispose(ctx);
  assert.equal(ctx.scene.children.length, 0);
  assert.equal(m.geometry.disposed, true);
  assert.equal(m.material.disposed, true);
  assert.equal(m.disposed, true);
  assert.equal("farmsStats" in ctx.canvas, false);
  layer.dispose(ctx);
});
