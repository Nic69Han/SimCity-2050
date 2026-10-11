// Map renderer: turns the engine's tiles into pixels. Presentation only (ARCHITECTURE.md rule 5).
import { TILE_PX } from "./tools.js";
import { PALETTE, buildRgbTable } from "./palette.js";

const LOMASK = 0x03ff;

// `createRenderer({ canvas, frame })` -> { draw(city) }: draws every tile of `city` on `canvas`
// at TILE_PX pixels per tile. `frame` gets the CSS aspect ratio so the page scales it exactly.
export function createRenderer({ canvas, frame }) {
  const ctx = canvas.getContext("2d");
  const rgb = buildRgbTable(PALETTE); // one ABGR word per tile character, from palette.js
  let image = null;

  function draw(city) {
    const w = city.width(), h = city.height(), tiles = city.tiles();
    if (!image || image.width !== w * TILE_PX || image.height !== h * TILE_PX) {
      canvas.width = w * TILE_PX;
      canvas.height = h * TILE_PX;
      // CSS scales the frame to the viewport at this ratio (style.css); tiles stay exact.
      frame.style.setProperty("--ratio", `${w} / ${h}`);
      image = ctx.createImageData(w * TILE_PX, h * TILE_PX);
    }
    const px = new Uint32Array(image.data.buffer);
    const stride = w * TILE_PX;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const c = rgb[tiles[x * h + y] & LOMASK];
        const base = y * TILE_PX * stride + x * TILE_PX;
        for (let dy = 0; dy < TILE_PX; dy++) px.fill(c, base + dy * stride, base + dy * stride + TILE_PX);
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  return { draw };
}
