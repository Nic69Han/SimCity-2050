// The night lights, pure part: intensity, windows per volume and caps, lit structures, lamp spacing.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../view3d-night-model.js";
import { cornerAltitudes } from "../view3d-model.js";
import { GENRE, groundAt } from "../view3d-structures-model.js";

const ROAD = 77; // road on power, horizontal: roadMask E|W, so classify() gives "road"
const DIRT = 0; // bare earth: a land tile
const FLAT = (w, h) => cornerAltitudes(new Uint8Array(w * h).fill(10), w, h);
const vol = (over = {}) => ({ kind: "residential", x: 2, y: 3, base: 0.5, sx: 0.78, sy: 1.0, sz: 0.78, rgb: [1, 1, 1], ...over });
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("intensity is 1 - daylight, clamped; absent daylight is day", () => {
  assert.equal(m.intensityOf(1), 0);
  assert.equal(m.intensityOf(0), 1);
  assert.equal(m.intensityOf(0.25), 0.75);
  assert.equal(m.intensityOf(undefined), 0, "absent = day");
  assert.equal(m.intensityOf(null), 0);
  assert.equal(m.intensityOf(Number.NaN), 0);
  assert.equal(m.intensityOf(2), 0, "above 1 clamps to 0");
  assert.equal(m.intensityOf(-1), 1, "below 0 clamps to 1");
});

test("tileHash is deterministic, a uint32, and tells tiles apart", () => {
  assert.equal(m.tileHash(4, 7, 1), m.tileHash(4, 7, 1));
  const seen = new Set();
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) seen.add(m.tileHash(x, y, 0));
  assert.ok(seen.size > 250, `few collisions among 256 tiles: ${seen.size}`);
  for (const v of seen) assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
});

test("storeys: at least 1, at most MAX_LEVELS, by LEVEL_HEIGHT", () => {
  assert.equal(m.levelsOf(0.5), 1);
  assert.equal(m.levelsOf(0.9), 3);
  assert.equal(m.levelsOf(50), m.MAX_LEVELS);
});

test("windows per volume: base, plus per storey above the first, capped", () => {
  assert.equal(m.windowCountOf(1), m.WINDOWS_BASE);
  assert.equal(m.windowCountOf(2), m.WINDOWS_BASE + m.WINDOWS_PER_LEVEL);
  assert.equal(m.windowCountOf(3), m.WINDOWS_BASE + 2 * m.WINDOWS_PER_LEVEL);
  assert.equal(m.windowCountOf(m.MAX_LEVELS), m.MAX_WINDOWS_PER_VOLUME, "six storeys reach the cap");
  assert.equal(m.windowCountOf(99), m.MAX_WINDOWS_PER_VOLUME, "the cap holds for any height");
});

test("a volume gets exactly windowCountOf(levelsOf(height)) windows, a taller one more", () => {
  const short = m.volumeWindows(vol({ sy: 0.5 }));
  const tall = m.volumeWindows(vol({ sy: 1.8 }));
  assert.equal(short.length, m.windowCountOf(m.levelsOf(0.5)));
  assert.equal(tall.length, m.windowCountOf(m.levelsOf(1.8)));
  assert.ok(tall.length > short.length);
  assert.equal(m.volumeWindows(vol({ sy: 60 })).length, m.MAX_WINDOWS_PER_VOLUME, "bounded");
});

test("each window stands on a side face of its volume, inside its height", () => {
  const v = vol({ sy: 1.8, base: 2 });
  const cx = v.x + 0.5, cz = v.y + 0.5, half = v.sx / 2, t = m.WINDOW.thick / 2;
  for (const p of m.volumeWindows(v)) {
    const onX = near(Math.abs(p.x - cx), half + t, 1e-6);
    const onZ = near(Math.abs(p.z - cz), half + t, 1e-6);
    assert.ok(onX !== onZ, `on exactly one face: ${JSON.stringify(p)}`);
    assert.ok(p.y > v.base && p.y < v.base + v.sy, `inside the height: ${p.y}`);
    assert.equal(p.sy, m.WINDOW.height);
  }
});

test("volume windows are deterministic: the same tile, the same windows", () => {
  assert.deepEqual(m.volumeWindows(vol()), m.volumeWindows(vol()));
  assert.notDeepEqual(m.volumeWindows(vol({ x: 2 })), m.volumeWindows(vol({ x: 9 })), "another tile, other places");
});

test("windowPlacements: zone volumes only (no trees), counted, with the cap", () => {
  const lists = [[vol(), vol({ kind: "tree" }), vol({ kind: "commercial", x: 5 })]];
  const per = m.volumeWindows(vol()).length;
  const r = m.windowPlacements({ volumeLists: lists, records: [], corners: FLAT(8, 8), w: 8, h: 8 });
  assert.equal(r.items.length, 2 * per, "two buildings, the tree gets none");
  assert.equal(r.dropped, 0);
  const capped = m.windowPlacements({ volumeLists: lists, records: [], corners: FLAT(8, 8), w: 8, h: 8 }, 5);
  assert.equal(capped.items.length, 5);
  assert.equal(capped.dropped, 2 * per - 5, "extra windows dropped and counted");
});

test("the default window capacity holds: a full city drops the rest and counts it", () => {
  assert.equal(m.WINDOW_CAPACITY, 16384);
  const many = Array.from({ length: 2000 }, (_, i) => vol({ x: i % 60, y: Math.floor(i / 60), sy: 9 }));
  const r = m.windowPlacements({ volumeLists: [many], records: [], corners: FLAT(64, 64), w: 64, h: 64 });
  assert.equal(r.items.length, m.WINDOW_CAPACITY);
  assert.equal(r.dropped, 2000 * m.MAX_WINDOWS_PER_VOLUME - m.WINDOW_CAPACITY);
});

test("structures: only powered, lit genres, on the map, with a window row on every facade", () => {
  const corners = FLAT(10, 10);
  const powered = { genre: GENRE.GAS, x: 1, y: 1, w: 2, h: 2, state: 1 };
  const off = { ...powered, state: 0 };
  const watered = { ...powered, state: 2 };
  const both = { ...powered, state: 3 };
  assert.equal(m.isLitStructure(powered, 10, 10), true);
  assert.equal(m.isLitStructure(off, 10, 10), false, "unpowered: dark");
  assert.equal(m.isLitStructure(watered, 10, 10), false, "watered alone does not light it");
  assert.equal(m.isLitStructure(both, 10, 10), true);
  assert.equal(m.isLitStructure({ ...powered, genre: GENRE.PARK }, 10, 10), false, "a park has no walls");
  assert.equal(m.isLitStructure({ ...powered, genre: GENRE.SQUARE }, 10, 10), false);
  assert.equal(m.isLitStructure({ ...powered, genre: GENRE.MONUMENT }, 10, 10), false);
  assert.equal(m.isLitStructure({ ...powered, x: 9 }, 10, 10), false, "off the map");
  const r = m.windowPlacements({ volumeLists: [], records: [off, powered, watered, both], corners, w: 10, h: 10 });
  assert.equal(r.items.length, 2 * m.structureWindows(powered, corners, 10).length, "only the two powered records");
});

test("a structure's windows: STRUCTURE_WINDOWS_PER_TILE per tile of each facade, at the lit row", () => {
  const corners = FLAT(10, 10);
  const s = { genre: GENRE.SCHOOL, x: 2, y: 3, w: 2, h: 1, state: 1 };
  const ws = m.structureWindows(s, corners, 10);
  assert.equal(ws.length, 2 * (s.w + s.h) * m.STRUCTURE_WINDOWS_PER_TILE);
  for (const p of ws) assert.ok(p.x >= s.x - 0.1 && p.x <= s.x + s.w + 0.1 && p.z >= s.y - 0.1 && p.z <= s.y + s.h + 0.1);
  const row = groundAt(corners, 10, s) + m.STRUCTURE_WINDOW_Y;
  for (const p of ws) assert.ok(near(p.y, row), `the lit row: ${p.y} vs ${row}`);
});

test("a structure record is bounded by its clamped sides", () => {
  const big = { genre: GENRE.COLLEGE, x: 0, y: 0, w: 99, h: 99, state: 1 };
  const ws = m.structureWindows({ ...big, w: 8, h: 8 }, FLAT(10, 10), 10);
  assert.equal(ws.length, 2 * (8 + 8) * m.STRUCTURE_WINDOWS_PER_TILE);
});

test("lamps: every LAMP_SPACING-th road tile, counted in the engine's order", () => {
  assert.equal(m.LAMP_SPACING, 6);
  const w = 3, h = 3; // 9 tiles, all roads
  const tiles = new Uint16Array(w * h).fill(ROAD);
  assert.deepEqual(m.lampTiles(tiles, w, h), [0, 6], "the 1st and the 7th road tile");
  assert.deepEqual(m.lampTiles(tiles, w, h, 2), [0, 2, 4, 6, 8]);
});

test("lamps count only road tiles", () => {
  const tiles = new Uint16Array([DIRT, ROAD, DIRT, ROAD, ROAD, DIRT]);
  assert.deepEqual(m.lampTiles(tiles, 2, 3, 2), [1, 4], "the 1st and the 3rd road tile");
  assert.deepEqual(m.lampTiles(new Uint16Array(4), 2, 2), [], "no road, no lamp");
});

test("lamp spacing must be a whole number >= 1", () => {
  assert.throws(() => m.lampTiles(new Uint16Array(4), 2, 2, 0), RangeError);
  assert.throws(() => m.lampTiles(new Uint16Array(4), 2, 2, 1.5), RangeError);
});

test("a lamp is a post standing on the ground, with its head on top, set in its tile", () => {
  const w = 2, h = 2;
  const tiles = new Uint16Array([ROAD, DIRT, DIRT, DIRT]);
  const r = m.lampPlacements(tiles, FLAT(w, h), w, h);
  assert.equal(r.posts.length, 1);
  assert.equal(r.heads.length, 1);
  assert.equal(r.dropped, 0);
  const p = r.posts[0], hd = r.heads[0];
  const ground = 10 * 0.25; // flat altitude 10, STEP 0.25
  assert.ok(near(p.x, 0.5 + m.LAMP.offset) && near(p.z, 0.5 + m.LAMP.offset), "set into the tile");
  assert.ok(near(p.y - p.sy / 2, ground), "the post stands on the ground");
  assert.ok(near(p.sy, m.LAMP.height), "post height");
  assert.ok(near(hd.y - hd.sy / 2, ground + m.LAMP.height), "the head starts at the top of the post");
  assert.ok(near(hd.x, p.x) && near(hd.z, p.z), "head above the post");
});

test("lamp caps: past LAMP_CAPACITY the lamps are dropped and counted", () => {
  assert.equal(m.LAMP_CAPACITY, 2048);
  const w = 4, h = 4;
  const tiles = new Uint16Array(w * h).fill(ROAD);
  const r = m.lampPlacements(tiles, FLAT(w, h), w, h, 1);
  assert.equal(r.posts.length, 1);
  assert.equal(r.heads.length, 1);
  assert.equal(r.dropped, m.lampTiles(tiles, w, h).length - 1);
});
