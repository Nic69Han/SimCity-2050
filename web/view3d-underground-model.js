// 3D underground networks, pure part (ARCHITECTURE.md rule 5): where the pipes, pumps, tunnels and
// stations of City.water_layer() / City.transit_layer() go, as plain numbers. No DOM, no Three.js,
// so node:test can check it. view3d-underground.js turns the placements into instanced meshes.
//
// Layers are column-major like the engine, index = x * h + y. World X = tile x, Z = tile y, Y = height.
// Water codes: 0 nothing, 1 dry pipe, 2 fed pipe, 3 pump. Transit codes: 0 nothing, 1 tunnel,
// 2 tunnel of a working line, 3 station, 4 station of a working line (docs/game-design-v02.md).
import { tileCentreY } from "./view3d-model.js";

// Capacity of each instanced mesh (instances, one mesh per kind). Past it, placements are dropped
// and counted (`dropped`), never written out of bounds. A pipe or tunnel run costs one node per
// tile plus one segment per joined neighbour (right and down), so ~3 instances per tile at most.
export const CAPACITY = Object.freeze({ pipe: 12288, pump: 64, tunnel: 12288, station: 64 });
export const KINDS = Object.freeze(Object.keys(CAPACITY));

// Geometry of the shapes, in world units (a tile is 1).
export const PIPE_DEPTH = 0.1; // pipe axis below the ground
export const PIPE_SIZE = 0.12;
export const TUNNEL_DEPTH = 0.45; // tunnel axis below the ground
export const TUNNEL_SIZE = 0.36;
export const PUMP_SIZE = [0.3, 0.8, 0.3];
export const STATION_SIZE = [0.7, 0.5, 0.7];

export const COLORS = Object.freeze({
  pipe: "#1e88e5", pipeDry: "#9fb3c8", pump: "#00bcd4",
  tunnel: "#6e6e82", tunnelWorking: "#e8890c", station: "#b9770e", stationWorking: "#e8590c",
});

const WATER = Object.freeze({ DRY_PIPE: 1, PIPE: 2, PUMP: 3 });
const TRANSIT = Object.freeze({ TUNNEL: 1, TUNNEL_WORKING: 2, STATION: 3, STATION_WORKING: 4 });

export function rgbOfHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// FNV-1a over the bytes: a cheap fingerprint to tell whether a layer changed since the last frame.
export function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  return h;
}

// What decides the drawing: the layers (fingerprint and length), the rule flags and the corner array
// (view3d.js replaces it when the terrain changes). Two keys equal means nothing to rebuild.
export function layerKey(water, transit, corners) {
  return {
    water: water ? [hashBytes(water), water.length] : null,
    transit: transit ? [hashBytes(transit), transit.length] : null,
    corners,
  };
}

export function sameKey(a, b) {
  if (!a || !b || a.corners !== b.corners) return false;
  const eq = (p, q) => (p === null || q === null ? p === q : p[0] === q[0] && p[1] === q[1]);
  return eq(a.water, b.water) && eq(a.transit, b.transit);
}

const empty = () => ({ pipe: [], pump: [], tunnel: [], station: [] });

// Placements of every kind. Each is { x, y, z, sx, sy, sz, rgb } (centre, full size, 0..1 colour).
// Returns { items: {pipe, pump, tunnel, station}, tiles: {...}, dropped } where `tiles` counts the
// network tiles of each kind (not the instances). A layer of the wrong size is ignored.
export function buildPlacements({ w, h, water, transit, corners, caps = CAPACITY }) {
  const items = empty();
  const tiles = { pipe: 0, pump: 0, tunnel: 0, station: 0 };
  let dropped = 0;
  const add = (kind, p) => {
    if (items[kind].length < caps[kind]) items[kind].push(p);
    else dropped++;
  };
  const ground = (x, y) => tileCentreY(corners, h, x, y);
  const ok = (layer) => layer && layer.length === w * h;

  // Joins the cells of one network: a node box per cell, a segment per cell joined right and down.
  const network = (layer, kind, isCell, depth, size, colourOf) => {
    const at = (x, y) => (x < w && y < h ? layer[x * h + y] : 0);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const c = layer[x * h + y];
        if (!isCell(c)) continue;
        const gy = ground(x, y) - depth;
        add(kind, { x: x + 0.5, y: gy, z: y + 0.5, sx: size, sy: size, sz: size, rgb: colourOf(c) });
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const d = at(x + dx, y + dy);
          if (!isCell(d)) continue;
          const my = (gy + ground(x + dx, y + dy) - depth) / 2;
          add(kind, {
            x: x + 0.5 + dx / 2, y: my, z: y + 0.5 + dy / 2,
            sx: dx ? 1 : size, sy: size, sz: dy ? 1 : size, rgb: colourOf(c),
          });
        }
      }
    }
  };

  if (ok(water)) {
    const isPipe = (c) => c === WATER.DRY_PIPE || c === WATER.PIPE || c === WATER.PUMP;
    network(water, "pipe", isPipe, PIPE_DEPTH, PIPE_SIZE,
      (c) => rgbOfHex(c === WATER.DRY_PIPE ? COLORS.pipeDry : COLORS.pipe));
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const c = water[x * h + y];
        if (c === WATER.DRY_PIPE || c === WATER.PIPE) tiles.pipe++;
        if (c !== WATER.PUMP) continue;
        tiles.pump++;
        add("pump", {
          x: x + 0.5, y: ground(x, y) + PUMP_SIZE[1] / 2, z: y + 0.5,
          sx: PUMP_SIZE[0], sy: PUMP_SIZE[1], sz: PUMP_SIZE[2], rgb: rgbOfHex(COLORS.pump),
        });
      }
    }
  }
  if (ok(transit)) {
    const isTunnel = (c) => c >= TRANSIT.TUNNEL && c <= TRANSIT.STATION_WORKING; // a station sits on a tunnel
    const working = (c) => c === TRANSIT.TUNNEL_WORKING || c === TRANSIT.STATION_WORKING;
    network(transit, "tunnel", isTunnel, TUNNEL_DEPTH, TUNNEL_SIZE,
      (c) => rgbOfHex(working(c) ? COLORS.tunnelWorking : COLORS.tunnel));
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const c = transit[x * h + y];
        if (c === TRANSIT.TUNNEL || c === TRANSIT.TUNNEL_WORKING) tiles.tunnel++;
        if (c !== TRANSIT.STATION && c !== TRANSIT.STATION_WORKING) continue;
        tiles.station++;
        add("station", {
          x: x + 0.5, y: ground(x, y) + STATION_SIZE[1] / 2, z: y + 0.5,
          sx: STATION_SIZE[0], sy: STATION_SIZE[1], sz: STATION_SIZE[2],
          rgb: rgbOfHex(c === TRANSIT.STATION_WORKING ? COLORS.stationWorking : COLORS.station),
        });
      }
    }
  }
  return { items, tiles, dropped };
}

// Writes the column-major matrix of a placement (translation and scale, no rotation) at out[offset].
export function writeMatrix(out, offset, p) {
  out.fill(0, offset, offset + 16);
  out[offset] = p.sx;
  out[offset + 5] = p.sy;
  out[offset + 10] = p.sz;
  out[offset + 12] = p.x;
  out[offset + 13] = p.y;
  out[offset + 14] = p.z;
  out[offset + 15] = 1;
}

// See-through mode: the look given to an opaque surface material (restored from `saved`).
export const SEE_THROUGH_OPACITY = 0.3;
