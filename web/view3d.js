// 3D view (presentation only, ARCHITECTURE.md rule 5): a read-only adapter of the engine, like
// render.js. It holds geometry, never game state. Loaded by main.js only when «Vue 3D» is pressed
// (dynamic import), so Three.js (web/vendor/) is not downloaded by the default page.
//
// mount(api, canvas) starts the scene on the canvas, update(api) brings it up to date with the city
// (only the chunks whose tiles or altitudes changed are rebuilt), dispose() releases everything.
// surface() is the pointer and outline surface the tools use while the view is shown (tools.js).
// The pure parts (geometry, classification, picking maths) are in view3d-model.js.
//
// Layers (docs/game-design.md): view3d-layers.js lists modules whose createLayer() returns an object
// with optional mount(ctx), update(ctx, change), frame(ctx, seconds) and dispose(ctx). A layer adds
// to the scene through ctx; this file does not know what layers draw. A layer with frame() turns on
// the animation loop, which stops at dispose().
import * as THREE from "./vendor/three.module.min.js";
import { OrbitControls } from "./vendor/OrbitControls.js";
import {
  chunkGrid, dirtyChunks, altitudesOf, cornerAltitudes, buildChunk, writeVolumeMatrix, pickTile,
  footprintTop, tileCentreY, frameSeconds, SLOTS, WATER_Y,
} from "./view3d-model.js";
import { LAYERS } from "./view3d-layers.js";

const KINDS = ["residential", "commercial", "industrial", "tree"];
const SKY = 0xbcd6ea;
const WATER = 0x2a5fb0;
const OK_COLOUR = 0x1e8e3e;
const BAD_COLOUR = 0xd93025;
const PAN_MARGIN = 4; // the orbit target may move this far past the map edges

let view = null; // the mounted view, or null

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Starts the scene on `canvas` for the city `api`. Replaces a view already mounted.
export function mount(api, canvas) {
  dispose();
  // vertex and material colours are the palette's sRGB values, used as they are
  THREE.ColorManagement.enabled = false;
  const w = api.width(), h = api.height();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 4000);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x4a5568, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.target.position.set(w / 2, 0, h / 2);
  sun.position.set(w / 2 - 60, 90, h / 2 + 40);
  scene.add(sun, sun.target);
  const group = new THREE.Group();
  scene.add(group);

  const outlineMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: OK_COLOUR, transparent: true, opacity: 0.4, depthTest: false }),
  );
  outlineMesh.visible = false;
  outlineMesh.renderOrder = 10;
  scene.add(outlineMesh);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; // the view renders when something changes, not in a loop
  controls.minDistance = 4;
  controls.maxDistance = Math.max(w, h) * 1.6;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // never below the ground

  const target = new THREE.Vector3(w / 2, 0, h / 2);
  const distance = Math.max(w, h) * 1.1;
  const polar = 0.95, azimuth = 0.35;
  controls.target.copy(target);
  camera.position.set(
    target.x + distance * Math.sin(polar) * Math.sin(azimuth),
    target.y + distance * Math.cos(polar),
    target.z + distance * Math.sin(polar) * Math.cos(azimuth),
  );

  view = {
    canvas, renderer, scene, camera, controls, group, outlineMesh,
    raycaster: new THREE.Raycaster(),
    materials: {
      terrain: new THREE.MeshLambertMaterial({ vertexColors: true }),
      volume: new THREE.MeshLambertMaterial(),
      water: new THREE.MeshLambertMaterial({ color: WATER, transparent: true, opacity: 0.55, depthWrite: false }),
      ok: new THREE.MeshBasicMaterial({ color: OK_COLOUR, transparent: true, opacity: 0.4, depthTest: false }),
      bad: new THREE.MeshBasicMaterial({ color: BAD_COLOUR, transparent: true, opacity: 0.4, depthTest: false }),
    },
    grid: null, snapshot: null, corners: null, tops: null, maxTop: 0,
    chunks: [], instances: {}, water: null, frameId: null, observer: null,
    lights: { hemi, sun }, chunkVolumes: [], hiddenKinds: new Set(), layers: [], ctx: null, loopId: null,
  };
  outlineMesh.material = view.materials.ok;
  // the orbit control takes the left button only while no tool is selected (a tool drag builds)
  controls.addEventListener("change", () => {
    const g = view.grid;
    if (g) {
      const t = controls.target;
      t.x = clamp(t.x, -PAN_MARGIN, g.w + PAN_MARGIN);
      t.z = clamp(t.z, -PAN_MARGIN, g.h + PAN_MARGIN);
      t.y = 0;
    }
    requestRender();
  });
  controls.update();

  view.observer = new ResizeObserver(() => resize());
  view.observer.observe(canvas);
  canvas.tileScreen = screenOf; // the page's tests read where a tile is on the screen
  view.ctx = makeContext();
  for (const module of LAYERS) {
    const layer = module.createLayer();
    view.layers.push(layer);
    layer.mount?.(view.ctx);
  }
  if (view.layers.some((l) => typeof l.frame === "function")) startLoop();
  resize();
}

// Brings the scene up to date with the city: only the chunks that changed are rebuilt.
export function update(api) {
  if (!view) return;
  const w = api.width(), h = api.height();
  const tiles = api.tiles();
  const heights = typeof api.heights === "function" ? api.heights() : null;
  const alt = altitudesOf(tiles, heights, w, h);
  const snapshot = { w, h, tiles, alt };
  const fresh = !view.grid || view.grid.w !== w || view.grid.h !== h;
  if (fresh) resetTerrain(chunkGrid(w, h));
  const dirty = dirtyChunks(fresh ? null : view.snapshot, snapshot, view.grid);
  view.snapshot = snapshot;
  if (dirty.length) {
    view.corners = cornerAltitudes(alt, w, h);
    for (const kind of KINDS) view.instances[kind].mesh.instanceMatrix.clearUpdateRanges();
    for (const kind of KINDS) view.instances[kind].mesh.instanceColor.clearUpdateRanges();
    for (const c of dirty) rebuildChunk(c);
    let maxTop = 0;
    for (const t of view.tops) if (t > maxTop) maxTop = t;
    view.maxTop = maxTop;
    for (const kind of KINDS) {
      const { mesh } = view.instances[kind];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }
  const change = { fresh, dirty };
  for (const layer of view.layers) layer.update?.(view.ctx, change);
  requestRender();
}

// Releases the scene, the controls and the WebGL resources. Safe to call when not mounted.
export function dispose() {
  if (!view) return;
  const v = view;
  view = null;
  for (const layer of [...v.layers].reverse()) layer.dispose?.(v.ctx);
  if (v.loopId !== null) cancelAnimationFrame(v.loopId);
  v.observer?.disconnect();
  v.controls.dispose();
  if (v.frameId !== null) cancelAnimationFrame(v.frameId);
  disposeGroup(v);
  for (const m of Object.values(v.materials)) m.dispose();
  v.outlineMesh.geometry.dispose();
  v.renderer.dispose();
  delete v.canvas.tileScreen;
}

// The surface the tools use (see tools.js useSurface). Valid while mounted.
export function surface() {
  return {
    canvas: view.canvas,
    tileOf: tileOf,
    clear() {
      view.outlineMesh.visible = false;
      requestRender();
    },
    // tool_preview's verdict: result 1 (OK) is a green outline, anything else red
    outline(fp, preview) {
      const r = footprintTop(view.tops, view.grid, fp);
      if (r.x1 <= r.x0 || r.y1 <= r.y0) return this.clear();
      const m = view.outlineMesh;
      m.material = preview[0] === 1 ? view.materials.ok : view.materials.bad;
      m.position.set((r.x0 + r.x1) / 2, r.top + 0.06, (r.y0 + r.y1) / 2);
      m.scale.set(r.x1 - r.x0, 1, r.y1 - r.y0);
      m.visible = true;
      requestRender();
    },
    setTool(on) {
      // a selected tool takes the left button (a drag builds), otherwise it turns the camera
      view.controls.mouseButtons.LEFT = on ? null : THREE.MOUSE.ROTATE;
    },
  };
}

// --- internals ----------------------------------------------------------------------------------

function requestRender() {
  // while the animation loop runs, it renders every frame
  if (!view || view.frameId !== null || view.loopId !== null) return;
  view.frameId = requestAnimationFrame(() => {
    const v = view;
    if (!v) return;
    v.frameId = null;
    v.renderer.render(v.scene, v.camera);
  });
}

// The animation loop: each frame, the layers' frame(ctx, seconds) then one render. The time step is
// bounded (frameSeconds), so a hidden tab coming back does not replay the time it missed.
function startLoop() {
  let last = performance.now();
  const step = (now) => {
    const v = view;
    if (!v) return;
    const dt = frameSeconds(last, now);
    last = now;
    for (const layer of v.layers) layer.frame?.(v.ctx, dt);
    v.renderer.render(v.scene, v.camera);
    v.loopId = requestAnimationFrame(step);
  };
  view.loopId = requestAnimationFrame(step);
}

// What a layer may use. Getters read the current view, so a layer never keeps a stale terrain.
function makeContext() {
  const v = view;
  return {
    THREE,
    scene: v.scene,
    camera: v.camera,
    controls: v.controls,
    renderer: v.renderer,
    canvas: v.canvas,
    lights: v.lights,
    grid: () => view?.grid ?? null,
    snapshot: () => view?.snapshot ?? null,
    corners: () => view?.corners ?? null,
    // the sea-level water plane (replaced when the terrain is rebuilt: read it, do not keep it)
    water: () => view?.water ?? null,
    // the volumes (buildings, trees) of chunk c, as view3d-model.js buildChunk returns them
    chunkVolumes: (c) => view?.chunkVolumes[c] ?? [],
    // hides or shows the procedural volumes of a kind (a layer that draws models instead)
    setVolumesVisible(kind, on) {
      if (!view) return;
      if (on) view.hiddenKinds.delete(kind);
      else view.hiddenKinds.add(kind);
      const inst = view.instances[kind];
      if (inst) inst.mesh.visible = on;
      requestRender();
    },
    requestRender,
  };
}

function resize() {
  if (!view) return;
  const cw = view.canvas.clientWidth, ch = view.canvas.clientHeight;
  if (!cw || !ch) return;
  view.renderer.setSize(cw, ch, false);
  view.camera.aspect = cw / ch;
  view.camera.updateProjectionMatrix();
  requestRender();
}

// Tile under a pointer event: the ray from the camera through the pointer, walked down the columns.
function tileOf(ev) {
  if (!view || !view.grid) return null;
  const r = view.canvas.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  const ndc = new THREE.Vector2(
    ((ev.clientX - r.left) / r.width) * 2 - 1,
    -((ev.clientY - r.top) / r.height) * 2 + 1,
  );
  view.raycaster.setFromCamera(ndc, view.camera);
  const o = view.raycaster.ray.origin, d = view.raycaster.ray.direction;
  return pickTile([o.x, o.y, o.z], [d.x, d.y, d.z], view.grid, view.tops, view.maxTop);
}

// Screen position (client pixels) of the centre of tile (x, y) on the ground.
function screenOf(x, y) {
  const p = new THREE.Vector3(x + 0.5, tileCentreY(view.corners, view.grid.h, x, y), y + 0.5)
    .project(view.camera);
  const r = view.canvas.getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
}

function disposeGroup(v) {
  for (const child of [...v.group.children]) {
    child.geometry?.dispose();
    v.group.remove(child);
  }
  v.chunks = [];
  v.chunkVolumes = [];
  v.instances = {};
  if (v.water) {
    v.water.geometry.dispose();
    v.water = null;
  }
}

// A new terrain of this size: chunk meshes, one instanced mesh per volume kind, the water plane.
function resetTerrain(grid) {
  disposeGroup(view);
  const { w, h } = grid;
  view.grid = grid;
  view.snapshot = null;
  view.tops = new Float32Array(w * h);
  view.maxTop = 0;
  for (let c = 0; c < grid.count; c++) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), view.materials.terrain);
    view.group.add(mesh);
    view.chunks.push(mesh);
  }
  const count = grid.count * SLOTS;
  const geometries = {
    residential: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    commercial: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    industrial: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    tree: new THREE.ConeGeometry(0.34, 0.9, 7).translate(0, 0.45, 0),
  };
  for (const kind of KINDS) {
    const mesh = new THREE.InstancedMesh(geometries[kind], view.materials.volume, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.visible = !view.hiddenKinds.has(kind);
    view.group.add(mesh);
    view.instances[kind] = { mesh };
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), view.materials.water);
  water.position.set(w / 2, WATER_Y, h / 2);
  water.renderOrder = 1;
  view.group.add(water);
  view.water = water;
}

// Rebuilds the terrain chunk c and its volume slots (the slots of the chunk are one range).
function rebuildChunk(c) {
  const { grid, snapshot, corners, tops } = view;
  const { geometry, volumes } = buildChunk({
    grid, chunk: c, tiles: snapshot.tiles, alt: snapshot.alt, corners, tops,
  });
  view.chunkVolumes[c] = volumes;
  const mesh = view.chunks[c];
  mesh.geometry.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(geometry.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(geometry.normals, 3));
  g.setAttribute("color", new THREE.BufferAttribute(geometry.colours, 3));
  g.setIndex(new THREE.BufferAttribute(geometry.indices, 1));
  g.computeBoundingSphere();
  mesh.geometry = g;

  const first = c * SLOTS;
  for (const kind of KINDS) {
    const { mesh: im } = view.instances[kind];
    im.instanceMatrix.array.fill(0, first * 16, (first + SLOTS) * 16);
    im.instanceColor.array.fill(0, first * 3, (first + SLOTS) * 3);
    im.instanceMatrix.addUpdateRange(first * 16, SLOTS * 16);
    im.instanceColor.addUpdateRange(first * 3, SLOTS * 3);
  }
  for (const v of volumes) {
    const { mesh: im } = view.instances[v.kind];
    writeVolumeMatrix(im.instanceMatrix.array, v.slot * 16, v);
    im.instanceColor.array.set(v.rgb, v.slot * 3);
  }
}
