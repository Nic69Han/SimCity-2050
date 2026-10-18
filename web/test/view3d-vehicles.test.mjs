// The vehicles layer with a fake THREE and a fake context (the scene itself is not drawn here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLayer } from "../view3d-vehicles.js";
import { MAX_VEHICLES_3D, READ_INTERVAL } from "../view3d-vehicles-model.js";
import { cornerAltitudes } from "../view3d-model.js";
import { LAYERS } from "../view3d-layers.js";

const W = 6, H = 5;

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
  class BoxGeometry { constructor(...a) { this.args = a; this.disposed = false; } dispose() { this.disposed = true; } }
  class MeshLambertMaterial { constructor() { this.disposed = false; } dispose() { this.disposed = true; } }
  class InstancedBufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.usage = null; this.needsUpdate = false; }
    setUsage(u) { this.usage = u; }
  }
  return {
    Group, InstancedMesh, BoxGeometry, MeshLambertMaterial, InstancedBufferAttribute,
    DynamicDrawUsage: "dynamic",
  };
}

// A fake scene, canvas and context. `city` is what ctx.city() returns.
function fakeCtx(city) {
  const scene = {
    children: [],
    add(o) { this.children.push(o); },
    remove(o) { this.children = this.children.filter((c) => c !== o); },
  };
  const ctx = {
    THREE: fakeThree(),
    scene,
    canvas: {},
    renderRequests: 0,
    city: () => city,
    grid: () => ({ w: W, h: H }),
    corners: () => cornerAltitudes(new Uint8Array(W * H).fill(10), W, H),
    requestRender() { this.renderRequests++; },
  };
  return ctx;
}

// Records of a read: [id, kind, x16, y16, dir] per vehicle.
const records = (list) => Int32Array.from(list.flat());
const meshOf = (ctx) => ctx.scene.children[0];

test("dispose and frame before mount are harmless", () => {
  const layer = createLayer();
  layer.frame({ city: () => null }, 1);
  layer.dispose({ canvas: {}, scene: { remove() {} } });
});

test("registered as a light layer", () => {
  const l = LAYERS.find((x) => x.name === "vehicles");
  assert.equal(l.heavy, false);
});

test("nothing drawn without the engine API, and the layer does not read anything", () => {
  const ctx = fakeCtx({});
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  assert.equal(meshOf(ctx).count, 0);
  assert.equal(ctx.canvas.vehiclesStats().reads, 0);
  layer.dispose(ctx);
});

test("nothing drawn while agent_rules() is false, even if vehicles() exists", () => {
  let reads = 0;
  const city = {
    agent_rules: () => false,
    vehicles: () => { reads++; return records([[1, 0, 16, 16, 0]]); },
  };
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 1);
  assert.equal(meshOf(ctx).count, 0);
  assert.equal(reads, 0);
  assert.equal(ctx.canvas.vehiclesStats().vehicles, 0);
  layer.dispose(ctx);
});

test("count follows the read; reads happen at most every READ_INTERVAL seconds", () => {
  let reads = 0;
  const city = {
    agent_rules: () => true,
    vehicles: (max) => {
      reads++;
      assert.equal(max, MAX_VEHICLES_3D);
      return records([[1, 0, 24, 24, 1], [2, 1, 40, 8, 2], [3, 3, 8, 8, 0]]);
    },
  };
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 0.1);
  assert.equal(meshOf(ctx).count, 3);
  assert.equal(reads, 1);
  layer.frame(ctx, 0.1);
  assert.equal(reads, 1, "no read before the interval");
  layer.frame(ctx, READ_INTERVAL);
  assert.equal(reads, 2);
  assert.equal(ctx.canvas.vehiclesStats().reads, 2);
  assert.equal(ctx.canvas.vehiclesStats().drawn, 3);
  layer.dispose(ctx);
});

test("between reads the vehicles move from their previous to their new place", () => {
  let call = 0;
  const city = {
    agent_rules: () => true,
    // read 1: car at tile (0, 0) centre; read 2: at (2, 0) centre
    vehicles: () => (call++ === 0 ? records([[5, 0, 8, 8, 1]]) : records([[5, 0, 40, 8, 1]])),
  };
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 0.01); // first read: at (0.5, 0.5)
  layer.frame(ctx, READ_INTERVAL); // second read: prev (0.5) -> next (2.5), t = 0
  const mesh = meshOf(ctx);
  const x = () => mesh.instanceMatrix.array[12];
  assert.ok(Math.abs(x() - 0.5) < 1e-6, "at the start of the interval: the previous place");
  layer.frame(ctx, READ_INTERVAL / 2);
  assert.ok(Math.abs(x() - 1.5) < 1e-5, "halfway");
  layer.dispose(ctx);
});

test("requestRender only when something moved", () => {
  const city = { agent_rules: () => true, vehicles: () => records([[1, 0, 8, 8, 0]]) };
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, READ_INTERVAL); // a read: drawn
  const after = ctx.renderRequests;
  assert.ok(after >= 1);
  layer.frame(ctx, READ_INTERVAL); // a read: the vehicle is at its place: still a read, so drawn
  const mid = ctx.renderRequests;
  layer.frame(ctx, 0); // nothing moved between two frames at t = 1 with no read
  assert.equal(ctx.renderRequests, mid, "a frame where nothing moved does not request a render");
  layer.dispose(ctx);
});

test("dropped beyond capacity: 4000 drawn, the rest counted", () => {
  const list = Array.from({ length: MAX_VEHICLES_3D + 5 }, (_, i) => [i, 0, 8, 8, 0]);
  const city = { agent_rules: () => true, vehicles: () => records(list) };
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, 0.01);
  const s = ctx.canvas.vehiclesStats();
  assert.equal(meshOf(ctx).count, MAX_VEHICLES_3D);
  assert.equal(s.drawn, MAX_VEHICLES_3D);
  assert.equal(s.dropped, 5);
  assert.equal(s.vehicles, MAX_VEHICLES_3D + 5);
  layer.dispose(ctx);
});

test("the rule switched off hides the vehicles again", () => {
  let rule = true;
  const city = { agent_rules: () => rule, vehicles: () => records([[1, 0, 8, 8, 0]]) };
  const ctx = fakeCtx(city);
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, READ_INTERVAL);
  assert.equal(meshOf(ctx).count, 1);
  rule = false;
  layer.frame(ctx, READ_INTERVAL);
  assert.equal(meshOf(ctx).count, 0);
  layer.dispose(ctx);
});

test("dispose removes the mesh and the test hook", () => {
  const ctx = fakeCtx({ agent_rules: () => true, vehicles: () => records([[1, 0, 8, 8, 0]]) });
  const layer = createLayer();
  layer.mount(ctx);
  layer.frame(ctx, READ_INTERVAL);
  const mesh = meshOf(ctx);
  assert.equal(typeof ctx.canvas.vehiclesStats, "function");
  layer.dispose(ctx);
  assert.equal(ctx.scene.children.length, 0);
  assert.equal(mesh.disposed, true);
  assert.equal(mesh.geometry.disposed, true);
  assert.equal(mesh.material.disposed, true);
  assert.equal("vehiclesStats" in ctx.canvas, false);
  layer.dispose(ctx); // twice is harmless
});
