// The 3D shapes of the public services, genres 30-36 (web/view3d-structures-model.js, docs/game-design-v09.md).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_HEIGHT, CAPACITY, CLINIC, COLLEGE, COLORS, GENRE, HOSPITAL, KINDS, LIBRARY, MAX_SIDE, MUSEUM,
  PRISON, SCHOOL, SHAPES, partsOf, placementsFor, rgbOfHex,
} from "../view3d-structures-model.js";
import { cornerAltitudes } from "../view3d-model.js";

const W = 8, H = 6;
const flat = () => cornerAltitudes(new Uint8Array(W * H).fill(10), W, H);
const rec = (genre, x, y, w, h) => ({ genre, x, y, w, h, state: 0 });
const close = (a, b) => Math.abs(a - b) < 1e-9;
const SERVICES = [30, 31, 32, 33, 34, 35, 36];

// The parts of one structure standing on height 0 (exact numbers), grouped by shape.
function partsAt(genre, x, y, w, h) {
  const out = Object.fromEntries(KINDS.map((k) => [k, []]));
  for (const [shape, p] of partsOf(rec(genre, x, y, w, h), 0)) out[shape].push(p);
  return out;
}
const colorsOf = (list) => list.map((p) => p.rgb.join(","));
const RED = rgbOfHex(COLORS.roof).join(",");
const CROSS = rgbOfHex(COLORS.cross).join(",");
const WHITE = rgbOfHex(COLORS.white).join(",");
const BEIGE = rgbOfHex(COLORS.beige).join(",");

// Whether the box lies inside the footprint [x, x + w] x [y, y + h] (with a small tolerance).
function insideFootprint(p, x, y, w, h) {
  const e = 1e-9;
  return p.x - p.sx / 2 >= x - e && p.x + p.sx / 2 <= x + w + e &&
    p.z - p.sz / 2 >= y - e && p.z + p.sz / 2 <= y + h + e;
}

describe("every service genre has a shape, with the kinds of the contract", () => {
  test("genres 30-36 each give at least one block, and only known shapes", () => {
    for (const g of SERVICES) {
      const parts = partsOf(rec(g, 0, 0, 2, 2), 0);
      assert.ok(parts.length >= 1, `genre ${g}`);
      assert.ok(parts.some(([shape]) => shape === SHAPES.BLOCK), `genre ${g} has a body`);
      for (const [shape] of parts) assert.ok(KINDS.includes(shape), `genre ${g}`);
    }
  });

  test("a service never uses the tree, fountain or obelisk meshes", () => {
    for (const g of SERVICES) {
      const parts = partsAt(g, 0, 0, 3, 3);
      assert.equal(parts.tree.length + parts.fountain.length + parts.obelisk.length, 0, `genre ${g}`);
    }
  });

  test("a genre not listed keeps the grey block", () => {
    const parts = partsAt(37, 0, 0, 2, 1);
    assert.equal(parts.block.length, 1);
    assert.deepEqual(parts.block[0].rgb, rgbOfHex(COLORS.block));
    assert.equal(parts.block[0].sy, BLOCK_HEIGHT);
  });
});

describe("the shapes of each service", () => {
  test("school: a beige block with a red roof slab over it", () => {
    const p = partsAt(GENRE.SCHOOL, 1, 1, 2, 2);
    assert.equal(p.block.length, 1);
    assert.equal(p.slab.length, 1);
    const body = p.block[0], roof = p.slab[0];
    assert.equal(colorsOf(p.block)[0], BEIGE);
    assert.equal(colorsOf(p.slab)[0], RED);
    assert.ok(close(body.sy, SCHOOL.height));
    assert.ok(close(body.y, SCHOOL.height / 2), "stands on the base");
    assert.ok(close(roof.y - roof.sy / 2, SCHOOL.height), "the roof sits on the body");
    assert.ok(close(roof.sy, SCHOOL.roof));
    assert.deepEqual([body.sx, body.sz], [2, 2]);
    assert.deepEqual([roof.sx, roof.sz], [2, 2], "the roof covers the footprint");
  });

  test("college: one larger beige block, taller than a school, no roof", () => {
    const p = partsAt(GENRE.COLLEGE, 0, 0, 3, 3);
    assert.equal(p.block.length, 1);
    assert.equal(p.slab.length, 0);
    assert.equal(colorsOf(p.block)[0], BEIGE);
    assert.ok(close(p.block[0].sy, COLLEGE.height));
    assert.ok(COLLEGE.height > SCHOOL.height, "larger than the school");
  });

  test("library: a stone block inset from the edges, with two columns per tile on its front edge", () => {
    const p = partsAt(GENRE.LIBRARY, 2, 3, 2, 2);
    assert.equal(p.block.length, 1);
    const body = p.block[0];
    assert.ok(close(body.sx, 2 - 2 * LIBRARY.inset));
    assert.ok(close(body.x, 3), "centred on the footprint");
    assert.equal(p.slab.length, 2 * LIBRARY.columnsPerTile, "columns along the front edge only: width x per tile");
    for (const c of p.slab) {
      assert.equal(colorsOf([c])[0], rgbOfHex(COLORS.column).join(","));
      assert.ok(close(c.sy, LIBRARY.height), "each column reaches the top of the body");
      assert.ok(c.z < 3 + 0.5 && c.z > 3, "the columns stand on the front (north) edge");
      assert.ok(c.x > 2 && c.x < 4, "every column is inside the footprint");
    }
    const xs = p.slab.map((c) => c.x);
    assert.ok(close(xs[0], 2 + 0.25) && close(xs[3], 2 + 1.75), "spread evenly across the width");
  });

  test("library columns are bounded by the clamped footprint width", () => {
    const p = partsAt(GENRE.LIBRARY, 0, 0, 100, 1);
    assert.equal(p.slab.length, MAX_SIDE * LIBRARY.columnsPerTile);
  });

  test("museum: one wide white block", () => {
    const p = partsAt(GENRE.MUSEUM, 0, 0, 3, 3);
    assert.equal(p.block.length, 1);
    assert.equal(p.slab.length, 0);
    assert.equal(colorsOf(p.block)[0], WHITE);
    assert.ok(close(p.block[0].sy, MUSEUM.height));
    assert.deepEqual([p.block[0].sx, p.block[0].sz], [3, 3]);
  });

  test("clinic: a small white box with a red cross of two thin boxes on its top", () => {
    const p = partsAt(GENRE.CLINIC, 4, 2, 1, 1);
    assert.equal(p.block.length, 1);
    assert.equal(colorsOf(p.block)[0], WHITE);
    assert.ok(close(p.block[0].sy, CLINIC.height));
    assert.equal(p.slab.length, 2, "two thin red boxes");
    for (const bar of p.slab) {
      assert.equal(colorsOf([bar])[0], CROSS);
      assert.ok(close(bar.y - bar.sy / 2, CLINIC.height), "the cross stands on the top");
      assert.ok(close(bar.sy, CLINIC.cross.height));
      assert.ok(insideFootprint(bar, 4, 2, 1, 1), "the cross is inside the footprint");
    }
    const [a, b] = p.slab;
    assert.deepEqual([a.sx, a.sz], [CLINIC.cross.thick, CLINIC.cross.arm]);
    assert.deepEqual([b.sx, b.sz], [CLINIC.cross.arm, CLINIC.cross.thick]);
    assert.ok(close(a.x, 4.5) && close(a.z, 2.5), "the two bars cross at the centre");
    assert.ok(close(b.x, 4.5) && close(b.z, 2.5));
  });

  test("hospital: a taller white block with a bigger red cross than the clinic", () => {
    const p = partsAt(GENRE.HOSPITAL, 0, 0, 3, 3);
    assert.equal(p.block.length, 1);
    assert.equal(colorsOf(p.block)[0], WHITE);
    assert.ok(close(p.block[0].sy, HOSPITAL.height));
    assert.ok(HOSPITAL.height > CLINIC.height);
    assert.equal(p.slab.length, 2);
    for (const bar of p.slab) assert.equal(colorsOf([bar])[0], CROSS);
    assert.ok(close(p.slab[0].sz, HOSPITAL.cross.arm));
    assert.ok(HOSPITAL.cross.arm > CLINIC.cross.arm);
    for (const bar of p.slab) assert.ok(close(bar.y - bar.sy / 2, HOSPITAL.height));
  });

  test("prison: a dark block inside a low wall of four thin boxes around its yard", () => {
    const p = partsAt(GENRE.PRISON, 1, 1, 3, 3);
    assert.equal(p.block.length, 1);
    assert.equal(colorsOf(p.block)[0], rgbOfHex(COLORS.prison).join(","));
    const body = p.block[0];
    assert.ok(close(body.sx, 3 - 2 * PRISON.inset), "the block is inset from the footprint");
    assert.ok(close(body.sy, PRISON.height));
    assert.ok(insideFootprint(body, 1, 1, 3, 3));
    assert.equal(p.slab.length, 4, "four walls");
    for (const wall of p.slab) {
      assert.equal(colorsOf([wall])[0], rgbOfHex(COLORS.prisonWall).join(","));
      assert.ok(close(wall.sy, PRISON.wall.height), "a low wall");
      const longSide = Math.max(wall.sx, wall.sz), thinSide = Math.min(wall.sx, wall.sz);
      assert.ok(close(longSide, 3) && close(thinSide, PRISON.wall.thick), "a thin box as long as the footprint side");
      assert.ok(insideFootprint(wall, 1, 1, 3, 3), "the walls stand on the footprint edge");
    }
    assert.ok(PRISON.wall.height < PRISON.height, "the wall is lower than the block");
  });

  test("the walls of a prison ring its block: each one is on one side of the body", () => {
    const p = partsAt(GENRE.PRISON, 0, 0, 4, 4);
    const body = p.block[0];
    const north = p.slab.find((w) => close(w.z, PRISON.wall.thick / 2));
    const south = p.slab.find((w) => close(w.z, 4 - PRISON.wall.thick / 2));
    const west = p.slab.find((w) => close(w.x, PRISON.wall.thick / 2));
    const east = p.slab.find((w) => close(w.x, 4 - PRISON.wall.thick / 2));
    assert.ok(north && south && west && east, "one wall on each side");
    assert.ok(north.z + north.sz / 2 < body.z - body.sz / 2, "north wall is outside the block");
    assert.ok(south.z - south.sz / 2 > body.z + body.sz / 2, "south wall is outside the block");
    assert.ok(west.x + west.sx / 2 < body.x - body.sx / 2, "west wall is outside the block");
    assert.ok(east.x - east.sx / 2 > body.x + body.sx / 2, "east wall is outside the block");
  });
});

describe("services stand on the ground and count against the capacities", () => {
  test("the base height lifts every part of a service", () => {
    for (const g of SERVICES) {
      const low = partsOf(rec(g, 0, 0, 2, 2), 0);
      const high = partsOf(rec(g, 0, 0, 2, 2), 3);
      assert.equal(low.length, high.length, `genre ${g}`);
      low.forEach(([, a], i) => assert.ok(close(high[i][1].y - a.y, 3), `genre ${g} part ${i}`));
    }
  });

  test("no service part sinks below its base", () => {
    for (const g of SERVICES) {
      for (const [, p] of partsOf(rec(g, 0, 0, 3, 3), 0)) {
        assert.ok(p.y - p.sy / 2 >= -1e-9, `genre ${g}`);
      }
    }
  });

  test("a row of schools past the block capacity drops and counts the extra bodies", () => {
    const caps = { ...CAPACITY, block: 1 };
    const corners = cornerAltitudes(new Uint8Array(4 * 2 * H).fill(10), 4, H);
    const r = placementsFor([rec(GENRE.SCHOOL, 0, 0, 2, 2), rec(GENRE.SCHOOL, 2, 0, 2, 2)], corners, H, caps);
    assert.equal(r.structures, 2);
    assert.equal(r.items.block.length, 1);
    assert.equal(r.items.slab.length, 2, "two roofs");
    assert.equal(r.dropped, 1);
  });

  test("a full map of services fits the default capacities", () => {
    const corners = flat();
    const records = [rec(GENRE.LIBRARY, 0, 0, 2, 2), rec(GENRE.CLINIC, 4, 0, 1, 1), rec(GENRE.PRISON, 0, 3, 3, 3)];
    const r = placementsFor(records, corners, H);
    assert.equal(r.dropped, 0);
    assert.equal(r.structures, 3);
    assert.ok(r.items.block.length <= CAPACITY.block);
    assert.ok(r.items.slab.length <= CAPACITY.slab);
  });
});

test("the services' colours are the ones of the table", () => {
  assert.equal(COLORS.beige, "#e6d3a8");
  assert.equal(COLORS.roof, "#c62828");
  assert.equal(COLORS.white, "#f5f5f0");
  assert.equal(COLORS.cross, "#d32f2f");
  assert.equal(COLORS.prison, "#4f5358");
  assert.equal(COLORS.prisonWall, "#7a7e85");
  assert.equal(COLORS.column, "#d8d3c8");
  assert.equal(COLORS.libraryStone, "#a59f94");
});
