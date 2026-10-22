// 3D moving objects, pure part (docs/game-design-v13.md, "Transports animés en 3D"): the sprites of
// city.sprites() as simple coloured volumes (boxes) placed where the 2D map draws them. No DOM, no Three.js,
// so node:test can check it. view3d-sprites.js turns the placements into one instanced mesh.
//
// Decoding and the tile position are the 2D ones (web/sprites-art.js: decodeSprites, spriteCentre), so a
// sprite is at the same place in 2D and 3D. World X = tile x, Z = tile y, Y = height. Each kind is a few
// boxes standing on a base: the terrain (ground), the water plane (ship) or a named altitude above the
// ground (airplane, helicopter). A kind not listed in KINDS is not drawn.
import { decodeSprites, spriteCentre } from "./sprites-art.js";
import { groundY, WATER_Y } from "./view3d-model.js";
import { rgbOfHex } from "./view3d-structures-model.js";

// Boxes of the mesh. A sprite is drawn whole or not at all: past the capacity a sprite is dropped and counted.
export const CAPACITY = 1024;
export const READ_INTERVAL = 0.25; // seconds between two reads of the engine
export const AIRPLANE_ALTITUDE = 2.5; // height of a plane's base above the ground
export const HELICOPTER_ALTITUDE = 1.6; // height of a helicopter's base above the ground
export const TORNADO_BANDS = 6; // stacked boxes of a tornado, each narrower than the one below
export const TORNADO_BAND_HEIGHT = 0.25;
export const TORNADO_WIDTH = 0.9;

// A box of a volume: its centre `cy` above the base, its size in tiles, its colour (0..1 components).
const box = (cy, sx, sy, sz, hex) => Object.freeze({ cy, sx, sy, sz, rgb: Object.freeze(rgbOfHex(hex)) });

// The bands of a tornado: a grey stack, each band narrower than the one below it.
function tornadoVolumes() {
  const out = [];
  for (let i = 0; i < TORNADO_BANDS; i++) {
    const width = TORNADO_WIDTH * (1 - (i / TORNADO_BANDS) * 0.6);
    out.push(box(TORNADO_BAND_HEIGHT * (i + 0.5), width, TORNADO_BAND_HEIGHT, width, "#5a626c"));
  }
  return Object.freeze(out);
}

// The volumes of each engine kind (SpriteType values, sprites-art.js) and the base they stand on:
// "ground" (the terrain), "water" (the water plane) or a number, the altitude above the ground.
export const KINDS = Object.freeze({
  1: Object.freeze({ base: "ground", volumes: Object.freeze([box(0.1, 0.9, 0.2, 0.2, "#2c3e50")]) }), // train
  2: Object.freeze({ // helicopter: body and rotor slab
    base: HELICOPTER_ALTITUDE,
    volumes: Object.freeze([box(0, 0.4, 0.25, 0.25, "#2e4057"), box(0.2, 0.8, 0.03, 0.1, "#1c1c1c")]),
  }),
  3: Object.freeze({ // airplane: fuselage and wing
    base: AIRPLANE_ALTITUDE,
    volumes: Object.freeze([box(0, 0.9, 0.12, 0.12, "#f4f6f7"), box(0, 0.14, 0.04, 0.8, "#dfe6e9")]),
  }),
  4: Object.freeze({ base: "water", volumes: Object.freeze([box(0.06, 0.9, 0.12, 0.45, "#ecf0f1")]) }), // ship hull
  5: Object.freeze({ base: "ground", volumes: Object.freeze([box(0.6, 0.5, 1.2, 0.5, "#3a7d44")]) }), // monster
  6: Object.freeze({ base: "ground", volumes: tornadoVolumes() }), // tornado
  7: Object.freeze({ base: "ground", volumes: Object.freeze([box(0.3, 0.6, 0.6, 0.6, "#ff7820")]) }), // explosion
  8: Object.freeze({ base: "ground", volumes: Object.freeze([box(0.175, 0.8, 0.35, 0.3, "#f5b041")]) }), // bus
});

// Whether the kind has a drawing (a key of KINDS).
export function drawsKind(kind) {
  return Object.hasOwn(KINDS, kind);
}

// Height of the base of a known kind at the terrain height `ground`: the terrain, the water plane, or the
// ground plus the kind's altitude.
export function baseY(kind, ground) {
  const base = KINDS[kind].base;
  if (base === "water") return WATER_Y;
  if (base === "ground") return ground;
  return ground + base;
}

// The boxes of one sprite at tile position (x, y): { x, y, z, sx, sy, sz, rgb } each, the boxes of its kind
// set on its base. Returns [] for an unknown kind.
export function volumesFor(kind, x, y, corners, w, h) {
  if (!drawsKind(kind)) return [];
  const base = baseY(kind, groundY(corners, w, h, x, y));
  return KINDS[kind].volumes.map((v) => ({
    x, y: base + v.cy, z: y, sx: v.sx, sy: v.sy, sz: v.sz, rgb: v.rgb,
  }));
}

// The placements of the sprites of a read. `flat` is the engine's flat records (see decodeSprites), `corners`
// the terrain, (w, h) the map size. Returns { items, drawn, dropped }: `items` the boxes, `drawn` the sprites
// drawn, `dropped` the sprites of a known kind that did not fit in `cap` boxes (nothing is written past it).
export function spritePlacements(flat, corners, w, h, cap = CAPACITY) {
  const items = [];
  let drawn = 0, dropped = 0;
  const sprites = decodeSprites(flat);
  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i];
    if (!drawsKind(s.kind)) continue;
    const c = spriteCentre(s);
    const boxes = volumesFor(s.kind, c.x, c.y, corners, w, h);
    if (items.length + boxes.length > cap) {
      dropped++;
      continue;
    }
    for (const b of boxes) items.push(b);
    drawn++;
  }
  return { items, drawn, dropped };
}

// Whether the engine is due a read, given the seconds since the last one (Infinity before the first).
export function shouldRead(elapsed) {
  return elapsed >= READ_INTERVAL;
}
