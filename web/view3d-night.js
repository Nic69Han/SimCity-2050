// 3D view layer: the night lights (docs/game-design-v14.md, "Nuit"). Small glowing boxes: the lit windows of
// the zone volumes (ctx.chunkVolumes) and of the powered extended buildings (city.structures()), and a post
// with a glowing head on every LAMP_SPACING-th road tile. The placements are in view3d-night-model.js.
//
// The strength of the night is 1 - ctx.scene.userData.daylight (written by view3d-ambiance.js; absent = day),
// applied in frame(): the meshes are hidden at intensity 0, and the colour and opacity of the lit parts follow
// the intensity. The materials are MeshBasicMaterial: no light is added to the scene, nothing else is drawn.
// The placements are rebuilt only when the terrain changed (change.fresh or dirty chunks), or when the
// structure records or the corners changed. A missing engine method = no lit windows from the buildings.
//
// Read-only hook (for the tests): canvas.nightStats() returns { intensity, windows, lamps, dropped }.
// Removed at dispose().
import {
  LAMP_CAPACITY, LAMP_POST_COLOUR, WINDOW_CAPACITY, WINDOW_DIM, WINDOW_LIT,
  intensityOf, lampPlacements, windowPlacements,
} from "./view3d-night-model.js";
import { decodeStructures, layerKey, sameKey, writeMatrix } from "./view3d-structures-model.js";
import { mixHex } from "./view3d-ambiance-model.js";

const hasStructureApi = (c) => typeof c?.structures === "function" && typeof c?.structure_rules === "function";

// The structure records of the engine as decoded objects, or [] when the rule is off or the read is not one.
function readRecords(city) {
  if (!hasStructureApi(city) || !city.structure_rules()) return { rules: false, data: null };
  const data = city.structures();
  return { rules: true, data: ArrayBuffer.isView(data) ? data : null };
}

function makeMesh(THREE, geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

// Writes the matrices of the placements into the mesh (count = how many are drawn).
function writeItems(mesh, items) {
  items.forEach((p, i) => writeMatrix(mesh.instanceMatrix.array, i * 16, p));
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
}

export function createLayer() {
  // { ctx, group, windows, posts, heads, key, intensity, dropped }
  let m = null;

  // Rebuilds every placement from the chunk volumes, the structure records and the lamp tiles.
  function rebuild(ctx, key, records) {
    const grid = ctx.grid(), corners = ctx.corners();
    const volumeLists = [];
    for (let c = 0; c < grid.count; c++) volumeLists.push(ctx.chunkVolumes(c));
    const win = windowPlacements({ volumeLists, records, corners, w: grid.w, h: grid.h }, WINDOW_CAPACITY);
    const tiles = ctx.snapshot?.()?.tiles ?? null;
    const lamps = tiles ? lampPlacements(tiles, corners, grid.w, grid.h, LAMP_CAPACITY) : { posts: [], heads: [], dropped: 0 };
    writeItems(m.windows, win.items);
    writeItems(m.posts, lamps.posts);
    writeItems(m.heads, lamps.heads);
    m.key = key;
    m.dropped = win.dropped + lamps.dropped;
    ctx.requestRender();
  }

  // Hides or shows the meshes and sets the colour and opacity of the lit parts for intensity I (0..1).
  function apply(I) {
    m.intensity = I;
    const on = I > 0;
    m.windows.visible = on;
    m.posts.visible = on;
    m.heads.visible = on;
    m.windows.material.color.setHex(mixHex(WINDOW_DIM, WINDOW_LIT, I));
    m.windows.material.opacity = I;
    m.heads.material.color.setHex(mixHex(WINDOW_DIM, WINDOW_LIT, I));
    m.heads.material.opacity = I;
  }

  return {
    mount(ctx) {
      const { THREE } = ctx;
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const windows = makeMesh(THREE, geometry,
        new THREE.MeshBasicMaterial({ color: WINDOW_DIM, transparent: true, opacity: 0 }), WINDOW_CAPACITY);
      const posts = makeMesh(THREE, geometry, new THREE.MeshBasicMaterial({ color: LAMP_POST_COLOUR }), LAMP_CAPACITY);
      const heads = makeMesh(THREE, geometry,
        new THREE.MeshBasicMaterial({ color: WINDOW_DIM, transparent: true, opacity: 0 }), LAMP_CAPACITY);
      const group = new THREE.Group();
      group.add(windows, posts, heads);
      ctx.scene.add(group);
      m = { ctx, group, geometry, windows, posts, heads, key: null, intensity: 0, dropped: 0 };
      apply(intensityOf(ctx.scene.userData?.daylight));
      ctx.canvas.nightStats = () => (m
        ? { intensity: m.intensity, windows: m.windows.count, lamps: m.posts.count, dropped: m.dropped }
        : { intensity: 0, windows: 0, lamps: 0, dropped: 0 });
    },
    // change: { fresh, dirty } from view3d.js; the placements follow the terrain and the structure records
    update(ctx, change) {
      if (!m) return;
      const grid = ctx.grid(), corners = ctx.corners(), city = ctx.city();
      if (!grid || !corners || !city) return;
      const { rules, data } = readRecords(city);
      const key = layerKey(data, rules, corners);
      if (!change?.fresh && !change?.dirty?.length && sameKey(m.key, key)) return;
      rebuild(ctx, key, rules && data ? decodeStructures(data) : []);
    },
    frame(ctx) {
      if (!m) return;
      apply(intensityOf(ctx.scene.userData?.daylight));
    },
    dispose() {
      if (!m) return;
      const d = m;
      m = null;
      d.ctx.scene.remove(d.group);
      d.geometry.dispose();
      for (const mesh of [d.windows, d.posts, d.heads]) {
        mesh.material.dispose();
        mesh.dispose?.();
      }
      delete d.ctx.canvas.nightStats;
    },
  };
}
