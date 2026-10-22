// 3D view layer of the highways (docs/game-design-v13.md, "Chantiers" 3D): an elevated grey deck over each
// highway tile, with thin pillars every PILLAR_EVERY tiles (view3d-highways-model.js holds the maths). Two
// InstancedMeshes of unit boxes: decks and pillars.
//
// Read only while city.highway_rules() is true (otherwise nothing is drawn and nothing is read). The highway
// bytes are read every update, and the meshes are rewritten only when the fingerprint of the bytes, the rule
// flag or the corners changed. A missing engine method = nothing drawn. Highway tiles past the capacity are
// dropped and counted. The layer never changes the city.
//
// Read-only hook (for the tests): canvas.highwaysStats() returns { tiles, decks, pillars, dropped, rebuilds }.
// Removed at dispose().
import { CAPACITY, highwayPlacements } from "./view3d-highways-model.js";
import { writeMatrix, layerKey, sameKey } from "./view3d-structures-model.js";

const EMPTY_STATS = Object.freeze({ tiles: 0, decks: 0, pillars: 0, dropped: 0, rebuilds: 0 });

function makeMesh(THREE) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), CAPACITY);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

const hasApi = (c) => typeof c?.highway_layer === "function" && typeof c?.highway_rules === "function";

// The highway bytes of an engine read as a typed array, or null; nothing is read while the rule is off.
function readHighways(city) {
  if (!city.highway_rules()) return { rules: false, data: null };
  const data = city.highway_layer();
  return { rules: true, data: ArrayBuffer.isView(data) ? data : null };
}

// Writes the instances of one mesh (count 0 when there is nothing to draw).
function writeMesh(mesh, items) {
  items.forEach((p, i) => {
    writeMatrix(mesh.instanceMatrix.array, i * 16, p);
    mesh.instanceColor.array.set(p.rgb, i * 3);
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}

export function createLayer() {
  // { ctx, decks, pillars, key, stats, rebuilds }
  let m = null;

  // Rebuilds the decks and pillars from the highway bytes (when the rule is on) and the terrain.
  function rebuild(ctx, { rules, data }, corners, grid, key) {
    m.key = key;
    const placed = rules && data
      ? highwayPlacements(data, corners, grid.w, grid.h)
      : { decks: [], pillars: [], tiles: 0, dropped: 0 };
    writeMesh(m.decks, placed.decks);
    writeMesh(m.pillars, placed.pillars);
    m.rebuilds++;
    m.stats = {
      tiles: placed.tiles, decks: placed.decks.length, pillars: placed.pillars.length,
      dropped: placed.dropped, rebuilds: m.rebuilds,
    };
    ctx.requestRender();
  }

  return {
    mount(ctx) {
      const { THREE } = ctx;
      const decks = makeMesh(THREE);
      const pillars = makeMesh(THREE);
      ctx.scene.add(decks);
      ctx.scene.add(pillars);
      m = { ctx, decks, pillars, key: null, stats: null, rebuilds: 0 };
      ctx.canvas.highwaysStats = () => (m?.stats ? { ...m.stats } : { ...EMPTY_STATS });
    },
    update(ctx) {
      if (!m) return;
      const grid = ctx.grid(), corners = ctx.corners(), city = ctx.city();
      if (!grid || !corners || !city || !hasApi(city)) return;
      const read = readHighways(city);
      const key = layerKey(read.data, read.rules, corners);
      if (sameKey(m.key, key)) return;
      rebuild(ctx, read, corners, grid, key);
    },
    dispose() {
      if (!m) return;
      const d = m;
      m = null;
      for (const mesh of [d.decks, d.pillars]) {
        d.ctx.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh.dispose?.();
      }
      delete d.ctx.canvas.highwaysStats;
    },
  };
}
