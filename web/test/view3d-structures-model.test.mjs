// Pure placement maths of the 3D extended buildings (web/view3d-structures-model.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPACITY, COLORS, FOUNTAIN, GENRE, KINDS, MAX_SIDE, MONUMENT, RECORD, SHAPES, SLAB_HEIGHT, TREE,
  TREES_PER_TILE, BLOCK_HEIGHT, bytesOf, clampSide, decodeStructures, groundAt, hashBytes, insideMap,
  layerKey, mapWidth, partsOf, placementsFor, rgbOfHex, sameKey, writeMatrix,
} from "../view3d-structures-model.js";
import { cornerAltitudes, tileCentreY } from "../view3d-model.js";

const W = 8, H = 6;
const flat = (a = 10) => cornerAltitudes(new Uint8Array(W * H).fill(a), W, H);
const rec = (genre, x, y, w, h, state = 0) => ({ genre, x, y, w, h, state });
const place = (genre, x, y, w, h, corners = flat()) =>
  placementsFor([rec(genre, x, y, w, h)], corners, H);
const close = (a, b) => Math.abs(a - b) < 1e-9;

test("the record layout and the kinds are the ones of the contract", () => {
  assert.equal(RECORD, 6);
  assert.deepEqual(GENRE, {
    PARK: 1, SQUARE: 2, MONUMENT: 3, LANDFILL: 20, INCINERATOR: 21, RECYCLING: 22, WASTE_TO_ENERGY: 23,
    SCHOOL: 30, COLLEGE: 31, LIBRARY: 32, MUSEUM: 33, CLINIC: 34, HOSPITAL: 35, PRISON: 36,
  });
  assert.deepEqual(KINDS, ["slab", "tree", "fountain", "obelisk", "block"]);
  assert.equal(Object.keys(CAPACITY).length, KINDS.length);
});

test("decodeStructures reads whole records and ignores a trailing partial one", () => {
  const out = decodeStructures(Int32Array.from([1, 2, 3, 2, 2, 3, 3, 4, 5, 1, 1, 0, 9]));
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { genre: 1, x: 2, y: 3, w: 2, h: 2, state: 3 });
  assert.deepEqual(out[1], { genre: 3, x: 4, y: 5, w: 1, h: 1, state: 0 });
});

test("decodeStructures of nothing, of a non-array, or of a short array is empty", () => {
  assert.deepEqual(decodeStructures(null), []);
  assert.deepEqual(decodeStructures(undefined), []);
  assert.deepEqual(decodeStructures({}), []);
  assert.deepEqual(decodeStructures(Int32Array.from([1, 2, 3])), []);
});

test("footprint sides are clamped to 1..MAX_SIDE; non-integers count as 1", () => {
  assert.equal(MAX_SIDE, 8);
  assert.equal(clampSide(0), 1);
  assert.equal(clampSide(-3), 1);
  assert.equal(clampSide(3), 3);
  assert.equal(clampSide(99), MAX_SIDE);
  assert.equal(clampSide(2.5), 1);
  assert.equal(clampSide(NaN), 1);
  const [r] = decodeStructures(Int32Array.from([1, 0, 0, 50, 0, 0]));
  assert.deepEqual([r.w, r.h], [MAX_SIDE, 1]);
});

test("mapWidth comes from the corner array; an array that does not fit gives 0", () => {
  assert.equal(mapWidth(flat(), H), W);
  assert.equal(mapWidth(new Uint8Array(10), H), 0);
  assert.equal(mapWidth(null, H), 0);
  assert.equal(mapWidth(flat(), 0), 0);
});

test("a footprint must lie entirely on the map", () => {
  assert.equal(insideMap(rec(1, 0, 0, 2, 2), W, H), true);
  assert.equal(insideMap(rec(1, W - 2, H - 2, 2, 2), W, H), true);
  assert.equal(insideMap(rec(1, W - 1, 0, 2, 1), W, H), false);
  assert.equal(insideMap(rec(1, 0, H - 1, 1, 2), W, H), false);
  assert.equal(insideMap(rec(1, -1, 0, 1, 1), W, H), false);
  assert.equal(insideMap(rec(1, 0.5, 0, 1, 1), W, H), false);
});

test("a park is a green slab over its footprint with four trees per tile", () => {
  const r = place(GENRE.PARK, 1, 2, 2, 2);
  assert.equal(r.structures, 1);
  assert.equal(r.dropped, 0);
  assert.equal(r.items.slab.length, 1);
  const slab = r.items.slab[0];
  assert.deepEqual([slab.x, slab.z, slab.sx, slab.sz], [2, 3, 2, 2]);
  assert.ok(close(slab.sy, SLAB_HEIGHT));
  assert.deepEqual(slab.rgb, rgbOfHex(COLORS.park));
  assert.equal(r.items.tree.length, 2 * 2 * TREES_PER_TILE);
  const tree = r.items.tree[0];
  assert.deepEqual(tree.rgb, rgbOfHex(COLORS.tree));
  assert.ok(close(tree.sy, TREE.height));
  assert.ok(close(tree.sx, TREE.radius * 2));
  for (const t of r.items.tree) {
    assert.ok(t.x > 1 && t.x < 3 && t.z > 2 && t.z < 4, "every tree stands inside the footprint");
  }
  assert.equal(r.items.fountain.length + r.items.obelisk.length + r.items.block.length, 0);
});

test("a public square is a beige slab with a fountain cylinder at the centre", () => {
  const r = place(GENRE.SQUARE, 3, 1, 1, 1);
  assert.equal(r.items.slab.length, 1);
  assert.deepEqual(r.items.slab[0].rgb, rgbOfHex(COLORS.square));
  assert.equal(r.items.fountain.length, 1);
  const f = r.items.fountain[0];
  assert.deepEqual([f.x, f.z], [3.5, 1.5]);
  assert.ok(close(f.sy, FOUNTAIN.height));
  assert.equal(r.items.tree.length, 0);
});

test("a monument is a stone base with a tall obelisk above it", () => {
  const corners = flat();
  const r = place(GENRE.MONUMENT, 2, 2, 3, 3, corners);
  assert.equal(r.items.slab.length, 1);
  const base = r.items.slab[0];
  assert.deepEqual(base.rgb, rgbOfHex(COLORS.stone));
  assert.deepEqual([base.sx, base.sy, base.sz], [3, MONUMENT.base, 3]);
  assert.equal(r.items.obelisk.length, 1);
  const o = r.items.obelisk[0];
  assert.deepEqual([o.x, o.z], [3.5, 3.5]);
  assert.ok(close(o.sy, MONUMENT.height));
  assert.ok(close(o.sy, 2.5), "the obelisk is 2.5 world units tall");
  const ground = tileCentreY(corners, H, 3, 3);
  assert.ok(close(base.y - base.sy / 2, ground), "the base sits on the ground under its centre");
  assert.ok(close(o.y - o.sy / 2, base.y + base.sy / 2), "the obelisk stands on the base");
});

test("a genre without a shape is a grey block over its footprint", () => {
  const r = place(42, 0, 0, 2, 1);
  assert.equal(r.items.block.length, 1);
  const b = r.items.block[0];
  assert.deepEqual(b.rgb, rgbOfHex(COLORS.block));
  assert.deepEqual([b.sx, b.sy, b.sz], [2, BLOCK_HEIGHT, 1]);
  assert.equal(place(0, 0, 0, 1, 1).items.block.length, 1);
});

test("the height of a structure follows the terrain under its footprint", () => {
  const corners = flat(10);
  const high = flat(10);
  // raise the corners of tile (4, 1): the square is on a slope
  for (const [vx, vy] of [[4, 1], [5, 1], [4, 2], [5, 2]]) high[vx * (H + 1) + vy] = 40;
  const low = place(GENRE.SQUARE, 4, 1, 1, 1, corners).items.slab[0];
  const up = place(GENRE.SQUARE, 4, 1, 1, 1, high).items.slab[0];
  assert.ok(up.y > low.y, "a raised tile lifts its slab");
  assert.ok(close(up.y - low.y, (40 - 10) * 0.25 / 1), "by the altitude difference of its corners");
  const flatGround = groundAt(corners, H, rec(1, 0, 0, 1, 1));
  assert.ok(close(flatGround, tileCentreY(corners, H, 0, 0)));
});

test("groundAt is the mean of the tile centres of the footprint", () => {
  const corners = flat(10);
  const s = rec(1, 1, 1, 2, 2);
  const mean = (tileCentreY(corners, H, 1, 1) + tileCentreY(corners, H, 2, 1) +
    tileCentreY(corners, H, 1, 2) + tileCentreY(corners, H, 2, 2)) / 4;
  assert.ok(close(groundAt(corners, H, s), mean));
});

test("records off the map are skipped and not counted", () => {
  const r = placementsFor([rec(1, W - 1, 0, 2, 2), rec(3, 0, 0, 1, 1)], flat(), H);
  assert.equal(r.structures, 1);
  assert.equal(r.items.block.length, 0);
  assert.equal(r.items.obelisk.length, 1);
});

test("nothing is placed when the corner array does not match the grid", () => {
  const r = placementsFor([rec(1, 0, 0, 1, 1)], new Uint8Array(7), H);
  assert.equal(r.structures, 0);
  for (const k of KINDS) assert.equal(r.items[k].length, 0);
});

test("no records gives no placements", () => {
  const r = placementsFor([], flat(), H);
  assert.equal(r.structures, 0);
  assert.equal(r.dropped, 0);
  for (const k of KINDS) assert.equal(r.items[k].length, 0);
});

test("instances past the capacity of their shape are dropped and counted", () => {
  const caps = { slab: 1, tree: 3, fountain: 1, obelisk: 1, block: 1 };
  const r = placementsFor([rec(1, 0, 0, 2, 2), rec(1, 2, 0, 2, 2)], flat(), H, caps);
  assert.equal(r.items.slab.length, 1);
  assert.equal(r.items.tree.length, 3);
  assert.equal(r.structures, 2);
  // 2 slabs (1 kept), 32 trees (3 kept)
  assert.equal(r.dropped, 1 + 29);
});

test("the default capacities hold a whole big city, and a bigger one is dropped and counted", () => {
  const n = CAPACITY.slab + 3; // slabs past the capacity
  const cols = 2 * n;
  const corners = cornerAltitudes(new Uint8Array(cols * 2), cols, 2);
  const records = Array.from({ length: n }, (_, i) => rec(1, 2 * i, 0, 2, 2));
  const r = placementsFor(records, corners, 2);
  assert.equal(r.items.slab.length, CAPACITY.slab);
  assert.equal(r.items.tree.length, CAPACITY.tree);
  assert.equal(r.dropped, 3 + (n * 4 * TREES_PER_TILE - CAPACITY.tree));
});

test("partsOf gives the shapes of one structure, standing on the base height", () => {
  const parts = partsOf(rec(GENRE.PARK, 0, 0, 1, 1), 5);
  assert.equal(parts[0][0], SHAPES.SLAB);
  assert.equal(parts[0][1].y, 5 + SLAB_HEIGHT / 2);
  assert.equal(parts.length, 1 + TREES_PER_TILE);
});

test("rgbOfHex gives 0..1 components", () => {
  assert.deepEqual(rgbOfHex("#ffffff"), [1, 1, 1]);
  assert.deepEqual(rgbOfHex("#000000"), [0, 0, 0]);
  const [r, g, b] = rgbOfHex("#ff8000");
  assert.ok(close(r, 1) && close(g, 128 / 255) && close(b, 0));
});

test("writeMatrix writes a column-major translation and scale", () => {
  const out = new Float32Array(32);
  writeMatrix(out, 16, { x: 1, y: 2, z: 3, sx: 4, sy: 5, sz: 6 });
  assert.deepEqual(Array.from(out.slice(16, 32)), [
    4, 0, 0, 0,
    0, 5, 0, 0,
    0, 0, 6, 0,
    1, 2, 3, 1,
  ]);
  assert.equal(out[0], 0, "the slot before the offset is untouched");
});

test("hashBytes is FNV-1a (32 bits): the empty string and \"a\"", () => {
  assert.equal(hashBytes(new Uint8Array(0)), 0x811c9dc5);
  assert.equal(hashBytes(Uint8Array.from([0x61])), 0xe40c292c);
  assert.equal(bytesOf(Int32Array.from([1, 2])).length, 8, "two int32 values are eight bytes");
  assert.notEqual(hashBytes(bytesOf(Int32Array.from([1, 2]))), hashBytes(bytesOf(Int32Array.from([0, 0]))));
});

test("layerKey and sameKey: equal bytes, rule and corners are the same; anything else rebuilds", () => {
  const corners = flat();
  const data = Int32Array.from([1, 0, 0, 2, 2, 0]);
  const key = layerKey(data, true, corners);
  assert.equal(sameKey(key, layerKey(Int32Array.from([1, 0, 0, 2, 2, 0]), true, corners)), true);
  assert.equal(sameKey(key, layerKey(Int32Array.from([1, 0, 0, 2, 2, 1]), true, corners)), false);
  assert.equal(sameKey(key, layerKey(data.subarray(0, 0), true, corners)), false);
  assert.equal(sameKey(key, layerKey(data, false, corners)), false);
  assert.equal(sameKey(key, layerKey(data, true, flat())), false, "new corners array");
  assert.equal(sameKey(null, key), false);
  assert.equal(sameKey(key, null), false);
});

test("layerKey without records is a key of its own (rule off, nothing read)", () => {
  const corners = flat();
  const off = layerKey(null, false, corners);
  assert.deepEqual([off.rules, off.hash, off.length], [false, null, 0]);
  assert.equal(sameKey(off, layerKey(null, false, corners)), true);
  assert.equal(sameKey(off, layerKey(Int32Array.from([]), false, corners)), false);
});
