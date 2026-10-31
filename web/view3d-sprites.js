// 3D view layer of the moving objects (docs/game-design-v13.md, "Transports animés en 3D"): the engine's
// sprites (trains, planes, helicopters, ships, monster, tornado, explosion, bus) as simple coloured boxes, one
// InstancedMesh of unit boxes (view3d-sprites-model.js holds the maths).
//
// city.sprites() is read at most every READ_INTERVAL seconds, from frame(). Nothing is drawn when the engine
// method is missing (the mock engine has none). The layer never changes the city. Boxes past the capacity:
// the sprite is dropped and counted. Sprites are not interpolated: each read places them where the engine
// says.
//
// Read-only hook (for the tests): canvas.spritesStats() returns { sprites, boxes, dropped, reads }.
// Removed at dispose().
import { CAPACITY, shouldRead, spritePlacements } from "./view3d-sprites-model.js";
import { writeMatrix } from "./view3d-structures-model.js";

const hasApi = (c) => typeof c?.sprites === "function";

export function createLayer() {
  // { ctx, mesh, since, sprites, boxes, dropped, reads }
  let m = null;

  // Writes the boxes of the placements into the mesh (count 0 when there is nothing to draw).
  function writeBoxes(items) {
    const { mesh } = m;
    items.forEach((p, i) => {
      writeMatrix(mesh.instanceMatrix.array, i * 16, p);
      mesh.instanceColor.array.set(p.rgb, i * 3);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  // Reads the engine and draws its sprites; `g` the grid, `corners` the terrain.
  function read(ctx, city, g, corners) {
    const { items, drawn, dropped } = spritePlacements(city.sprites(), corners, g.w, g.h);
    writeBoxes(items);
    m.reads++;
    m.sprites = drawn;
    m.boxes = items.length;
    m.dropped = dropped;
    ctx.requestRender();
  }

  // Empties the mesh (no engine method, no grid or terrain yet).
  function hide() {
    m.sprites = 0;
    m.boxes = 0;
    m.dropped = 0;
    if (m.mesh.count === 0) return;
    m.mesh.count = 0;
    m.ctx.requestRender();
  }

  return {
    mount(ctx) {
      const { THREE } = ctx;
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshLambertMaterial();
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      ctx.scene.add(mesh);
      m = { ctx, mesh, since: Infinity, sprites: 0, boxes: 0, dropped: 0, reads: 0 };
      ctx.canvas.spritesStats = () => ({
        sprites: m.sprites, boxes: m.boxes, dropped: m.dropped, reads: m.reads,
      });
    },
    frame(ctx, seconds) {
      if (!m) return;
      m.since += Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      if (!shouldRead(m.since)) return;
      m.since = 0;
      const city = ctx.city(), g = ctx.grid(), corners = ctx.corners();
      if (!city || !g || !corners || !hasApi(city)) return hide();
      read(ctx, city, g, corners);
    },
    dispose() {
      if (!m) return;
      const d = m;
      m = null;
      d.ctx.scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
      d.mesh.dispose?.();
      delete d.ctx.canvas.spritesStats;
    },
  };
}
