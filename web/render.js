// Map renderer: turns the engine's tiles into pixels with the tile art of tiles.js.
// Presentation only (ARCHITECTURE.md rule 5). A redraw only repaints the tiles whose picture
// changed since the last one (the key of each tile is kept), then uploads that rectangle.
import { TILE_PX } from "./tools.js";
import { artKey, createAtlas, shimmerPhase } from "./tiles.js";
import { createSpriteLayer } from "./sprites-art.js";

// `createRenderer({ canvas, frame, doc, now })` -> { draw(city), sprites, atlas }:
//   draw(city) paints every tile of `city` on `canvas` at TILE_PX pixels per tile and the city's
//   moving objects on a transparent layer above it. `frame` gets the CSS aspect ratio so the page
//   scales it exactly. `now()` is the clock (milliseconds) of the shimmer.
export function createRenderer({ canvas, frame, doc = globalThis.document, now = () => performance.now() }) {
  const ctx = canvas.getContext("2d");
  const atlas = createAtlas({ doc, px: TILE_PX });
  const sprites = createSpriteLayer({ doc, map: canvas, tilePx: TILE_PX });
  let image = null; // ImageData of the whole map
  let pixels = null; // the same pixels as ABGR words
  let keys = null; // artKey of the picture currently on each tile (column-major)
  let width = 0, height = 0;

  function resize(w, h) {
    canvas.width = w * TILE_PX;
    canvas.height = h * TILE_PX;
    // CSS scales the frame to the viewport at this ratio (style.css); tiles stay exact.
    frame.style.setProperty("--ratio", `${w} / ${h}`);
    image = ctx.createImageData(w * TILE_PX, h * TILE_PX);
    pixels = new Uint32Array(image.data.buffer);
    keys = new Int32Array(w * h).fill(-1);
    width = w;
    height = h;
  }

  function draw(city) {
    const w = city.width(), h = city.height(), tiles = city.tiles();
    if (!image || w !== width || h !== height) resize(w, h);
    const S = TILE_PX;
    const stride = w * S;
    const phase = shimmerPhase(now());
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const i = x * h + y;
        const key = artKey(tiles[i], x, y, phase);
        if (keys[i] === key) continue;
        keys[i] = key;
        const cell = atlas.cell(key);
        const base = y * S * stride + x * S;
        for (let dy = 0; dy < S; dy++) {
          pixels.set(cell.subarray(dy * S, dy * S + S), base + dy * stride);
        }
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 >= 0) {
      ctx.putImageData(image, 0, 0, x0 * S, y0 * S, (x1 - x0 + 1) * S, (y1 - y0 + 1) * S);
    }
    // Tests read the engine tiles the page last drew (the canvas pixels are art, not tiles).
    canvas.mapTiles = { w, h, tiles };
    sprites.paint(city, now());
  }

  return { draw, sprites: sprites.canvas, atlas };
}
