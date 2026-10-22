// 3D highways, pure part (docs/game-design-v13.md, "Autoroutes" and "Chantiers" 3D): which tiles of the
// engine's highway layer get an elevated deck and where its pillars stand. No DOM, no Three.js, so node:test
// can check it. view3d-highways.js turns the placements into two instanced meshes (decks, pillars).
//
// The highway layer is one byte per tile, column-major like the engine: index = x * h + y. A highway tile
// is a tile whose byte is HIGHWAY (1). Its deck is a thin slab lifted DECK_LIFT above the terrain at the tile
// centre (view3d-model.js, tileCentreY). A pillar, from the ground up to the underside of the deck, stands on
// every tile whose (x + y) is a multiple of PILLAR_EVERY, so along a straight run there is one pillar every
// PILLAR_EVERY tiles. World X = tile x, Z = tile y, Y = height. Units: 1 world unit = 1 tile.
import { tileCentreY } from "./view3d-model.js";
import { rgbOfHex } from "./view3d-structures-model.js";

export const HIGHWAY = 1;
// Deck instances (one per highway tile). Past it, highway tiles are dropped and counted, never written out of
// bounds. Equal to the engine's MAX_HIGHWAY_TILES (4096), so the engine's cap is never hit by the page.
export const CAPACITY = 4096;
export const DECK_LIFT = 0.5; // height of the deck's centre above the terrain at the tile centre
export const DECK_THICKNESS = 0.06;
export const DECK_WIDTH = 0.9; // the deck covers most of its tile
export const PILLAR_EVERY = 3; // a pillar on each tile with (x + y) % PILLAR_EVERY === 0
export const PILLAR_WIDTH = 0.08;
export const DECK_COLOR = "#8a8f94";
export const PILLAR_COLOR = "#6b7075";
export const DECK_RGB = Object.freeze(rgbOfHex(DECK_COLOR));
export const PILLAR_RGB = Object.freeze(rgbOfHex(PILLAR_COLOR));

// Whether the tile (x, y) carries a pillar.
export function hasPillar(x, y) {
  return (x + y) % PILLAR_EVERY === 0;
}

// The deck over tile (x, y): a slab DECK_LIFT above the terrain at the tile centre.
export function deckPlacement(x, y, corners, h) {
  const ground = tileCentreY(corners, h, x, y);
  return {
    x: x + 0.5, y: ground + DECK_LIFT, z: y + 0.5,
    sx: DECK_WIDTH, sy: DECK_THICKNESS, sz: DECK_WIDTH, rgb: DECK_RGB,
  };
}

// The pillar under the deck of tile (x, y): a thin box from the terrain up to the underside of the deck.
export function pillarPlacement(x, y, corners, h) {
  const ground = tileCentreY(corners, h, x, y);
  const height = DECK_LIFT - DECK_THICKNESS / 2;
  return {
    x: x + 0.5, y: ground + height / 2, z: y + 0.5,
    sx: PILLAR_WIDTH, sy: height, sz: PILLAR_WIDTH, rgb: PILLAR_RGB,
  };
}

// The placements of the highway layer. `bytes` is the engine's array, (w, h) the map size, `corners` the
// terrain (view3d-model.js). Walks at most w * h bytes. Returns { decks, pillars, tiles, dropped }: `tiles`
// counts the highway tiles of the map, `decks` holds one deck per tile (at most `cap`), `pillars` the pillars
// of those decks, `dropped` the highway tiles past `cap`.
export function highwayPlacements(bytes, corners, w, h, cap = CAPACITY) {
  const decks = [];
  const pillars = [];
  let tiles = 0;
  if (!ArrayBuffer.isView(bytes) || !(w > 0) || !(h > 0)) return { decks, pillars, tiles, dropped: 0 };
  const n = Math.min(bytes.length, w * h);
  for (let i = 0; i < n; i++) {
    if (bytes[i] !== HIGHWAY) continue;
    tiles++;
    if (decks.length >= cap) continue;
    const x = Math.floor(i / h), y = i % h;
    decks.push(deckPlacement(x, y, corners, h));
    if (hasPillar(x, y)) pillars.push(pillarPlacement(x, y, corners, h));
  }
  return { decks, pillars, tiles, dropped: tiles - decks.length };
}
