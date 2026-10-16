// 3D view layer: Day and night cycle, animated water (docs/game-design.md, "Ambiance").
// The values are computed by view3d-ambiance-model.js (pure); this layer applies them to the scene:
//   - the sun and the hemisphere light, the sky colour (scene.background), every frame;
//   - ctx.scene.userData.daylight: 0 at night .. 1 at full day, written every frame. Other layers
//     (the lit windows of the buildings at night) read it there;
//   - the sea-level water plane (ctx.water()): an animated material, re-applied when the terrain is
//     rebuilt (ctx.water() returns a new mesh), and restored on dispose.
// A checkbox «Cycle jour/nuit» (on by default) in #view3d-controls pauses the day; the water moves on.
import * as model from "./view3d-ambiance-model.js";

const CYCLE_LABEL = "Cycle jour/nuit";

// What the layer keeps while mounted. Nothing here grows with the frames.
function start(ctx) {
  const { THREE } = ctx;
  const host = ctx.canvas.ownerDocument.getElementById("view3d-controls");
  if (!host) throw new Error("ambiance: #view3d-controls is missing from the page");
  const texture = new THREE.DataTexture(
    model.rippleTexture(model.RIPPLE_SIZE), model.RIPPLE_SIZE, model.RIPPLE_SIZE, THREE.RGBAFormat,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const material = new THREE.MeshLambertMaterial({
    color: model.WATER_DAY, map: texture, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const control = cycleControl(ctx.canvas.ownerDocument);
  const hostWasHidden = host.hidden;
  host.hidden = false;
  host.append(control.label);
  if (!ctx.scene.background?.isColor) ctx.scene.background = new THREE.Color();
  const s = {
    host, hostWasHidden, control, texture, material,
    cycle: model.START_PHASE, cycling: true, water: 0,
    sky: model.createSky(), applied: null, // applied: { mesh, original } once the water is ours
    onChange: () => { s.cycling = control.input.checked; },
  };
  control.input.addEventListener("change", s.onChange);
  return s;
}

// The checkbox «Cycle jour/nuit»: a label around the box, styled inline (no stylesheet of its own).
function cycleControl(doc) {
  const label = doc.createElement("label");
  // the container sits on the black frame of the map: its own light text colour
  label.style.cssText = "display:inline-flex;align-items:center;gap:.3rem;margin:.3rem .5rem;font-size:.85rem;color:#f2f2f2;";
  const input = doc.createElement("input");
  input.type = "checkbox";
  input.checked = true;
  label.append(input, ` ${CYCLE_LABEL}`);
  return { label, input };
}

// Writes the sky of the current phase to the lights, the background, the water and userData.
function applySky(ctx, s) {
  const { lights, scene } = ctx;
  const sky = s.sky;
  model.skyAt(s.cycle, sky);
  lights.hemi.intensity = sky.hemiIntensity;
  lights.hemi.color.setHex(sky.hemiSky);
  lights.hemi.groundColor.setHex(sky.hemiGround);
  lights.sun.intensity = sky.sunIntensity;
  lights.sun.color.setHex(sky.sunColour);
  const tp = lights.sun.target.position;
  lights.sun.position.set(
    tp.x + sky.sunDir[0] * model.SUN_DISTANCE,
    tp.y + sky.sunDir[1] * model.SUN_DISTANCE,
    tp.z + sky.sunDir[2] * model.SUN_DISTANCE,
  );
  scene.background.setHex(sky.background);
  scene.userData.daylight = sky.daylight;
  s.material.color.setHex(model.waterColour(sky.daylight));
}

// Puts the animated material on the water plane of the current terrain (the old plane is gone).
function adoptWater(ctx, s, water) {
  s.applied = { mesh: water, original: water.material };
  water.material = s.material;
  const grid = ctx.grid();
  // the texture covers RIPPLE_TILES tiles of the city; the plane is w x h tiles
  s.texture.repeat.set(grid.w / model.RIPPLE_TILES, grid.h / model.RIPPLE_TILES);
}

export function createLayer() {
  let s = null;
  return {
    mount(ctx) {
      s = start(ctx);
      applySky(ctx, s);
    },
    // after each terrain update: the water plane may be new
    update(ctx) {
      const water = ctx.water();
      if (water && water !== s.applied?.mesh) adoptWater(ctx, s, water);
    },
    frame(ctx, seconds) {
      if (s.cycling) s.cycle = model.advancePhase(s.cycle, seconds, model.DAY_SECONDS);
      s.water = model.advancePhase(s.water, seconds, model.WATER_PERIOD_SECONDS);
      applySky(ctx, s);
      s.texture.offset.set(s.water, s.water);
    },
    dispose() {
      if (!s) return;
      // the mesh is still in the group here (the view disposes the group after the layers)
      if (s.applied) s.applied.mesh.material = s.applied.original;
      s.control.input.removeEventListener("change", s.onChange);
      s.control.label.remove();
      if (s.host.childElementCount === 0) s.host.hidden = s.hostWasHidden;
      s.material.dispose();
      s.texture.dispose();
      s = null;
    },
  };
}
