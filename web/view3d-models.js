// 3D view layer: building models (Kenney City Kits, CC0, docs/credits.md) in place of the procedural
// volumes. Three.js side of the layer; the choices (variant, scale, instance slots) are pure and live
// in view3d-models-model.js.
//
// mount() loads the .glb files in the background. The view keeps drawing its boxes meanwhile, and
// for good if the loading fails (one console.warn). Once loaded, for each kind whose models are all
// there the boxes are hidden (ctx.setVolumesVisible) and the volumes of ctx.chunkVolumes(c) are drawn
// as instanced meshes, one per sub-mesh of each model (MODEL_CAPACITY instances each). update()
// redraws only the chunks in change.dirty (change.fresh: a new terrain, everything again).
//
// Test hook: while mounted, canvas.modelStats() returns a read-only snapshot
// { ready, failed, kinds, models, meshes, instances, byKind, overflow } (like canvas.tileScreen).
import {
  MODEL_FILES, CATALOG, MODEL_CAPACITY, KINDS, chooseModel, usableCatalog, fitScale, writePlacement,
  createSlotTable,
} from "./view3d-models-model.js";

const MODELS_URL = new URL("./models/", import.meta.url);

// Loads every model file. Resolves to { id: gltf scene } for those that loaded; `failed` lists the
// others. A missing GLTFLoader module or file is a failure, never an exception.
async function loadScenes() {
  const { GLTFLoader } = await import("./vendor/GLTFLoader.js");
  const loader = new GLTFLoader();
  const ids = Object.keys(MODEL_FILES);
  const settled = await Promise.allSettled(
    ids.map((id) => loader.loadAsync(new URL(MODEL_FILES[id], MODELS_URL).href)),
  );
  const scenes = {}, failed = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") scenes[ids[i]] = r.value.scene;
    else failed.push(ids[i]);
  });
  return { scenes, failed };
}

// What a model owns on the GPU side: the geometries (centred on X and Z, feet at Y = 0) and the
// materials, shared when two sub-meshes use the same texture. disposeAll() frees them all.
function createBank(THREE) {
  const materials = new Map(); // key -> material (its texture is owned by it)
  const geometries = [];

  const materialOf = (source) => {
    const m = source.map;
    const key = m
      ? [m.image?.currentSrc || m.image?.src || m.uuid, m.offset.x, m.offset.y, m.repeat.x, m.repeat.y, m.rotation].join("|")
      : "plain|" + source.color.getHexString();
    let own = materials.get(key);
    if (!own) {
      own = new THREE.MeshLambertMaterial({ map: m ?? null, color: m ? 0xffffff : source.color });
      materials.set(key, own);
    } else if (m) {
      m.dispose(); // a copy of a texture already held
    }
    return own;
  };

  return {
    // A model from a loaded scene: { dims: { w, h, d }, parts: [{ geometry, material }] }.
    prepare(scene) {
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const centre = box.getCenter(new THREE.Vector3());
      const toOrigin = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
      const parts = [];
      scene.traverse((o) => {
        if (!o.isMesh) return;
        const geometry = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toOrigin, o.matrixWorld));
        geometries.push(geometry);
        const sources = Array.isArray(o.material) ? o.material : [o.material];
        parts.push({ geometry, material: materialOf(sources[0]) });
        o.geometry.dispose();
        for (const s of sources) s.dispose();
      });
      const size = box.getSize(new THREE.Vector3());
      return { dims: { w: size.x, h: size.y, d: size.z }, parts };
    },
    disposeAll() {
      for (const g of geometries) g.dispose();
      for (const m of materials.values()) {
        m.map?.dispose();
        m.dispose();
      }
      geometries.length = 0;
      materials.clear();
    },
  };
}

export function createLayer() {
  let ready = false, failed = false, disposed = false;
  let group = null, bank = null;
  let catalog = {}; // the usable catalog once loaded
  const entries = new Map(); // model id -> { dims, table, meshes: [InstancedMesh] }
  const chunkRecords = new Map(); // chunk -> [{ id, key, kind }] drawn from that chunk
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  let overflow = 0;

  // Removes what chunk c drew (the last instance fills each hole), then draws its volumes again.
  function placeChunk(ctx, c, touched) {
    for (const r of chunkRecords.get(c) ?? []) {
      const entry = entries.get(r.id);
      const move = entry.table.remove(r.key);
      counts[r.kind]--;
      if (move && move.from !== move.to) {
        for (const mesh of entry.meshes) {
          const a = mesh.instanceMatrix.array;
          a.copyWithin(move.to * 16, move.from * 16, move.from * 16 + 16);
        }
      }
      touched.add(entry);
    }
    const records = [];
    for (const v of ctx.chunkVolumes(c)) {
      if (!catalog[v.kind]) continue; // this kind keeps its boxes
      const m = chooseModel(catalog, v);
      const entry = m && entries.get(m.id);
      if (!entry) continue;
      const i = entry.table.add(v.slot);
      if (i < 0) {
        overflow++;
        continue;
      }
      const scale = fitScale(entry.dims, v);
      for (const mesh of entry.meshes) writePlacement(mesh.instanceMatrix.array, i * 16, v, m.quarter, scale);
      records.push({ id: m.id, key: v.slot, kind: v.kind });
      counts[v.kind]++;
      touched.add(entry);
    }
    chunkRecords.set(c, records);
  }

  function flush(touched) {
    for (const entry of touched) {
      for (const mesh of entry.meshes) {
        mesh.count = entry.table.count;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  function clearAll() {
    chunkRecords.clear();
    for (const entry of entries.values()) entry.table.clear();
    for (const k of KINDS) counts[k] = 0;
    overflow = 0;
    flush(new Set(entries.values()));
  }

  function drawAll(ctx) {
    const grid = ctx.grid();
    if (!grid) return;
    const touched = new Set();
    for (let c = 0; c < grid.count; c++) placeChunk(ctx, c, touched);
    flush(touched);
  }

  function build(ctx, scenes) {
    const { THREE } = ctx;
    bank = createBank(THREE);
    group = new THREE.Group();
    const prepared = {};
    for (const id of Object.keys(scenes)) prepared[id] = bank.prepare(scenes[id]);
    catalog = usableCatalog(CATALOG, Object.keys(prepared));
    const used = new Set();
    for (const levels of Object.values(catalog)) for (const list of levels) for (const id of list) used.add(id);
    for (const id of used) {
      const { dims, parts } = prepared[id];
      const meshes = parts.map((p) => {
        const mesh = new THREE.InstancedMesh(p.geometry, p.material, MODEL_CAPACITY);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.frustumCulled = false;
        group.add(mesh);
        return mesh;
      });
      entries.set(id, { dims, table: createSlotTable(MODEL_CAPACITY), meshes });
    }
    ctx.scene.add(group);
    for (const kind of Object.keys(catalog)) ctx.setVolumesVisible(kind, false);
  }

  async function load(ctx) {
    try {
      const { scenes, failed: missing } = await loadScenes();
      if (missing.length) console.warn("view3d-models: models not loaded:", missing.join(", "));
      if (disposed) return;
      build(ctx, scenes);
      ready = Object.keys(catalog).length > 0;
      if (ready) drawAll(ctx);
      else failed = true;
      ctx.requestRender();
    } catch (err) {
      failed = true;
      bank?.disposeAll();
      bank = null;
      console.warn("view3d-models: the models could not be loaded, the boxes stay:", err?.message ?? err);
    }
  }

  function stats() {
    let meshes = 0, instances = 0;
    for (const entry of entries.values()) {
      for (const mesh of entry.meshes) if (mesh.count > 0) meshes++;
      instances += entry.table.count;
    }
    return {
      ready, failed, kinds: Object.keys(catalog), models: entries.size, meshes, instances,
      byKind: { ...counts }, overflow,
    };
  }

  return {
    mount(ctx) {
      ctx.canvas.modelStats = stats;
      load(ctx);
    },
    update(ctx, change) {
      if (!ready || disposed) return;
      if (change.fresh) clearAll();
      const touched = new Set();
      for (const c of change.dirty) placeChunk(ctx, c, touched);
      flush(touched);
    },
    dispose(ctx) {
      disposed = true;
      delete ctx.canvas.modelStats;
      for (const entry of entries.values()) for (const mesh of entry.meshes) mesh.dispose();
      entries.clear();
      group?.removeFromParent();
      group = null;
      bank?.disposeAll();
      bank = null;
      ready = false;
    },
  };
}
