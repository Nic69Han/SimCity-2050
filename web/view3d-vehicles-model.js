// 3D simulated vehicles, pure part (ARCHITECTURE.md rule 5): the records of City.vehicles() as plain
// numbers, their interpolation between two reads, and where each box goes. No DOM, no Three.js, so
// node:test can check it. view3d-vehicles.js turns the placements into one instanced mesh.
//
// A record is 5 integers [id, kind, x16, y16, direction]: x16, y16 are sixteenths of a tile, kind 0
// car (1 bus, 2 taxi, 3 train, 4 metro), direction 0 north, 1 east, 2 south, 3 west.
// World X = tile x, Z = tile y, Y = height (as in view3d-model.js).
// A metro rame (kind 4) runs in a tunnel: its box is centred at the tunnel depth below the ground
// (METRO_DEPTH, the depth of the tunnels of view3d-underground-model.js). Other kinds stand on the ground.
import { tileCentreY } from "./view3d-model.js";
import { TUNNEL_DEPTH } from "./view3d-underground-model.js";

export const MAX_VEHICLES_3D = 4000; // vehicles read per call, and instances of the mesh
export const READ_INTERVAL = 0.25; // seconds between two reads of the engine
export const RECORD = 5;
export const METRO_KIND = 4;
export const METRO_DEPTH = TUNNEL_DEPTH; // a rame lies as deep as a tunnel (same rule as the 3D underground)

// Size of the box of each kind in tiles: length along the way, height, width. An unknown kind is drawn
// with the car's size (sizeOf).
export const SIZES = Object.freeze({
  0: Object.freeze({ length: 0.35, height: 0.2, width: 0.18 }), // car
  1: Object.freeze({ length: 0.8, height: 0.3, width: 0.22 }), // bus
  2: Object.freeze({ length: 0.33, height: 0.2, width: 0.18 }), // taxi
  3: Object.freeze({ length: 0.9, height: 0.3, width: 0.25 }), // train
  4: Object.freeze({ length: 0.9, height: 0.3, width: 0.25 }), // metro
});

// Colour of each kind (0 car, 1 bus, 2 taxi, 3 train, 4 metro), as #rrggbb.
export const KIND_COLORS = Object.freeze(["#d8dde6", "#f0a030", "#ffd23f", "#8e44ad", "#2ecc71"]);

// Yaw (rotation around Y, radians) of a box whose length runs along local X, for each direction:
// local X maps to (cos, 0, -sin), so north is -Z, east +X, south +Z, west -X.
const YAW = Object.freeze([Math.PI / 2, 0, -Math.PI / 2, Math.PI]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The vehicles of a read, in record order. A truncated trailing record is ignored, and so is a record
// with a non-finite field. Loop bounded by the data length.
export function decodeVehicles(arr) {
  const out = [];
  if (!arr || typeof arr.length !== "number") return out;
  const n = Math.floor(arr.length / RECORD);
  for (let i = 0; i < n; i++) {
    const o = i * RECORD;
    const id = arr[o], kind = arr[o + 1], x16 = arr[o + 2], y16 = arr[o + 3], dir = arr[o + 4];
    if (!Number.isFinite(id) || !Number.isFinite(kind) || !Number.isFinite(x16) ||
        !Number.isFinite(y16) || !Number.isFinite(dir)) continue;
    out.push({ id, kind, x: x16 / 16, y: y16 / 16, dir });
  }
  return out;
}

// Positions between the previous read (prev) and the new one (next), matched by id: a vehicle of
// next gets its place interpolated from its place in prev (t clamped to [0, 1]); a new id appears at
// its position in next; an id absent from next is gone. Returns the vehicles of next.
export function interpolate(prev, next, t) {
  const k = Number.isFinite(t) ? clamp(t, 0, 1) : 0;
  const before = new Map();
  for (let i = 0; i < prev.length; i++) before.set(prev[i].id, prev[i]);
  const out = [];
  for (let i = 0; i < next.length; i++) {
    const v = next[i];
    const p = before.get(v.id);
    if (!p) {
      out.push(v);
      continue;
    }
    out.push({ id: v.id, kind: v.kind, dir: v.dir, x: p.x + (v.x - p.x) * k, y: p.y + (v.y - p.y) * k });
  }
  return out;
}

// Yaw of a box facing a direction (0 N, 1 E, 2 S, 3 W); the direction wraps modulo 4.
export function yawFor(direction) {
  const d = ((Math.trunc(direction) % 4) + 4) % 4;
  return Number.isFinite(d) ? YAW[d] : YAW[0];
}

// RGB of a kind in 0..1; an unknown kind is drawn as a car.
export function kindColor(kind) {
  const hex = KIND_COLORS[kind] ?? KIND_COLORS[0];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Size of the box of a kind ({ length, height, width } in tiles); an unknown kind has the car's size.
export function sizeOf(kind) {
  return Object.hasOwn(SIZES, kind) ? SIZES[kind] : SIZES[0];
}

// Whether the engine is due a read, given the seconds since the last one (Infinity before the first).
export function shouldRead(elapsed) {
  return elapsed >= READ_INTERVAL;
}

// Height of the centre of a box of `kind` on a tile whose ground is at `ground`: a metro rame is centred
// METRO_DEPTH under the ground, any other kind stands on the ground (its centre is half its height up).
export function centreYOf(kind, ground, size) {
  return kind === METRO_KIND ? ground - METRO_DEPTH : ground + size.height / 2;
}

// Where each vehicle's box goes: { x, y, z, yaw, rgb, size } per vehicle, the box standing on the ground
// of its tile (tileCentreY of the tile holding it), on half its height; a metro rame is underground
// (centreYOf). `size` is the box of its kind (sizeOf). Past `capacity` vehicles are dropped and counted.
export function buildPlacements({ w, h, vehicles, corners, capacity = MAX_VEHICLES_3D }) {
  const items = [];
  let dropped = 0;
  for (let i = 0; i < vehicles.length; i++) {
    if (items.length >= capacity) {
      dropped++;
      continue;
    }
    const v = vehicles[i];
    const tx = clamp(Math.floor(v.x), 0, Math.max(0, w - 1));
    const ty = clamp(Math.floor(v.y), 0, Math.max(0, h - 1));
    const size = sizeOf(v.kind);
    items.push({
      x: v.x,
      y: centreYOf(v.kind, tileCentreY(corners, h, tx, ty), size),
      z: v.y,
      yaw: yawFor(v.dir),
      rgb: kindColor(v.kind),
      size,
    });
  }
  return { items, dropped };
}

// Writes the column-major matrix (rotation around Y, scale to the box `size`, translation) of a
// placement at out[offset]. The mesh is a unit box, so the scale in the matrix gives each kind its size.
export function writeVehicleMatrix(out, offset, p, size) {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const { length, height, width } = size;
  out[offset] = c * length;
  out[offset + 1] = 0;
  out[offset + 2] = -s * length;
  out[offset + 3] = 0;
  out[offset + 4] = 0;
  out[offset + 5] = height;
  out[offset + 6] = 0;
  out[offset + 7] = 0;
  out[offset + 8] = s * width;
  out[offset + 9] = 0;
  out[offset + 10] = c * width;
  out[offset + 11] = 0;
  out[offset + 12] = p.x;
  out[offset + 13] = p.y;
  out[offset + 14] = p.z;
  out[offset + 15] = 1;
}
