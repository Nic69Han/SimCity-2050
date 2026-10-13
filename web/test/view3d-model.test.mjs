// 3D view, pure part (web/view3d-model.js): altitudes and their column-major layout, height to
// world units, chunk diffing, tile classification, the geometry and volumes of a chunk, picking by
// ray, and the mock's relief. No Three.js and no browser.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  altitudesOf, cornerAltitudes, cornerY, tileCentreY, groundY, chunkGrid, chunkOf, slotOf, tileOfSlot,
  chunkBounds, dirtyChunks, classify, buildChunk, writeVolumeMatrix, pickTile, footprintTop,
  SEA, STEP, ALT_MAX, WATER_BED, WATER_Y, SLOTS, CHUNK,
} from "../view3d-model.js";
import { MockCity } from "./mock-engine.mjs";

// Tile words of the palette and the tile art (tiles.js, palette.js).
const DIRT = 0, WATER = 2, TREE = 21, ROAD = 64, WIRE = 208, RAIL = 224;
const RES_EMPTY = 240, HOUSE = 249, COM = 432, COM_EMPTY = 423, IND = 621, PORT = 693;

const flat = (w, h, tile = DIRT) => new Uint16Array(w * h).fill(tile);

describe("altitudes", () => {
  test("no heights (the engine without City.heights): flat terrain at sea level", () => {
    const alt = altitudesOf(flat(4, 3), null, 4, 3);
    assert.equal(alt.length, 12);
    assert.ok(alt.every((a) => a === SEA));
  });

  test("heights of the wrong length are ignored (flat at sea level)", () => {
    const alt = altitudesOf(flat(4, 3), new Uint8Array(5).fill(30), 4, 3);
    assert.ok(alt.every((a) => a === SEA));
  });

  test("heights are read with the tiles' layout: index x * height + y", () => {
    const w = 4, h = 3;
    const heights = new Uint8Array(w * h).fill(SEA);
    heights[2 * h + 1] = 40; // tile (2, 1)
    const alt = altitudesOf(flat(w, h), heights, w, h);
    assert.equal(alt[2 * h + 1], 40);
    assert.equal(alt[1 * h + 2], SEA, "the transposed tile is untouched");
  });

  test("values are clamped to 0..=63", () => {
    const alt = altitudesOf(flat(2, 1), Uint8Array.of(0, 63), 2, 1);
    assert.deepEqual([...alt], [0, 63]);
    assert.equal(ALT_MAX, 63);
  });

  test("a water tile lies at most at the bed under the water plane", () => {
    const tiles = flat(2, 1);
    tiles[1] = WATER;
    const alt = altitudesOf(tiles, Uint8Array.of(12, 12), 2, 1);
    assert.equal(alt[0], 12);
    assert.equal(alt[1], WATER_BED);
  });
});

describe("heights to world units", () => {
  test("0.25 world unit per altitude step: sea level is 2, the top 15.75", () => {
    assert.equal(STEP, 0.25);
    assert.equal(WATER_Y, 2);
    const corners = cornerAltitudes(Uint8Array.of(SEA), 1, 1);
    assert.equal(cornerY(corners, 1, 0, 0), 2);
    const top = cornerAltitudes(Uint8Array.of(ALT_MAX), 1, 1);
    assert.equal(cornerY(top, 1, 1, 1), 15.75);
  });

  test("corner altitudes are the mean of the tiles around the corner", () => {
    // 2 x 2 tiles: altitudes (0,0)=8, (1,0)=12, (0,1)=8, (1,1)=12 in column-major order
    const alt = Uint8Array.of(8, 8, 12, 12); // x * 2 + y
    const c = cornerAltitudes(alt, 2, 2); // (3 x 3) corners, index vx * 3 + vy
    assert.equal(c[0 * 3 + 0], 8, "corner of the first tile only");
    assert.equal(c[1 * 3 + 1], (8 + 8 + 12 + 12) / 4, "inner corner: the four tiles");
    assert.equal(c[2 * 3 + 0], 12, "edge corner: the tiles (1, 0) only");
  });

  test("the centre of a tile is the mean of its four corners; ground is bilinear", () => {
    const alt = Uint8Array.of(8, 16); // 2 x 1 tiles
    const c = cornerAltitudes(alt, 2, 1);
    // tile (0, 0) at altitude 8 has corners 8, 12, 8, 12 (the corners see the tile (1, 0) at 16): mean 10
    assert.equal(tileCentreY(c, 1, 0, 0), 10 * STEP);
    const flatC = cornerAltitudes(Uint8Array.of(SEA, SEA, SEA, SEA), 2, 2);
    assert.equal(groundY(flatC, 2, 2, 1.3, 0.7), 2);
  });
});

describe("chunks and slots", () => {
  test("chunk grid: partial chunks at the edges", () => {
    const g = chunkGrid(40, 30);
    assert.equal(g.cw, 3);
    assert.equal(g.ch, 2);
    assert.equal(g.count, 6);
    assert.deepEqual(chunkBounds(g, 5), { x0: 32, y0: 16, x1: 40, y1: 30 });
  });

  for (const [w, h] of [[40, 30], [33, 17], [16, 16], [1, 1]]) {
    test(`slots are unique and round-trip for a ${w} x ${h} map`, () => {
      const g = chunkGrid(w, h);
      const seen = new Set();
      for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
          const s = slotOf(x, y, g);
          assert.ok(s >= 0 && s < g.count * SLOTS);
          assert.ok(!seen.has(s), `slot ${s} used twice`);
          seen.add(s);
          assert.deepEqual(tileOfSlot(s, g), { x, y });
          const c = chunkOf(x, y, g);
          assert.equal(Math.floor(s / SLOTS), c);
          const b = chunkBounds(g, c);
          assert.ok(x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1);
        }
      }
    });
  }

  test("a padding slot past the map edge has no tile", () => {
    const g = chunkGrid(20, 16); // second chunk column holds x 16..19 only
    assert.equal(tileOfSlot(1 * SLOTS + 15 * CHUNK + 15, g), null);
  });
});

describe("which chunks to rebuild", () => {
  const snap = (w, h, tiles, alt) => ({ w, h, tiles: Uint16Array.from(tiles), alt: Uint8Array.from(alt) });

  test("no previous snapshot, or another size: every chunk", () => {
    const g = chunkGrid(40, 30);
    const s = snap(40, 30, flat(40, 30), new Uint8Array(1200).fill(SEA));
    assert.equal(dirtyChunks(null, s, g).length, g.count);
    const other = snap(33, 17, flat(33, 17), new Uint8Array(561).fill(SEA));
    assert.equal(dirtyChunks(s, other, chunkGrid(33, 17)).length, chunkGrid(33, 17).count);
  });

  test("the same tiles and altitudes: nothing to rebuild", () => {
    const g = chunkGrid(40, 30);
    const s = snap(40, 30, flat(40, 30), new Uint8Array(1200).fill(SEA));
    assert.deepEqual(dirtyChunks(s, snap(40, 30, flat(40, 30), new Uint8Array(1200).fill(SEA)), g), []);
  });

  test("one tile changed: its chunk and the chunks of its neighbours", () => {
    const g = chunkGrid(40, 30);
    const tiles = flat(40, 30);
    const prev = snap(40, 30, tiles, new Uint8Array(1200).fill(SEA));
    tiles[10 * 30 + 5] = RES_EMPTY; // tile (10, 5), chunk (0, 0)
    const next = snap(40, 30, tiles, prev.alt);
    assert.deepEqual(dirtyChunks(prev, next, g), [0]);
  });

  test("a tile on a chunk border also dirties the neighbouring chunk", () => {
    const g = chunkGrid(40, 30);
    const tiles = flat(40, 30);
    const prev = snap(40, 30, tiles, new Uint8Array(1200).fill(SEA));
    tiles[15 * 30 + 0] = RES_EMPTY; // tile (15, 0): chunk 0, and its neighbour (16, 0) is chunk 1
    const next = snap(40, 30, tiles, prev.alt);
    assert.deepEqual(dirtyChunks(prev, next, g), [0, 1]);
  });

  test("an altitude change alone dirties the chunk", () => {
    const g = chunkGrid(40, 30);
    const alt = new Uint8Array(1200).fill(SEA);
    const prev = snap(40, 30, flat(40, 30), alt);
    const alt2 = Uint8Array.from(alt);
    alt2[20 * 30 + 20] = 30; // tile (20, 20), inside chunk (1, 1) = 4
    const next = snap(40, 30, flat(40, 30), alt2);
    assert.deepEqual(dirtyChunks(prev, next, g), [chunkOf(20, 20, g)]);
  });

  test("a tile at a chunk corner dirties the four chunks around it", () => {
    const g = chunkGrid(40, 30);
    const alt = new Uint8Array(1200).fill(SEA);
    const prev = snap(40, 30, flat(40, 30), alt);
    const alt2 = Uint8Array.from(alt);
    alt2[16 * 30 + 16] = 30; // tile (16, 16): the corner shared by chunks 0, 1, 3, 4
    const next = snap(40, 30, flat(40, 30), alt2);
    assert.deepEqual(dirtyChunks(prev, next, g), [0, 1, 3, 4]);
  });
});

describe("what a tile is drawn as", () => {
  test("terrain, water, trees, roads, rails and power lines", () => {
    assert.equal(classify(DIRT).kind, "land");
    assert.equal(classify(DIRT).ground, "palette");
    assert.equal(classify(WATER).kind, "water");
    assert.equal(classify(TREE).kind, "tree");
    assert.equal(classify(TREE).height > 0, true);
    assert.equal(classify(ROAD).kind, "road");
    assert.equal(classify(ROAD).ground, "dirt");
    assert.equal(classify(RAIL).kind, "rail");
    assert.equal(classify(WIRE).kind, "wire");
  });

  test("zones: empty zones are ground, built zones are volumes of their kind", () => {
    assert.deepEqual([classify(RES_EMPTY).kind, classify(RES_EMPTY).zone], ["land", "residential"]);
    assert.deepEqual([classify(COM_EMPTY).kind, classify(COM_EMPTY).zone], ["land", "commercial"]);
    assert.equal(classify(HOUSE).kind, "building");
    assert.equal(classify(HOUSE).zone, "residential");
    assert.equal(classify(COM).kind, "building");
    assert.equal(classify(COM).zone, "commercial");
    assert.equal(classify(IND).kind, "building");
    assert.equal(classify(IND).zone, "industrial");
  });

  test("the density raises the volume", () => {
    const low = classify(COM).height;
    const high = classify(COM + 9 * 4).height; // density 4 of the first commercial block
    assert.ok(high > low, `${high} > ${low}`);
  });

  test("other buildings (port) are ground, not volumes", () => {
    assert.equal(classify(PORT).kind, "land");
  });
});

describe("the geometry of a chunk", () => {
  test("a flat sea-level chunk: every vertex at height 2, one quad per tile", () => {
    const w = 16, h = 16, g = chunkGrid(w, h);
    const alt = new Uint8Array(w * h).fill(SEA);
    const corners = cornerAltitudes(alt, w, h);
    const tops = new Float32Array(w * h);
    const { geometry, volumes } = buildChunk({ grid: g, chunk: 0, tiles: flat(w, h), alt, corners, tops });
    assert.equal(geometry.positions.length, w * h * 4 * 3);
    assert.equal(geometry.indices.length, w * h * 6);
    for (let i = 1; i < geometry.positions.length; i += 3) assert.equal(geometry.positions[i], 2);
    assert.equal(volumes.length, 0);
    assert.ok(tops.every((t) => t === 2));
  });

  test("indices stay inside the vertices and normals point up on flat ground", () => {
    const w = 16, h = 16, g = chunkGrid(w, h);
    const corners = cornerAltitudes(new Uint8Array(w * h).fill(SEA), w, h);
    const { geometry } = buildChunk({ grid: g, chunk: 0, tiles: flat(w, h), alt: null, corners, tops: new Float32Array(w * h) });
    const n = geometry.positions.length / 3;
    assert.ok(geometry.indices.every((i) => i < n));
    for (let v = 0; v < n; v++) assert.equal(geometry.normals[v * 3 + 1], 1);
  });

  test("a house is a volume at its tile, on the ground, with its height in its column top", () => {
    const w = 16, h = 16, g = chunkGrid(w, h);
    const corners = cornerAltitudes(new Uint8Array(w * h).fill(SEA), w, h);
    const tiles = flat(w, h);
    tiles[3 * h + 4] = HOUSE; // tile (3, 4)
    const tops = new Float32Array(w * h);
    const { volumes } = buildChunk({ grid: g, chunk: 0, tiles, alt: null, corners, tops });
    assert.equal(volumes.length, 1);
    const v = volumes[0];
    assert.equal(v.slot, slotOf(3, 4, g));
    assert.equal(v.kind, "residential");
    assert.equal(v.base, 2);
    assert.ok(v.sy > 0);
    assert.ok(Math.abs(tops[3 * h + 4] - (2 + v.sy)) < 1e-6);
  });

  test("a power line and a road add strips and boxes; they stay in the chunk's vertex range", () => {
    const w = 16, h = 16, g = chunkGrid(w, h);
    const corners = cornerAltitudes(new Uint8Array(w * h).fill(SEA), w, h);
    const tiles = flat(w, h);
    tiles[1 * h + 1] = ROAD;
    tiles[2 * h + 2] = WIRE;
    const { geometry } = buildChunk({ grid: g, chunk: 0, tiles, alt: null, corners, tops: new Float32Array(w * h) });
    assert.ok(geometry.positions.length / 3 > w * h * 4, "more vertices than the terrain alone");
    assert.ok(geometry.indices.every((i) => i < geometry.positions.length / 3));
  });

  test("the instance matrix places a volume at (x + 0.5, base, y + 0.5) with its scale", () => {
    const out = new Float32Array(16);
    writeVolumeMatrix(out, 0, { x: 3, y: 4, base: 2, sx: 0.78, sy: 1.5, sz: 0.78 });
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
    close(out[0], 0.78);
    close(out[5], 1.5);
    close(out[10], 0.78);
    close(out[12], 3.5);
    close(out[13], 2);
    close(out[14], 4.5);
    assert.equal(out[15], 1);
  });
});

describe("picking by ray", () => {
  const w = 16, h = 16, g = chunkGrid(w, h);
  const flatTops = () => new Float32Array(w * h).fill(2);

  test("a ray straight down picks the tile under it", () => {
    assert.deepEqual(pickTile([5.5, 10, 7.5], [0, -1, 0], g, flatTops(), 2), { x: 5, y: 7 });
  });

  test("an oblique ray picks the tile where it reaches the ground", () => {
    const d = Math.SQRT1_2;
    // from (0.5, 5, 0.5) going +X and down: the ground (y = 2) is reached at X = 3.5
    assert.deepEqual(pickTile([0.5, 5, 0.5], [d, -d, 0], g, flatTops(), 2), { x: 3, y: 0 });
  });

  test("a volume on the way stops the ray: the ray picks the column it hits", () => {
    const d = Math.SQRT1_2;
    const tops = flatTops();
    tops[2 * h + 0] = 4.5; // tile (2, 0) is a tall column
    assert.deepEqual(pickTile([0.5, 5, 0.5], [d, -d, 0], g, tops, 4.5), { x: 2, y: 0 });
  });

  test("a ray that never meets the map picks nothing", () => {
    assert.equal(pickTile([-5, 10, 7.5], [0, 1, 0], g, flatTops(), 2), null);
    assert.equal(pickTile([50, 10, 50], [1, 0, 0], g, flatTops(), 2), null);
  });

  test("the footprint top is the highest column of the clipped footprint", () => {
    const tops = flatTops();
    tops[3 * h + 3] = 6;
    const r = footprintTop(tops, g, [2, 2, 3, 3]);
    assert.deepEqual([r.x0, r.y0, r.x1, r.y1, r.top], [2, 2, 5, 5, 6]);
    const clipped = footprintTop(tops, g, [-1, 14, 3, 3]);
    assert.deepEqual([clipped.x0, clipped.x1, clipped.y0, clipped.y1], [0, 2, 14, 16]);
  });
});

describe("the mock's relief (City.heights)", () => {
  test("one altitude per tile, 0..=63, deterministic for the seed", () => {
    const city = new MockCity(7);
    const a = city.heights();
    assert.equal(a.length, city.width() * city.height());
    assert.ok(a.every((v) => v >= 0 && v <= ALT_MAX));
    assert.deepEqual(city.heights(), a);
    assert.deepEqual(new MockCity(7).heights(), a);
  });

  test("the relief is smooth: neighbours differ by at most 2, along both axes", () => {
    const city = new MockCity(3);
    const w = city.width(), h = city.height(), a = city.heights();
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (x + 1 < w) assert.ok(Math.abs(a[x * h + y] - a[(x + 1) * h + y]) <= 2);
        if (y + 1 < h) assert.ok(Math.abs(a[x * h + y] - a[x * h + y + 1]) <= 2);
      }
    }
  });

  test("the relief has land above and below sea level", () => {
    const a = new MockCity(3).heights();
    assert.ok(a.some((v) => v > SEA) && a.some((v) => v < SEA));
  });

  test("the altitudes built from the mock's heights are flat-free", () => {
    const city = new MockCity(1);
    const alt = altitudesOf(city.tiles(), city.heights(), city.width(), city.height());
    assert.ok(new Set(alt).size > 3);
  });
});
