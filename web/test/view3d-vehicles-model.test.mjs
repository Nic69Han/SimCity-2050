// Pure maths of the 3D vehicles (web/view3d-vehicles-model.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_VEHICLES_3D, READ_INTERVAL, SIZES, buildPlacements, decodeVehicles, interpolate, kindColor,
  shouldRead, sizeOf, writeVehicleMatrix, yawFor,
} from "../view3d-vehicles-model.js";
import { cornerAltitudes, tileCentreY } from "../view3d-model.js";

const W = 6, H = 5;
const flat = (a = 10) => cornerAltitudes(new Uint8Array(W * H).fill(a), W, H);

test("decodes records: id, kind, sixteenths of a tile to tiles, direction", () => {
  const v = decodeVehicles(Int32Array.from([7, 1, 32, 48, 2, 9, 0, 0, 48, 3]));
  assert.deepEqual(v, [
    { id: 7, kind: 1, x: 2, y: 3, dir: 2 },
    { id: 9, kind: 0, x: 0, y: 3, dir: 3 },
  ]);
});

test("truncated input: a partial trailing record is ignored; empty or missing input gives nothing", () => {
  assert.equal(decodeVehicles(Int32Array.from([1, 0, 16, 16, 0, 2, 16])).length, 1);
  assert.deepEqual(decodeVehicles(Int32Array.from([1, 0, 16])), []);
  assert.deepEqual(decodeVehicles(new Int32Array(0)), []);
  assert.deepEqual(decodeVehicles(null), []);
  assert.deepEqual(decodeVehicles(undefined), []);
});

test("a record with a non-finite field is skipped", () => {
  const v = decodeVehicles([1, 0, 16, 16, 0, 2, 0, Number.NaN, 16, 0]);
  assert.deepEqual(v.map((x) => x.id), [1]);
});

test("interpolate: positions move from prev to next by t, t clamped to [0, 1]", () => {
  const prev = [{ id: 1, kind: 0, dir: 1, x: 0, y: 0 }];
  const next = [{ id: 1, kind: 0, dir: 1, x: 2, y: 4 }];
  const at = (t) => interpolate(prev, next, t)[0];
  assert.deepEqual([at(0).x, at(0).y], [0, 0]);
  assert.deepEqual([at(0.5).x, at(0.5).y], [1, 2]);
  assert.deepEqual([at(1).x, at(1).y], [2, 4]);
  assert.deepEqual([at(3).x, at(3).y], [2, 4], "above 1 is clamped");
  assert.deepEqual([at(-1).x, at(-1).y], [0, 0], "below 0 is clamped");
  assert.deepEqual([at(Number.NaN).x], [0], "NaN counts as 0");
  assert.equal(at(0.5).dir, 1, "direction comes from the new read");
});

test("interpolate matches by id: a new id appears at its place, a vanished id is removed", () => {
  const prev = [
    { id: 1, kind: 0, dir: 0, x: 0, y: 0 },
    { id: 2, kind: 0, dir: 0, x: 5, y: 5 },
  ];
  const next = [
    { id: 3, kind: 1, dir: 2, x: 9, y: 1 },
    { id: 1, kind: 0, dir: 0, x: 1, y: 0 },
  ];
  const out = interpolate(prev, next, 0.5);
  assert.deepEqual(out.map((v) => v.id), [3, 1]);
  assert.deepEqual([out[0].x, out[0].y], [9, 1], "a new vehicle is not interpolated");
  assert.equal(out[1].x, 0.5);
  assert.deepEqual(interpolate([], [], 0.3), []);
});

test("interpolate with no previous read puts every vehicle at its new place", () => {
  const next = decodeVehicles(Int32Array.from([4, 0, 80, 32, 1]));
  assert.deepEqual(interpolate([], next, 0), next);
});

test("yaw: north -Z, east +X, south +Z, west -X (a box's length along its way)", () => {
  // local X rotated by the yaw: (cos, 0, -sin); "+ 0" turns a rounded -0 into 0
  const axis = (d) => [Math.round(Math.cos(yawFor(d))) + 0, Math.round(-Math.sin(yawFor(d))) + 0];
  assert.deepEqual(axis(0), [0, -1], "north");
  assert.deepEqual(axis(1), [1, 0], "east");
  assert.deepEqual(axis(2), [0, 1], "south");
  assert.deepEqual(axis(3), [-1, 0], "west");
  assert.equal(yawFor(5), yawFor(1), "the direction wraps modulo 4");
  assert.equal(yawFor(-1), yawFor(3));
  assert.equal(yawFor(Number.NaN), yawFor(0));
});

test("the matrix of a box turns it to its yaw, scales it to its size and moves it to the place", () => {
  const out = new Float32Array(16);
  writeVehicleMatrix(out, 0, { x: 2.5, y: 0.7, z: 1.5, yaw: yawFor(2) }, SIZES[0]);
  const along = [out[0], out[2]].map((c) => c / SIZES[0].length); // image of local X, unit length
  assert.ok(Math.abs(along[0]) < 1e-6 && Math.abs(along[1] - 1) < 1e-6, "south: +Z");
  [2.5, 0.7, 1.5, 1].forEach((v, i) => assert.ok(Math.abs(out[12 + i] - v) < 1e-6, `translation ${i}`));
  assert.ok(Math.abs(out[5] - SIZES[0].height) < 1e-6);
});

test("the size table: one box per kind 0 to 4, the car, bus, taxi, train and metro sizes", () => {
  assert.deepEqual(Object.keys(SIZES), ["0", "1", "2", "3", "4"]);
  assert.deepEqual(SIZES[0], { length: 0.35, height: 0.2, width: 0.18 });
  assert.deepEqual(SIZES[1], { length: 0.8, height: 0.3, width: 0.22 });
  assert.deepEqual(SIZES[2], { length: 0.33, height: 0.2, width: 0.18 });
  assert.deepEqual(SIZES[3], { length: 0.9, height: 0.3, width: 0.25 });
  assert.deepEqual(SIZES[4], { length: 0.9, height: 0.3, width: 0.25 });
  for (const k of [0, 1, 2, 3, 4]) {
    for (const d of ["length", "height", "width"]) assert.ok(SIZES[k][d] > 0, `kind ${k} ${d}`);
  }
  assert.ok(Object.isFrozen(SIZES));
});

test("the size of a kind; an unknown kind has the car's size", () => {
  for (const k of [0, 1, 2, 3, 4]) assert.equal(sizeOf(k), SIZES[k]);
  for (const k of [5, 42, -1, 1.5, Number.NaN, "toString"]) assert.equal(sizeOf(k), SIZES[0], `kind ${k}`);
});

test("the matrix scales each kind's box to its own size, whatever the yaw", () => {
  for (const kind of [0, 1, 2, 3, 4]) {
    for (const dir of [0, 1, 2, 3]) {
      const out = new Float32Array(16);
      writeVehicleMatrix(out, 0, { x: 1, y: 1, z: 1, yaw: yawFor(dir) }, sizeOf(kind));
      const s = sizeOf(kind);
      const tag = `kind ${kind} dir ${dir}`;
      assert.ok(Math.abs(Math.hypot(out[0], out[2]) - s.length) < 1e-6, `length ${tag}`);
      assert.ok(Math.abs(out[5] - s.height) < 1e-6, `height ${tag}`);
      assert.ok(Math.abs(Math.hypot(out[8], out[10]) - s.width) < 1e-6, `width ${tag}`);
    }
  }
});

test("the matrix of a bus and of a train is longer than a car's", () => {
  const len = (size) => {
    const out = new Float32Array(16);
    writeVehicleMatrix(out, 0, { x: 0, y: 0, z: 0, yaw: 0 }, size);
    return Math.hypot(out[0], out[2]);
  };
  assert.ok(Math.abs(len(sizeOf(1)) - 0.8) < 1e-6, "bus");
  assert.ok(len(sizeOf(3)) > len(sizeOf(0)), "train longer than car");
  assert.ok(len(sizeOf(1)) > len(sizeOf(2)), "bus longer than taxi");
});

test("the matrix writes at its offset, one 16-value block per instance", () => {
  const out = new Float32Array(32);
  writeVehicleMatrix(out, 16, { x: 3, y: 4, z: 5, yaw: 0 }, SIZES[1]);
  assert.deepEqual(Array.from(out.slice(0, 16)), new Array(16).fill(0), "the first block untouched");
  assert.equal(out[16 + 12], 3);
  assert.equal(out[16 + 15], 1);
  assert.ok(Math.abs(out[16 + 5] - SIZES[1].height) < 1e-6);
});

test("kind colours: one per kind, distinct; an unknown kind is drawn as a car", () => {
  const cols = [0, 1, 2, 3, 4].map((k) => kindColor(k).join(","));
  assert.equal(new Set(cols).size, 5);
  assert.deepEqual(kindColor(42), kindColor(0));
  for (const c of kindColor(1)) assert.ok(c >= 0 && c <= 1);
});

test("reads are due every READ_INTERVAL seconds; before the first read always", () => {
  assert.equal(shouldRead(Infinity), true);
  assert.equal(shouldRead(READ_INTERVAL), true);
  assert.equal(shouldRead(READ_INTERVAL - 0.01), false);
  assert.equal(shouldRead(Number.NaN), false);
});

test("placements: the box stands on the tile ground, carries its yaw and colour", () => {
  const corners = flat();
  const { items, dropped } = buildPlacements({
    w: W, h: H, corners, vehicles: [{ id: 1, kind: 1, dir: 1, x: 2.25, y: 3.5 }],
  });
  assert.equal(dropped, 0);
  const p = items[0];
  assert.equal(p.x, 2.25);
  assert.equal(p.z, 3.5);
  assert.ok(Math.abs(p.y - (tileCentreY(corners, H, 2, 3) + SIZES[1].height / 2)) < 1e-9);
  assert.equal(p.yaw, yawFor(1));
  assert.deepEqual(p.rgb, kindColor(1));
  assert.deepEqual(p.size, SIZES[1]);
});

test("placements: each box has the size of its kind and stands on half of its own height", () => {
  const corners = flat();
  const vehicles = [0, 1, 2, 3, 4, 99].map((kind, i) => ({ id: i, kind, dir: 0, x: 1.5, y: 1.5 }));
  const { items } = buildPlacements({ w: W, h: H, corners, vehicles });
  const ground = tileCentreY(corners, H, 1, 1);
  items.forEach((p, i) => {
    const size = sizeOf(vehicles[i].kind);
    assert.deepEqual(p.size, size, `kind ${vehicles[i].kind}`);
    assert.ok(Math.abs(p.y - (ground + size.height / 2)) < 1e-9, `height of kind ${vehicles[i].kind}`);
  });
  assert.deepEqual(items[5].size, SIZES[0], "an unknown kind is a car");
});

test("placements: a position outside the grid still uses a ground tile of the grid", () => {
  const corners = flat();
  const { items } = buildPlacements({
    w: W, h: H, corners, vehicles: [{ id: 1, kind: 0, dir: 0, x: -0.5, y: H + 3 }],
  });
  assert.ok(Number.isFinite(items[0].y));
  assert.ok(Math.abs(items[0].y - (tileCentreY(corners, H, 0, H - 1) + SIZES[0].height / 2)) < 1e-9);
});

test("capacity: vehicles past it are dropped and counted, never placed", () => {
  const vehicles = Array.from({ length: 10 }, (_, i) => ({ id: i, kind: 0, dir: 0, x: 1, y: 1 }));
  const r = buildPlacements({ w: W, h: H, corners: flat(), vehicles, capacity: 4 });
  assert.equal(r.items.length, 4);
  assert.equal(r.dropped, 6);
  assert.equal(buildPlacements({ w: W, h: H, corners: flat(), vehicles: [] }).items.length, 0);
  assert.equal(MAX_VEHICLES_3D, 4000);
});
