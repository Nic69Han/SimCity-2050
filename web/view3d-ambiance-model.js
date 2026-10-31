// Pure model of the 3D view's ambiance (docs/game-design.md, "Ambiance"): the day and night cycle
// and the water surface. No THREE, no DOM: view3d-ambiance.js applies these values to the scene.
//
// Time of day is a phase in [0, 1): 0 is midnight, 0.25 dawn, 0.5 noon, 0.75 dusk. A full day lasts
// DAY_SECONDS of real time. The sun moves on a circle around the city (sunDirection), its colours,
// intensities and the sky colour are keyframes (night, dawn, day, dusk, night) interpolated linearly,
// so the values are continuous and periodic.
//
// daylight (0 at night .. 1 at full day) is written by the layer to ctx.scene.userData.daylight every
// frame: other layers (the lit windows of the buildings, at night) read it there.
//
// Colours are integers 0xRRGGBB (sRGB, as the 3D view uses them).

export const DAY_SECONDS = 240; // real seconds of one full day
export const WATER_PERIOD_SECONDS = 12; // real seconds of one ripple cycle (the water moves even when the day is paused)
export const START_PHASE = 0.42; // a morning when the view opens
export const MAX_STEP_SECONDS = 0.1; // a larger step (a hidden tab coming back) counts as this much
export const MIN_LIGHT = 0.6; // hemisphere light never goes below this: the city stays readable at night
export const SUN_DISTANCE = 150; // world units from the sun target to the sun (only its direction matters)
export const RIPPLE_SIZE = 64; // texels per side of the water texture
export const RIPPLE_TILES = 8; // tiles of the city covered by one water texture
export const WATER_DAY = 0x2a5fb0;
export const WATER_NIGHT = 0x142c55;

const TAU = 2 * Math.PI;
const SUN_SPREAD_X = 0.6; // the sun's path is tilted: its horizontal component is (0.6, 0.8)
const SUN_SPREAD_Z = 0.8;

const NIGHT = {
  hemi: MIN_LIGHT, hemiSky: 0x5f7ab0, hemiGround: 0x2a3550, sun: 0.2, sunColour: 0x9fb8e8,
  background: 0x0e1c38, daylight: 0,
};
const DAWN = {
  hemi: 1.0, hemiSky: 0xffd6ad, hemiGround: 0x6b5d5a, sun: 1.1, sunColour: 0xffb784,
  background: 0xf2a77c, daylight: 0.5,
};
const DAY = {
  hemi: 1.0, hemiSky: 0xffffff, hemiGround: 0x4a5568, sun: 1.6, sunColour: 0xffffff,
  background: 0xbcd6ea, daylight: 1,
};
const DUSK = {
  hemi: 0.95, hemiSky: 0xffb391, hemiGround: 0x4a3d4e, sun: 1.1, sunColour: 0xff9a66,
  background: 0xd9806a, daylight: 0.5,
};

// [phase, values]: the last keyframe is the first one again, so the cycle closes on itself.
const KEYFRAMES = Object.freeze([
  Object.freeze({ phase: 0, ...NIGHT }),
  Object.freeze({ phase: 0.25, ...DAWN }),
  Object.freeze({ phase: 0.5, ...DAY }),
  Object.freeze({ phase: 0.75, ...DUSK }),
  Object.freeze({ phase: 1, ...NIGHT }),
]);
const SEGMENTS = KEYFRAMES.length - 1; // 4 segments of width 0.25
const COLOURS = Object.freeze(["hemiSky", "hemiGround", "sunColour", "background"]);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, u) => a + (b - a) * u;

// Phase of a time in seconds or of a number of days: wraps into [0, 1). Rejects non-finite input.
export function wrapPhase(x) {
  if (!Number.isFinite(x)) throw new RangeError(`ambiance: phase must be a finite number, got ${x}`);
  return x - Math.floor(x);
}

// Phase after `seconds` of real time at `periodSeconds` per cycle. The step is bounded by
// MAX_STEP_SECONDS, so a long pause does not jump the cycle.
export function advancePhase(phase, seconds, periodSeconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`ambiance: seconds must be a number >= 0, got ${seconds}`);
  }
  if (!(periodSeconds > 0)) throw new RangeError(`ambiance: period must be > 0, got ${periodSeconds}`);
  return wrapPhase(phase + Math.min(seconds, MAX_STEP_SECONDS) / periodSeconds);
}

// Channel-wise mix of two 0xRRGGBB colours, u in [0, 1]. Returns an integer colour.
export function mixHex(a, b, u) {
  let out = 0;
  for (let shift = 16; shift >= 0; shift -= 8) {
    const ca = (a >> shift) & 0xff, cb = (b >> shift) & 0xff;
    out |= Math.round(lerp(ca, cb, u)) << shift;
  }
  return out;
}

// The object skyAt writes into: the arrays and numbers a layer keeps for the whole session.
export function createSky() {
  return {
    sunDir: [0, 0, 0], sunIntensity: 0, sunColour: 0, hemiIntensity: 0, hemiSky: 0, hemiGround: 0,
    background: 0, daylight: 0,
  };
}

// Writes the sky at `phase` (any finite number, wrapped) into `out` and returns it. The sun goes
// round once a day: its elevation is sin of the phase, below the horizon at night.
export function skyAt(phase, out = createSky()) {
  const p = wrapPhase(phase);
  const seg = Math.min(SEGMENTS - 1, Math.floor(p * SEGMENTS));
  const a = KEYFRAMES[seg], b = KEYFRAMES[seg + 1];
  const u = p * SEGMENTS - seg;
  out.hemiIntensity = Math.max(MIN_LIGHT, lerp(a.hemi, b.hemi, u));
  out.sunIntensity = lerp(a.sun, b.sun, u);
  out.daylight = clamp01(lerp(a.daylight, b.daylight, u));
  for (const k of COLOURS) out[k] = mixHex(a[k], b[k], u);
  const ang = TAU * (p - 0.25);
  const c = Math.cos(ang), s = Math.sin(ang);
  out.sunDir[0] = -SUN_SPREAD_X * c;
  out.sunDir[1] = s;
  out.sunDir[2] = -SUN_SPREAD_Z * c;
  return out;
}

// The sky at a phase, in a new object (one-off reads; a layer keeps one createSky() and reuses it).
export function sky(phase) {
  return skyAt(phase, createSky());
}

// Water colour for a daylight level: dark blue at night, the day blue at noon.
export function waterColour(daylight) {
  return mixHex(WATER_NIGHT, WATER_DAY, clamp01(daylight));
}

// Brightness of the ripple texel (x, y) of a size x size texture, in [0.8, 1]. Tileable: the sines
// have whole periods over the texture, so x = size is x = 0.
export function rippleValue(x, y, size) {
  const a = (TAU * x) / size, b = (TAU * y) / size;
  const v = 0.5 + 0.25 * Math.sin(2 * a + b) + 0.25 * Math.sin(3 * b - a + 1);
  return 0.8 + 0.2 * clamp01(v);
}

// RGBA bytes of the ripple texture (grey, opaque): the water colour is multiplied by it.
export function rippleTexture(size) {
  if (!Number.isInteger(size) || size < 2 || size > 1024) {
    throw new RangeError(`ambiance: texture size must be an integer in 2..1024, got ${size}`);
  }
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const g = Math.round(255 * rippleValue(x, y, size));
      out[i] = g;
      out[i + 1] = g;
      out[i + 2] = g;
      out[i + 3] = 255;
    }
  }
  return out;
}

// Reduced motion (prefers-reduced-motion: reduce): the view stays at full day (noon, daylight 1) and the
// water does not move. The layer reads the preference once, when it mounts.
export const MEDIA_REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
export const REDUCED_PHASE = 0.5; // noon: the DAY keyframe, daylight 1

// What moves under a preference: the cycle (and its checkbox) and the water. Without the preference, the
// values of the layer as they were before (a morning, the cycle on, the water moving).
export function motionFor(reduced) {
  return reduced === true
    ? { cycle: REDUCED_PHASE, cycles: false, waterMoves: false }
    : { cycle: START_PHASE, cycles: true, waterMoves: true };
}

// Whether the reduced-motion query matches. `matchMedia` is the window's function (or undefined when there
// is no browser window: then nothing is reduced).
export function prefersReducedMotion(matchMedia) {
  if (typeof matchMedia !== "function") return false;
  return matchMedia(MEDIA_REDUCED_MOTION)?.matches === true;
}
