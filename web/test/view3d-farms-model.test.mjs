// The 3D farms, pure part: which tiles are farms, column-major, their slabs and the capacity cap.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FARM, CAPACITY, FIELD_HEIGHT, FIELD_COLORS, farmPlacements, fieldPlacement, fieldRgbOf,
} from "../view3d-farms-model.js";
import { cornerAltitudes, tileCentreY } from "../view3d-model.js";
import { rgbOfHex } from "../view3d-structures-model.js";

const W = 3, H = 2;
// Flat terrain at altitude 10 (2.5 world units): every tile centre is at 2.5.
const flat = cornerAltitudes(new Uint8Array(W * H).fill(10), W, H);
const GROUND = 10 * 0.25;

describe("the farm tiles", () => {
  test("the farm value is 4", () => {
    assert.equal(FARM, 4);
  });

  test("a farm at column-major index x * h + y gives a slab at tile (x, y)", () => {
    const bytes = new Uint8Array(W * H);
    bytes[1 * H + 1] = FARM; // column-major index 1 * 2 + 1 = 3 (a row-major walk would put it at 1 * 3 + 1 = 4)
    const { items, farms, dropped } = farmPlacements(bytes, flat, W, H);
    assert.equal(farms, 1);
    assert.equal(dropped, 0);
    assert.equal(items.length, 1);
    assert.equal(items[0].x, 1.5);
    assert.equal(items[0].z, 1.5);
  });

  test("index 1 is tile (0, 1), not (1, 0): the walk is column-major", () => {
    const bytes = new Uint8Array(W * H);
    bytes[1] = FARM;
    const [p] = farmPlacements(bytes, flat, W, H).items;
    assert.equal(p.x, 0.5);
    assert.equal(p.z, 1.5);
  });

  test("only the value 4 makes a farm; nothing, light, medium and dense do not", () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 0, 1]);
    assert.deepEqual(farmPlacements(bytes, flat, W, H), { items: [], farms: 0, dropped: 0 });
  });

  test("bytes past width * height are not walked", () => {
    const bytes = new Uint8Array(W * H + 2).fill(FARM);
    const { farms } = farmPlacements(bytes, flat, W, H);
    assert.equal(farms, W * H);
  });

  test("a non-typed array, or an empty map, gives nothing", () => {
    assert.deepEqual(farmPlacements([4, 4], flat, W, H), { items: [], farms: 0, dropped: 0 });
    assert.deepEqual(farmPlacements(new Uint8Array(W * H).fill(FARM), flat, 0, H), { items: [], farms: 0, dropped: 0 });
  });
});

describe("the field slab", () => {
  test("a thin slab over the tile, its bottom on the tile centre", () => {
    const p = fieldPlacement(1, 0, flat, H);
    assert.equal(p.sx, 1);
    assert.equal(p.sy, FIELD_HEIGHT);
    assert.equal(p.sz, 1);
    assert.equal(FIELD_HEIGHT, 0.03);
    assert.equal(p.y, GROUND + FIELD_HEIGHT / 2);
  });

  test("the height follows the terrain at the tile centre", () => {
    const hilly = cornerAltitudes(Uint8Array.from([10, 20, 10, 10, 20, 10]), W, H);
    const p = fieldPlacement(0, 0, hilly, H);
    assert.equal(p.y, tileCentreY(hilly, H, 0, 0) + FIELD_HEIGHT / 2);
  });

  test("two field colours alternate by the parity of x + y", () => {
    assert.equal(FIELD_COLORS.length, 2);
    assert.deepEqual(fieldRgbOf(0, 0), rgbOfHex(FIELD_COLORS[0]));
    assert.deepEqual(fieldRgbOf(1, 0), rgbOfHex(FIELD_COLORS[1]));
    assert.deepEqual(fieldRgbOf(0, 1), rgbOfHex(FIELD_COLORS[1]));
    assert.deepEqual(fieldRgbOf(1, 1), rgbOfHex(FIELD_COLORS[0]));
    assert.deepEqual(fieldPlacement(1, 1, flat, H).rgb, fieldRgbOf(1, 1));
  });
});

describe("the capacity", () => {
  test("CAPACITY is the cap of the instances", () => {
    assert.equal(CAPACITY, 4096);
  });

  test("farm tiles past the capacity are dropped and counted, never placed", () => {
    const cols = CAPACITY + 2;
    const corners = cornerAltitudes(new Uint8Array(cols).fill(10), cols, 1);
    const bytes = new Uint8Array(cols).fill(FARM);
    const { items, farms, dropped } = farmPlacements(bytes, corners, cols, 1);
    assert.equal(items.length, CAPACITY);
    assert.equal(farms, cols);
    assert.equal(dropped, 2);
  });

  test("an explicit cap is honoured", () => {
    const bytes = new Uint8Array(W * H).fill(FARM);
    const { items, farms, dropped } = farmPlacements(bytes, flat, W, H, 2);
    assert.equal(items.length, 2);
    assert.equal(farms, W * H);
    assert.equal(dropped, W * H - 2);
  });
});
