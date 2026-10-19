// The extended buildings layer with a fake THREE and a fake context (the scene itself is not drawn here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../view3d-structures.js";
import { CAPACITY, KINDS, TREES_PER_TILE } from "../view3d-structures-model.js";
import { cornerAltitudes } from "../view3d-model.js";
import { LAYERS } from "../view3d-layers.js";

const W = 8, H = 6;

class FakeArray {
  constructor(n) { this.array = new Float32Array(n); this.usage = null; this.needsUpdate = false; }
  setUsage(u) { this.usage = u; }
}

function fakeThree() {
  class Group { constructor() { this.children = []; } add(o) { this.children.push(o); } }
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
  class ConeGeometry extends Geometry {}
  class CylinderGeometry extends Geometry {}
  class MeshLambertMaterial { constructor() { this.disposed = false; } dispose() { this.disposed = true; } }
  class InstancedBufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.usage = null; this.needsUpdate = false; }
    setUsage(u) { this.usage = u; }
  }
  return {
    Group, InstancedMesh, BoxGeometry, ConeGeometry, CylinderGeometry, MeshLambertMaterial,
    InstancedBufferAttribute, DynamicDrawUsage: "dynamic",
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

// A city whose structure rule and records the test controls. Counts the reads of structures().
function fakeCity({ rules = true, data = Int32Array.from([]) } = {}) {
  const city = {
    reads: 0,
    rules,
    data,
    structure_rules: () => city.rules,
    structures: () => { city.reads++; return city.data; },
  };
  return city;
}

const records = (list) => Int32Array.from(list.flat());
const meshes = (ctx) => ctx.scene.children[0].children;
const meshOf = (ctx, shape) => meshes(ctx)[KINDS.indexOf(shape)];
const counts = (ctx) => Object.fromEntries(KINDS.map((k, i) => [k, meshes(ctx)[i].count]));

test("dispose and update before mount are harmless", () => {
  const layer = createLayer();
  layer.update({ city: () => null }, { fresh: true, dirty: [] });
  layer.dispose({ canvas: {}, scene: { remove() {} } });
});

test("registered as a light layer", () => {
  const l = LAYERS.find((x) => x.name === "structures");
  assert.equal(l.heavy, false);
});

test("one mesh per shape, sized to the capacity of the shape, in the scene", () => {
  const ctx = fakeCtx(fakeCity({ rules: false }));
  const layer = createLayer();
  layer.mount(ctx);
  assert.equal(ctx.scene.children.length, 1);
  assert.equal(meshes(ctx).length, KINDS.length);
  for (const k of KINDS) {
    const mesh = meshOf(ctx, k);
    assert.equal(mesh.capacity, CAPACITY[k], k);
    assert.equal(mesh.frustumCulled, false);
    assert.equal(mesh.instanceColor.array.length, CAPACITY[k] * 3);
  }
  layer.dispose(ctx);
});

test("nothing is read and nothing drawn while structure_rules() is false", () => {
  const city = fakeCity({ rules: false, data: records([[1, 0, 0, 2, 2, 0]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(city.reads, 0);
  assert.deepEqual(counts(ctx), Object.fromEntries(KINDS.map((k) => [k, 0])));
  // the first frame clears the (empty) meshes once; later frames with the same key rewrite nothing
  assert.deepEqual(ctx.canvas.structuresStats(), { structures: 0, instances: 0, dropped: 0, rebuilds: 1 });
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(ctx.canvas.structuresStats().rebuilds, 1);
  layer.dispose(ctx);
});

test("nothing drawn when the engine methods are missing", () => {
  const ctx = fakeCtx({ structures: () => records([[1, 0, 0, 2, 2, 0]]) });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(ctx.canvas.structuresStats().structures, 0);
  assert.equal(counts(ctx).slab, 0);
  layer.dispose(ctx);
});

test("nothing drawn before the grid or the terrain is known", () => {
  const city = fakeCity({ data: records([[1, 0, 0, 2, 2, 0]]) });
  const ctx = fakeCtx(city);
  ctx.corners = () => null;
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(city.reads, 0);
  layer.dispose(ctx);
});

test("a park, a square and a monument are drawn in their meshes, with the stats", () => {
  const city = fakeCity({ data: records([[1, 0, 0, 2, 2, 3], [2, 4, 0, 1, 1, 0], [3, 0, 3, 3, 3, 0]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.deepEqual(counts(ctx), { slab: 3, tree: 2 * 2 * TREES_PER_TILE, fountain: 1, obelisk: 1, block: 0 });
  assert.deepEqual(ctx.canvas.structuresStats(), {
    structures: 3, instances: 3 + 16 + 1 + 1, dropped: 0, rebuilds: 1,
  });
  assert.equal(ctx.renderRequests, 1);
  layer.dispose(ctx);
});

test("the matrices and colours of the instances are written", () => {
  const city = fakeCity({ data: records([[2, 1, 1, 1, 1, 0]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  const slab = meshOf(ctx, "slab");
  assert.equal(slab.instanceMatrix.array[12], 1.5, "x of the centre");
  assert.equal(slab.instanceMatrix.array[14], 1.5, "z of the centre");
  assert.equal(slab.instanceMatrix.needsUpdate, true);
  assert.equal(slab.instanceColor.needsUpdate, true);
  assert.equal(meshOf(ctx, "fountain").count, 1);
  layer.dispose(ctx);
});

test("the rebuild happens only when the bytes, the rule or the corners change", () => {
  const city = fakeCity({ data: records([[2, 1, 1, 1, 1, 0]]) });
  const corners = cornerAltitudes(new Uint8Array(W * H).fill(10), W, H);
  const ctx = fakeCtx(city, corners);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: false, dirty: [] });
  layer.update(ctx, { fresh: false, dirty: [] });
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(city.reads, 3, "the records are read every frame while the rule is on");
  assert.equal(ctx.canvas.structuresStats().rebuilds, 1, "same bytes: nothing rebuilt");
  city.data = records([[2, 1, 1, 1, 1, 1]]); // the state changed
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(ctx.canvas.structuresStats().rebuilds, 2);
  ctx.corners = () => cornerAltitudes(new Uint8Array(W * H).fill(12), W, H); // new terrain
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(ctx.canvas.structuresStats().rebuilds, 3);
  city.rules = false;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(ctx.canvas.structuresStats().rebuilds, 4, "the rule switched off");
  assert.equal(counts(ctx).slab, 0);
  layer.dispose(ctx);
});

test("switching the rule off clears the drawn instances; on again redraws them", () => {
  const city = fakeCity({ data: records([[1, 0, 0, 2, 2, 0]]) });
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(counts(ctx).slab, 1);
  city.rules = false;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(counts(ctx).slab, 0);
  assert.equal(counts(ctx).tree, 0);
  city.rules = true;
  layer.update(ctx, { fresh: false, dirty: [] });
  assert.equal(counts(ctx).slab, 1);
  assert.equal(counts(ctx).tree, 4 * TREES_PER_TILE);
  layer.dispose(ctx);
});

test("a structure past the capacity of its shape is dropped and counted", () => {
  const n = CAPACITY.slab + 2; // parks: one slab each
  const cols = 2 * n;
  const corners = cornerAltitudes(new Uint8Array(cols * 2), cols, 2);
  const city = fakeCity({ data: records(Array.from({ length: n }, (_, i) => [1, 2 * i, 0, 2, 2, 0])) });
  const ctx = fakeCtx(city, corners);
  ctx.grid = () => ({ w: cols, h: 2 });
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  const stats = ctx.canvas.structuresStats();
  assert.equal(counts(ctx).slab, CAPACITY.slab);
  assert.equal(counts(ctx).tree, CAPACITY.tree);
  assert.equal(stats.structures, n);
  assert.equal(stats.dropped, 2 + (n * 4 * TREES_PER_TILE - CAPACITY.tree));
  assert.equal(stats.instances, CAPACITY.slab + CAPACITY.tree);
  layer.dispose(ctx);
});

test("a read that is not a typed array draws nothing", () => {
  const city = fakeCity();
  city.structures = () => [1, 0, 0, 2, 2, 0];
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.update(ctx, { fresh: true, dirty: [] });
  assert.equal(ctx.canvas.structuresStats().structures, 0);
  layer.dispose(ctx);
});

test("dispose removes the group, disposes geometries and materials, and the hook", () => {
  const ctx = fakeCtx(fakeCity({ data: records([[1, 0, 0, 2, 2, 0]]) }));
  const layer = createLayer();
  layer.mount(ctx);
  const group = ctx.scene.children[0];
  const all = [...group.children];
  layer.dispose(ctx);
  assert.equal(ctx.scene.children.length, 0);
  for (const mesh of all) {
    assert.equal(mesh.geometry.disposed, true);
    assert.equal(mesh.material.disposed, true);
    assert.equal(mesh.disposed, true);
  }
  assert.equal("structuresStats" in ctx.canvas, false);
  layer.dispose(ctx);
});
