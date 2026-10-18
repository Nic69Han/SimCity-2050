// 3D view layer: the underground networks (docs/game-design-v02b.md, "Sous-sol en 3D"). Draws what
// City.water_layer() and City.transit_layer() report: pipes (thin blue boxes just under the ground),
// pumps (small blue towers), tunnels (thicker boxes deeper, orange on a working line) and stations
// (small buildings). One InstancedMesh per kind, capacities in view3d-underground-model.js.
//
// Rebuilt only when the layer bytes, the rule flags or the terrain corners changed (update() runs
// every frame; a fingerprint of the bytes is compared). A missing engine method = nothing drawn.
//
// Button «Sous-sol» in #view3d-controls: while on, the opaque lit materials found in ctx.scene (terrain
// chunks, building volumes) are made translucent so the networks show through; each one is restored
// when the button is released and at dispose(). Nothing in view3d.js is touched.
//
// Read-only hook (for the tests): canvas.undergroundStats() returns { pipeTiles, pumpTiles,
// tunnelTiles, stationTiles, instances: {pipe, pump, tunnel, station}, dropped, seeThrough, rebuilds }.
// Removed at dispose().
import {
  CAPACITY, KINDS, SEE_THROUGH_OPACITY, buildPlacements, layerKey, sameKey, writeMatrix,
} from "./view3d-underground-model.js";

export function createLayer() {
  let m = null; // { ctx, meshes, group, wrap, button, container, wasHidden, saved, key, stats, seeThrough }
  const hasWater = (c) => typeof c?.water_rules === "function" && typeof c?.water_layer === "function";
  const hasTransit = (c) => typeof c?.transit_rules === "function" && typeof c?.transit_layer === "function";

  function rebuild(ctx, city, g, corners) {
    const water = hasWater(city) && city.water_rules() ? city.water_layer() : null;
    const transit = hasTransit(city) && city.transit_rules() ? city.transit_layer() : null;
    const key = layerKey(water, transit, corners);
    if (sameKey(m.key, key)) return;
    m.key = key;
    const { items, tiles, dropped } = buildPlacements({ w: g.w, h: g.h, water, transit, corners });
    const instances = {};
    for (const kind of KINDS) {
      const mesh = m.meshes[kind];
      items[kind].forEach((p, i) => {
        writeMatrix(mesh.instanceMatrix.array, i * 16, p);
        mesh.instanceColor.array.set(p.rgb, i * 3);
      });
      mesh.count = items[kind].length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      instances[kind] = mesh.count;
    }
    m.stats = {
      pipeTiles: tiles.pipe, pumpTiles: tiles.pump, tunnelTiles: tiles.tunnel, stationTiles: tiles.station,
      instances, dropped, rebuilds: (m.stats?.rebuilds ?? 0) + 1,
    };
    ctx.requestRender();
  }

  // Makes the opaque lit materials of the scene (not ours) translucent, remembering their state.
  function applySeeThrough() {
    m.ctx.scene.traverse((o) => {
      if (!o.isMesh || m.group.children.includes(o)) return;
      for (const mat of [].concat(o.material)) {
        if (!mat?.isMeshLambertMaterial || mat.transparent || m.saved.has(mat)) continue;
        m.saved.set(mat, { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite });
        mat.transparent = true;
        mat.opacity = SEE_THROUGH_OPACITY;
        mat.depthWrite = false;
        mat.needsUpdate = true;
      }
    });
  }

  function restoreMaterials() {
    for (const [mat, s] of m.saved) {
      mat.transparent = s.transparent;
      mat.opacity = s.opacity;
      mat.depthWrite = s.depthWrite;
      mat.needsUpdate = true;
    }
    m.saved.clear();
  }

  function setSeeThrough(on) {
    m.seeThrough = on;
    m.button.setAttribute("aria-pressed", String(on));
    if (on) applySeeThrough();
    else restoreMaterials();
    m.ctx.requestRender();
  }

  return {
    mount(ctx) {
      const container = document.getElementById("view3d-controls");
      if (!container) throw new Error("view3d-underground: #view3d-controls is missing from the page");
      const { THREE } = ctx;
      const group = new THREE.Group();
      const meshes = {};
      for (const kind of KINDS) {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshLambertMaterial();
        const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY[kind]);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY[kind] * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
        group.add(mesh);
        meshes[kind] = mesh;
      }
      ctx.scene.add(group);
      const wrap = document.createElement("div");
      wrap.className = "view3d-underground";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Sous-sol";
      button.title = "Voir les canalisations et le métro à travers le terrain et les bâtiments";
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => setSeeThrough(!m.seeThrough));
      wrap.append(button);
      const wasHidden = container.hidden;
      container.append(wrap);
      container.hidden = false;
      m = { ctx, meshes, group, wrap, button, container, wasHidden, saved: new Map(), key: null, stats: null, seeThrough: false };
      ctx.canvas.undergroundStats = () => (m?.stats ? { ...m.stats, instances: { ...m.stats.instances }, seeThrough: m.seeThrough } : null);
    },
    update(ctx, change) {
      if (!m) return;
      const g = ctx.grid(), corners = ctx.corners(), city = ctx.city();
      if (!g || !corners || !city) return;
      rebuild(ctx, city, g, corners);
      // new surfaces (a rebuilt terrain, models) may have appeared: keep them see-through too
      if (m.seeThrough && (change.fresh || change.dirty.length)) applySeeThrough();
    },
    dispose() {
      if (!m) return;
      restoreMaterials();
      const d = m;
      m = null;
      d.ctx.scene.remove(d.group);
      for (const mesh of Object.values(d.meshes)) {
        mesh.geometry.dispose();
        mesh.material.dispose();
        mesh.dispose?.();
      }
      d.wrap.remove();
      if (d.wasHidden) d.container.hidden = true;
      delete d.ctx.canvas.undergroundStats;
    },
  };
}
