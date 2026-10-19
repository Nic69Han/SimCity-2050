// 3D view layer of the farms (docs/game-design-v07.md, "Carte et 3D"). One InstancedMesh of unit boxes, one
// instance per farm tile of the engine's density layer: a thin field slab in one of two colours
// (view3d-farms-model.js holds the maths).
//
// Read only while city.density_rules() is true (otherwise nothing is drawn and nothing is read). The density
// bytes are read every frame (update() runs every frame) and the mesh is rewritten only when the fingerprint
// of the bytes, the rule flag or the corners changed. A missing engine method = nothing drawn. Farm tiles past
// the capacity are dropped and counted. The layer never changes the city.
//
// Read-only hook (for the tests): canvas.farmsStats() returns { farms, instances, dropped, rebuilds }.
// Removed at dispose().
import { CAPACITY, farmPlacements } from "./view3d-farms-model.js";
import { writeMatrix, layerKey, sameKey } from "./view3d-structures-model.js";

const EMPTY_STATS = Object.freeze({ farms: 0, instances: 0, dropped: 0, rebuilds: 0 });

function makeMesh(THREE) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), CAPACITY);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

const hasApi = (c) => typeof c?.density_layer === "function" && typeof c?.density_rules === "function";

// The density bytes of an engine read as a typed array, or null; nothing is read while the rule is off.
function readDensity(city) {
  if (!city.density_rules()) return { rules: false, data: null };
  const data = city.density_layer();
  return { rules: true, data: ArrayBuffer.isView(data) ? data : null };
}

export function createLayer() {
  // { ctx, mesh, key, stats, rebuilds }
  let m = null;

  // Writes the field instances (count 0 when there is nothing to draw).
  function writeInstances(items) {
    const { mesh } = m;
    items.forEach((p, i) => {
      writeMatrix(mesh.instanceMatrix.array, i * 16, p);
      mesh.instanceColor.array.set(p.rgb, i * 3);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  // Rebuilds the field instances from the density bytes (when the rule is on) and the terrain.
  function rebuild(ctx, { rules, data }, corners, grid, key) {
    m.key = key;
    const placed = rules && data ? farmPlacements(data, corners, grid.w, grid.h) : { items: [], farms: 0, dropped: 0 };
    writeInstances(placed.items);
    m.rebuilds++;
    m.stats = { farms: placed.farms, instances: placed.items.length, dropped: placed.dropped, rebuilds: m.rebuilds };
    ctx.requestRender();
  }

  return {
    mount(ctx) {
      const { THREE } = ctx;
      const mesh = makeMesh(THREE);
      ctx.scene.add(mesh);
      m = { ctx, mesh, key: null, stats: null, rebuilds: 0 };
      ctx.canvas.farmsStats = () => (m?.stats ? { ...m.stats } : { ...EMPTY_STATS });
    },
    update(ctx) {
      if (!m) return;
      const grid = ctx.grid(), corners = ctx.corners(), city = ctx.city();
      if (!grid || !corners || !city || !hasApi(city)) return;
      const read = readDensity(city);
      const key = layerKey(read.data, read.rules, corners);
      if (sameKey(m.key, key)) return;
      rebuild(ctx, read, corners, grid, key);
    },
    dispose() {
      if (!m) return;
      const d = m;
      m = null;
      d.ctx.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
      d.mesh.dispose?.();
      delete d.ctx.canvas.farmsStats;
    },
  };
}
