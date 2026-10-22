// Pure maths of the 3D moving objects (web/view3d-sprites-model.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AIRPLANE_ALTITUDE, CAPACITY, HELICOPTER_ALTITUDE, KINDS, READ_INTERVAL, TORNADO_BANDS, baseY, drawsKind,
  shouldRead, spritePlacements, volumesFor,
} from "../view3d-sprites-model.js";
import { cornerAltitudes, WATER_Y } from "../view3d-model.js";

const W = 8, H = 8;
const flatTerrain = (a = 10) => cornerAltitudes(new Uint8Array(W * H).fill(a), W, H);
const GROUND = 2.5; // altitude 10 at every corner: 10 * STEP (0.25)

// One engine record: [kind, frame, x, y, xHot, yHot, width, height], positions in 16ths of a tile.
const rec = (kind, x, y, xHot = 0, yHot = 0) => [kind, 1, x, y, xHot, yHot, 32, 32];
const flat = (...recs) => Int32Array.from(recs.flat());

test("the kinds of the 2D map: train, helicopter, airplane, ship, monster, tornado, explosion, bus", () => {
  assert.deepEqual(Object.keys(KINDS).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) assert.equal(drawsKind(k), true);
  for (const k of [0, 9, -1, 99]) assert.equal(drawsKind(k), false);
});

test("a sprite is placed at (x + xHot, y + yHot) / 16 tiles, as the 2D map does", () => {
  // train: x 24 + hot 8 = 32 sixteenths = tile 2; y 40 + hot 8 = 48 = tile 3
  const r = spritePlacements(flat(rec(1, 24, 40, 8, 8)), flatTerrain(), W, H);
  assert.equal(r.items[0].x, 2);
  assert.equal(r.items[0].z, 3);
});

test("a ground kind stands on the terrain at its place, its box on half its height", () => {
  const b = volumesFor(1, 2, 3, flatTerrain(), W, H); // train
  assert.equal(b.length, 1);
  assert.ok(Math.abs(b[0].y - (GROUND + KINDS[1].volumes[0].cy)) < 1e-12);
  assert.equal(b[0].sx, 0.9);
  assert.equal(b[0].sy, 0.2);
});

test("ground height follows the terrain (bilinear, as the other layers)", () => {
  const high = cornerAltitudes(new Uint8Array(W * H).fill(40), W, H);
  const low = flatTerrain(4);
  const a = volumesFor(5, 2, 2, low, W, H)[0].y;
  const b = volumesFor(5, 2, 2, high, W, H)[0].y;
  assert.ok(b > a + 5, "a monster on high ground stands higher");
});

test("an airplane flies AIRPLANE_ALTITUDE above the ground, fuselage and wing", () => {
  const b = volumesFor(3, 1, 1, flatTerrain(), W, H);
  assert.equal(b.length, 2);
  for (const v of b) assert.ok(Math.abs(v.y - (GROUND + AIRPLANE_ALTITUDE)) < 1e-12);
  assert.equal(b[0].sx, 0.9, "fuselage is long");
  assert.equal(b[1].sz, 0.8, "wing spreads across");
});

test("a helicopter flies HELICOPTER_ALTITUDE above the ground: body and rotor slab above it", () => {
  const b = volumesFor(2, 1, 1, flatTerrain(), W, H);
  assert.equal(b.length, 2);
  const base = GROUND + HELICOPTER_ALTITUDE;
  assert.ok(Math.abs(b[0].y - base) < 1e-12, "body on the base");
  assert.ok(b[1].y > b[0].y, "rotor above the body");
  assert.ok(Math.abs(b[1].y - (base + 0.2)) < 1e-12);
});

test("a ship sits on the water plane, whatever the terrain under it", () => {
  for (const alt of [0, 10, 40]) {
    const b = volumesFor(4, 1, 1, flatTerrain(alt), W, H);
    assert.ok(Math.abs(b[0].y - (WATER_Y + KINDS[4].volumes[0].cy)) < 1e-12);
  }
  assert.equal(baseY(4, 99), WATER_Y);
});

test("a monster is a tall green box, the tornado a stack of shrinking bands, an explosion an orange box", () => {
  const monster = volumesFor(5, 1, 1, flatTerrain(), W, H)[0];
  assert.equal(monster.sy, 1.2);
  assert.ok(monster.sy > monster.sx, "tall");
  assert.deepEqual(monster.rgb.map((c) => Math.round(c * 255)), [0x3a, 0x7d, 0x44]);

  const tornado = volumesFor(6, 1, 1, flatTerrain(), W, H);
  assert.equal(tornado.length, TORNADO_BANDS);
  for (let i = 1; i < tornado.length; i++) {
    assert.ok(tornado[i].sx < tornado[i - 1].sx, "each band narrower");
    assert.ok(tornado[i].y > tornado[i - 1].y, "each band above");
  }

  const boom = volumesFor(7, 1, 1, flatTerrain(), W, H)[0];
  assert.deepEqual(boom.rgb.map((c) => Math.round(c * 255)), [0xff, 0x78, 0x20]);
});

test("a bus is a box on the ground", () => {
  const b = volumesFor(8, 1, 1, flatTerrain(), W, H);
  assert.equal(b.length, 1);
  assert.ok(Math.abs(b[0].y - (GROUND + KINDS[8].volumes[0].cy)) < 1e-12);
});

test("every box has a colour of three components in 0..1", () => {
  for (const k of Object.keys(KINDS)) {
    for (const v of KINDS[k].volumes) {
      assert.equal(v.rgb.length, 3);
      for (const c of v.rgb) assert.ok(c >= 0 && c <= 1);
    }
  }
});

test("an unknown kind has no boxes and is not drawn", () => {
  assert.deepEqual(volumesFor(9, 1, 1, flatTerrain(), W, H), []);
  const r = spritePlacements(flat(rec(9, 16, 16), rec(0, 16, 16)), flatTerrain(), W, H);
  assert.deepEqual([r.items.length, r.drawn, r.dropped], [0, 0, 0]);
});

test("the placements of a read: every kind drawn, counts of sprites and boxes", () => {
  const r = spritePlacements(flat(rec(1, 16, 16), rec(2, 32, 16), rec(3, 48, 16), rec(4, 64, 16),
    rec(5, 80, 16), rec(6, 96, 16), rec(7, 112, 16), rec(8, 128, 16)), flatTerrain(), W, H);
  assert.equal(r.drawn, 8);
  assert.equal(r.dropped, 0);
  assert.equal(r.items.length, 1 + 2 + 2 + 1 + 1 + TORNADO_BANDS + 1 + 1);
});

test("the cap: a sprite that does not fit whole is dropped and counted; a smaller later one still fits", () => {
  // two planes (2 boxes each) with a cap of 3: the first fits, the second does not; a train (1 box) fits
  const r = spritePlacements(flat(rec(3, 16, 16), rec(3, 32, 16), rec(1, 48, 16)), flatTerrain(), W, H, 3);
  assert.equal(r.drawn, 2);
  assert.equal(r.dropped, 1);
  assert.equal(r.items.length, 3);
});

test("the default cap is CAPACITY boxes", () => {
  assert.equal(CAPACITY, 1024);
  const n = 513; // 513 planes of 2 boxes: 1026 > 1024, the last one is dropped
  const recs = [];
  for (let i = 0; i < n; i++) recs.push(rec(3, 16, 16));
  const r = spritePlacements(flat(...recs), flatTerrain(), W, H);
  assert.equal(r.items.length, CAPACITY);
  assert.equal(r.drawn, 512);
  assert.equal(r.dropped, 1);
});

test("a malformed flat list draws nothing; a non-finite record is skipped", () => {
  assert.deepEqual(spritePlacements(Int32Array.from([1, 1, 16]), flatTerrain(), W, H).items, []);
  assert.deepEqual(spritePlacements(null, flatTerrain(), W, H).items, []);
  const bad = [1, 1, 16, 16, 0, 0, 32, Number.NaN];
  assert.equal(spritePlacements(bad, flatTerrain(), W, H).drawn, 0);
});

test("shouldRead: once READ_INTERVAL has passed, at once before the first read", () => {
  assert.equal(shouldRead(READ_INTERVAL - 0.01), false);
  assert.equal(shouldRead(READ_INTERVAL), true);
  assert.equal(shouldRead(Infinity), true);
});
