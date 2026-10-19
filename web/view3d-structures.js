// 3D view layer: the extended buildings (docs/game-design-v04.md). One InstancedMesh per shape (a unit
// box, cone or cylinder, scaled per instance; view3d-structures-model.js holds the maths): park and square
// slabs, park trees, the square's fountain, the monument's obelisk, and a grey block for unknown genres.
//
// Read only while city.structure_rules() is true (otherwise nothing is drawn and nothing is read). The
// records of city.structures() are read every frame (update() runs every frame) and the meshes are
// rewritten only when the fingerprint of the bytes, the rule flag or the corners changed. A missing
// engine method = nothing drawn. The layer never changes the city. Instances past a capacity are dropped
// and counted.
//
// Read-only hook (for the tests): canvas.structuresStats() returns { structures, instances, dropped,
// rebuilds }. Removed at dispose().
import {
  CAPACITY, KINDS, SHAPES, decodeStructures, layerKey, placementsFor, sameKey, writeMatrix,
} from "./view3d-structures-model.js";

// The unit geometry of each shape (the instance matrix scales it to the placement).
function geometryOf(THREE, shape) {
  switch (shape) {
    case SHAPES.TREE: return new THREE.ConeGeometry(0.5, 1, 8);
    case SHAPES.FOUNTAIN: return new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

function makeMesh(THREE, shape) {
  const capacity = CAPACITY[shape];
  const mesh = new THREE.InstancedMesh(geometryOf(THREE, shape), new THREE.MeshLambertMaterial(), capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

export function createLayer() {
  // { ctx, group, meshes, key, stats, rebuilds }
  let m = null;
  const hasApi = (c) => typeof c?.structures === "function" && typeof c?.structure_rules === "function";

  // Writes the instances of every shape into its mesh (count 0 for a shape with nothing to draw).
  function writeMeshes(items) {
    let instances = 0;
    for (const shape of KINDS) {
      const mesh = m.meshes[shape];
      const list = items[shape];
      list.forEach((p, i) => {
        writeMatrix(mesh.instanceMatrix.array, i * 16, p);
        mesh.instanceColor.array.set(p.rgb, i * 3);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      instances += list.length;
    }
    return instances;
  }

  // Rebuilds the meshes from the records (when the rule is on) and the terrain.
  function rebuild(ctx, data, rules, corners, h, key) {
    m.key = key;
    const records = rules && data ? decodeStructures(data) : [];
    const { items, structures, dropped } = placementsFor(records, corners, h);
    const instances = writeMeshes(items);
    m.rebuilds++;
    m.stats = { structures, instances, dropped, rebuilds: m.rebuilds };
    ctx.requestRender();
  }

  // The records of the engine as an Int32Array, or null when the rule is off or the read is not one.
  function readRecords(city) {
    if (!city.structure_rules()) return { rules: false, data: null };
    const data = city.structures();
    return { rules: true, data: ArrayBuffer.isView(data) ? data : null };
  }

  return {
    mount(ctx) {
      const { THREE } = ctx;
      const group = new THREE.Group();
      const meshes = {};
      for (const shape of KINDS) {
        meshes[shape] = makeMesh(THREE, shape);
        group.add(meshes[shape]);
      }
      ctx.scene.add(group);
      m = { ctx, group, meshes, key: null, stats: null, rebuilds: 0 };
      ctx.canvas.structuresStats = () => (m?.stats ? { ...m.stats } : { structures: 0, instances: 0, dropped: 0, rebuilds: 0 });
    },
    update(ctx) {
      if (!m) return;
      const g = ctx.grid(), corners = ctx.corners(), city = ctx.city();
      if (!g || !corners || !city || !hasApi(city)) return;
      const { rules, data } = readRecords(city);
      const key = layerKey(data, rules, corners);
      if (sameKey(m.key, key)) return;
      rebuild(ctx, data, rules, corners, g.h, key);
    },
    dispose() {
      if (!m) return;
      const d = m;
      m = null;
      d.ctx.scene.remove(d.group);
      for (const mesh of Object.values(d.meshes)) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh.dispose?.();
      }
      delete d.ctx.canvas.structuresStats;
    },
  };
}
