// Pure maths of the 3D highways (web/view3d-highways-model.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPACITY, DECK_LIFT, DECK_THICKNESS, DECK_WIDTH, PILLAR_EVERY, PILLAR_WIDTH, deckPlacement, hasPillar,
  highwayPlacements, pillarPlacement,
} from "../view3d-highways-model.js";
import { cornerAltitudes, tileCentreY } from "../view3d-model.js";

const W = 6, H = 5;
const flat = (a = 10) => cornerAltitudes(new Uint8Array(W * H).fill(a), W, H);
const bytesWith = (cells, w = W, h = H) => {
  const b = new Uint8Array(w * h);
  for (const [x, y] of cells) b[x * h + y] = 1; // engine order: index = x * height + y
  return b;
};

test("the capacity is the engine's highway cap (4096 tiles)", () => {
  assert.equal(CAPACITY, 4096);
});

test("a pillar every PILLAR_EVERY tiles along x + y", () => {
  assert.equal(PILLAR_EVERY, 3);
  assert.equal(hasPillar(0, 0), true);
  assert.equal(hasPillar(1, 2), true);
  assert.equal(hasPillar(1, 1), false);
  assert.equal(hasPillar(4, 5), true, "9 is a multiple of 3");
  assert.equal(hasPillar(4, 4), false, "8 is not");
});

test("a straight run along x gets one pillar every PILLAR_EVERY tiles", () => {
  const cells = [];
  for (let x = 0; x < W; x++) cells.push([x, 1]);
  const r = highwayPlacements(bytesWith(cells), flat(), W, H);
  assert.equal(r.decks.length, W);
  assert.equal(r.pillars.length, 2, "along y = 1 the pillars are at x = 2 and x = 5 ((x + 1) % 3 === 0)");
});

test("the deck of a tile lies DECK_LIFT above the terrain at the tile centre", () => {
  const c = flat(10); // every corner at altitude 10: the centre is 2.5 world units
  const d = deckPlacement(1, 2, c, H);
  assert.equal(d.x, 1.5);
  assert.equal(d.z, 2.5);
  assert.equal(d.y, tileCentreY(c, H, 1, 2) + DECK_LIFT);
  assert.equal(d.sx, DECK_WIDTH);
  assert.equal(d.sy, DECK_THICKNESS);
  assert.equal(d.sz, DECK_WIDTH);
  assert.equal(d.rgb.length, 3);
});

test("the pillar stands from the terrain up to the underside of the deck", () => {
  const c = flat(10);
  const p = pillarPlacement(0, 0, c, H);
  const ground = tileCentreY(c, H, 0, 0);
  const height = DECK_LIFT - DECK_THICKNESS / 2;
  assert.equal(p.sy, height);
  assert.ok(Math.abs(p.y - (ground + height / 2)) < 1e-12, "centred on half its height above the ground");
  assert.equal(p.sx, PILLAR_WIDTH);
  assert.equal(p.sz, PILLAR_WIDTH);
});

test("a deck follows the terrain: a higher tile gets a higher deck", () => {
  const low = new Uint8Array(W * H).fill(4);
  const high = new Uint8Array(W * H).fill(40);
  const a = deckPlacement(2, 2, cornerAltitudes(low, W, H), H);
  const b = deckPlacement(2, 2, cornerAltitudes(high, W, H), H);
  assert.ok(b.y > a.y);
});

test("one deck per highway tile, pillars only on the multiples; other bytes are ignored", () => {
  const bytes = bytesWith([[0, 0], [1, 1], [2, 2]]);
  bytes[3] = 2; // a byte that is not a highway
  const r = highwayPlacements(bytes, flat(), W, H);
  assert.equal(r.tiles, 3);
  assert.equal(r.decks.length, 3);
  assert.equal(r.pillars.length, 1, "(0,0) has a pillar, (1,1) and (2,2) do not: sums 0, 2, 4");
  assert.equal(r.dropped, 0);
});

test("the cap: highway tiles past it are dropped and counted, never placed", () => {
  const cells = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  const r = highwayPlacements(bytesWith(cells), flat(), W, H, 3);
  assert.equal(r.tiles, 5);
  assert.equal(r.decks.length, 3);
  assert.equal(r.dropped, 2);
  assert.equal(r.pillars.length, 1, "only the first three tiles can hold a pillar");
});

test("the default cap is CAPACITY", () => {
  const w = 70, h = 60; // 4200 tiles, all highway
  const bytes = new Uint8Array(w * h).fill(1);
  const r = highwayPlacements(bytes, cornerAltitudes(new Uint8Array(w * h), w, h), w, h);
  assert.equal(r.tiles, w * h);
  assert.equal(r.decks.length, CAPACITY);
  assert.equal(r.dropped, w * h - CAPACITY);
});

test("invalid input draws nothing: not a typed array, empty map, no grid", () => {
  for (const bad of [[1, 1], null, undefined]) {
    const r = highwayPlacements(bad, flat(), W, H);
    assert.deepEqual([r.decks.length, r.pillars.length, r.tiles, r.dropped], [0, 0, 0, 0]);
  }
  assert.equal(highwayPlacements(bytesWith([[0, 0]]), flat(), 0, H).tiles, 0);
  assert.equal(highwayPlacements(bytesWith([[0, 0]]), flat(), W, 0).tiles, 0);
});

test("a short byte array is walked to its length only; a long one to w * h", () => {
  const short = new Uint8Array(4).fill(1);
  assert.equal(highwayPlacements(short, flat(), W, H).tiles, 4);
  const long = new Uint8Array(W * H + 10).fill(1);
  assert.equal(highwayPlacements(long, flat(), W, H).tiles, W * H);
});
