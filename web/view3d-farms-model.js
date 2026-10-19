// 3D farms, pure part (docs/game-design-v07.md, "Carte et 3D"): which tiles of the engine's density layer are
// farms and where their field slabs go. No DOM, no Three.js, so node:test can check it. view3d-farms.js turns
// the placements into one instanced mesh.
//
// The density layer is one byte per tile, column-major like the engine: index = x * h + y. A farm is a tile
// whose byte is FARM (4). Its field is a thin slab over the tile, standing on the terrain at the tile centre
// (view3d-model.js, tileCentreY). Two field colours alternate by the parity of x + y.
// World X = tile x, Z = tile y, Y = height. Units: 1 world unit = 1 tile.
import { tileCentreY } from "./view3d-model.js";
import { rgbOfHex } from "./view3d-structures-model.js";

export const FARM = 4;
// Instances of the field mesh. Past it, farm tiles are dropped and counted, never written out of bounds.
export const CAPACITY = 4096;
export const FIELD_HEIGHT = 0.03;
export const FIELD_COLORS = Object.freeze(["#c5e1a5", "#aed581"]);
const FIELD_RGB = Object.freeze(FIELD_COLORS.map(rgbOfHex));

// Colour components of the field of tile (x, y): the parity of x + y picks one of the two colours.
export function fieldRgbOf(x, y) {
  return FIELD_RGB[(x + y) & 1];
}

// One field placement over tile (x, y): a unit box scaled to a thin slab, its bottom on the tile centre.
export function fieldPlacement(x, y, corners, h) {
  const centre = tileCentreY(corners, h, x, y);
  return {
    x: x + 0.5, y: centre + FIELD_HEIGHT / 2, z: y + 0.5,
    sx: 1, sy: FIELD_HEIGHT, sz: 1, rgb: fieldRgbOf(x, y),
  };
}

// The farm placements of a density layer. `bytes` is the engine's array, (w, h) the map size, `corners` the
// terrain (view3d-model.js). Walks at most w * h bytes. Returns { items, farms, dropped }: `farms` counts the
// farm tiles of the map, `items` holds the placements (at most `cap`), `dropped` the farm tiles past `cap`.
export function farmPlacements(bytes, corners, w, h, cap = CAPACITY) {
  const items = [];
  let farms = 0;
  if (!ArrayBuffer.isView(bytes) || !(w > 0) || !(h > 0)) return { items, farms, dropped: 0 };
  const n = Math.min(bytes.length, w * h);
  for (let i = 0; i < n; i++) {
    if (bytes[i] !== FARM) continue;
    farms++;
    if (items.length < cap) items.push(fieldPlacement(Math.floor(i / h), i % h, corners, h));
  }
  return { items, farms, dropped: farms - items.length };
}
