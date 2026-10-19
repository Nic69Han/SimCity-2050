// 3D view layer: the simulated vehicles (docs/game-design-v03.md, v0.5 sizes per kind). One InstancedMesh
// of unit boxes, one instance per vehicle, coloured and scaled by kind (view3d-vehicles-model.js holds
// the maths).
//
// City.vehicles(MAX_VEHICLES_3D) is read at most every READ_INTERVAL seconds, and only while
// city.agent_rules() is true; between two reads each vehicle moves from its previous place to its new
// one. Nothing is drawn (count 0) when the engine API is missing or the rule is off. The layer never
// changes the city. A vehicle past the capacity is dropped and counted.
//
// Read-only hook (for the tests): canvas.vehiclesStats() returns { vehicles, drawn, dropped, reads }.
// Removed at dispose().
import {
  MAX_VEHICLES_3D, READ_INTERVAL, buildPlacements, decodeVehicles, interpolate, shouldRead,
  writeVehicleMatrix,
} from "./view3d-vehicles-model.js";

export function createLayer() {
  // { ctx, mesh, prev, next, since, t, enabled, dropped, reads, group }
  let m = null;
  const hasApi = (c) => typeof c?.vehicles === "function" && typeof c?.agent_rules === "function";

  // Reads the engine (when due): the previous read becomes `prev`, the new one `next`.
  function read(city) {
    if (!hasApi(city) || !city.agent_rules()) {
      m.enabled = false;
      m.prev = [];
      m.next = [];
      return false;
    }
    m.enabled = true;
    m.prev = m.next;
    m.next = decodeVehicles(city.vehicles(MAX_VEHICLES_3D));
    m.reads++;
    return true;
  }

  // Writes the matrices and colours of the vehicles at fraction t between prev and next.
  function draw(ctx, g, corners, t) {
    const mesh = m.mesh;
    const vehicles = interpolate(m.prev, m.next, t);
    const { items, dropped } = buildPlacements({ w: g.w, h: g.h, vehicles, corners });
    items.forEach((p, i) => {
      writeVehicleMatrix(mesh.instanceMatrix.array, i * 16, p, p.size);
      mesh.instanceColor.array.set(p.rgb, i * 3);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    m.dropped = dropped;
    m.t = t;
    ctx.requestRender();
  }

  function hide() {
    m.dropped = 0;
    m.t = null;
    if (m.mesh.count === 0) return;
    m.mesh.count = 0;
    m.ctx.requestRender();
  }

  return {
    mount(ctx) {
      const { THREE } = ctx;
      const capacity = MAX_VEHICLES_3D;
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshLambertMaterial();
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      ctx.scene.add(mesh);
      m = {
        ctx, mesh, prev: [], next: [], since: Infinity, t: null, enabled: false, dropped: 0, reads: 0,
      };
      ctx.canvas.vehiclesStats = () => ({
        vehicles: m.next.length, drawn: m.mesh.count, dropped: m.dropped, reads: m.reads,
      });
    },
    frame(ctx, seconds) {
      if (!m) return;
      m.since += Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      const city = ctx.city();
      const g = ctx.grid(), corners = ctx.corners();
      if (!city || !g || !corners) return hide();
      let moved = false;
      if (shouldRead(m.since)) {
        m.since = 0;
        read(city);
        moved = true;
      }
      if (!m.enabled) return hide();
      const t = Math.min(1, m.since / READ_INTERVAL);
      if (!moved && t === m.t) return;
      draw(ctx, g, corners, t);
    },
    dispose() {
      if (!m) return;
      const d = m;
      m = null;
      d.ctx.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
      d.mesh.dispose?.();
      delete d.ctx.canvas.vehiclesStats;
    },
  };
}
