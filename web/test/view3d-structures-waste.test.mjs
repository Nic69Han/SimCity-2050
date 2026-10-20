// The 3D shapes of the waste genres 20-23 (web/view3d-structures-model.js, docs/game-design-v08.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHIMNEY, COLORS, DUMP, DUMP_BOXES, GENRE, ROOF_HEIGHT, SHAPES, SHED_HEIGHT, WASTE_BODY_HEIGHT,
  partsOf, placementsFor, rgbOfHex, BLOCK_HEIGHT,
} from "../view3d-structures-model.js";
import { cornerAltitudes, tileCentreY } from "../view3d-model.js";

const W = 8, H = 6;
const flat = (a = 10) => cornerAltitudes(new Uint8Array(W * H).fill(a), W, H);
const rec = (genre, x, y, w, h) => ({ genre, x, y, w, h, state: 0 });
const close = (a, b) => Math.abs(a - b) < 1e-9;
const place = (genre, x, y, w, h) => placementsFor([rec(genre, x, y, w, h)], flat(), H);

// The top of a placement and its bottom, in world units.
const top = (p) => p.y + p.sy / 2;
const bottom = (p) => p.y - p.sy / 2;
const inside = (p, x, y, w, h) =>
  p.x - p.sx / 2 >= x - 1e-9 && p.x + p.sx / 2 <= x + w + 1e-9 &&
  p.z - p.sz / 2 >= y - 1e-9 && p.z + p.sz / 2 <= y + h + 1e-9;

test("the waste genres are 20 to 23 (the contract of the design)", () => {
  assert.equal(GENRE.LANDFILL, 20);
  assert.equal(GENRE.INCINERATOR, 21);
  assert.equal(GENRE.RECYCLING, 22);
  assert.equal(GENRE.WASTE_TO_ENERGY, 23);
});

test("a landfill is a flat brown slab 3x3 with dark boxes on top, inside the footprint", () => {
  const r = place(GENRE.LANDFILL, 1, 1, 3, 3);
  assert.equal(r.structures, 1);
  assert.equal(r.items.slab.length, 1);
  const mound = r.items.slab[0];
  assert.deepEqual(mound.rgb, rgbOfHex(COLORS.landfill));
  assert.deepEqual([mound.sx, mound.sz], [3, 3]);
  assert.ok(close(mound.sy, DUMP.mound), "a flat mound");
  assert.ok(inside(mound, 1, 1, 3, 3));
  assert.equal(r.items.block.length, DUMP_BOXES.length, "one block per dark box");
  for (const b of r.items.block) {
    assert.deepEqual(b.rgb, rgbOfHex(COLORS.dumpBox));
    assert.ok(close(b.sy, DUMP.box));
    assert.ok(close(bottom(b), top(mound)), "a box stands on the mound top");
    assert.ok(inside(b, 1, 1, 3, 3), "a box stays on the footprint");
  }
  assert.equal(r.items.obelisk.length + r.items.fountain.length + r.items.tree.length, 0);
});

test("the dark boxes of a landfill sit at the fractions of DUMP_BOXES", () => {
  const r = place(GENRE.LANDFILL, 0, 0, 4, 4);
  const centres = r.items.block.map((b) => [b.x, b.z]);
  assert.deepEqual(centres, DUMP_BOXES.map(([fx, fz]) => [fx * 4, fz * 4]));
});

test("an incinerator is a grey block with a tall thin chimney above it", () => {
  const r = place(GENRE.INCINERATOR, 2, 2, 2, 2);
  assert.equal(r.items.slab.length, 0);
  assert.equal(r.items.block.length, 2, "the body and the chimney");
  const [body, stack] = r.items.block;
  assert.deepEqual(body.rgb, rgbOfHex(COLORS.incinerator));
  assert.deepEqual([body.sx, body.sy, body.sz], [2, WASTE_BODY_HEIGHT, 2]);
  assert.ok(close(bottom(body), tileCentreY(flat(), H, 2, 2)), "the body stands on the ground");
  assert.deepEqual(stack.rgb, rgbOfHex(COLORS.chimney));
  assert.ok(close(stack.sy, CHIMNEY.height));
  assert.ok(close(bottom(stack), top(body)), "the chimney stands on the body");
  assert.ok(stack.sx < body.sx && stack.sz < body.sz, "thin against the body");
  assert.ok(stack.sy > body.sy, "tall");
  assert.ok(inside(stack, 2, 2, 2, 2), "the chimney stands in the footprint");
});

test("a recycling centre is a low wide green shed", () => {
  const r = place(GENRE.RECYCLING, 0, 0, 2, 2);
  assert.equal(r.items.block.length, 1);
  assert.equal(r.items.slab.length, 0);
  const shed = r.items.block[0];
  assert.deepEqual(shed.rgb, rgbOfHex(COLORS.shed));
  assert.deepEqual([shed.sx, shed.sy, shed.sz], [2, SHED_HEIGHT, 2]);
  assert.ok(shed.sy < BLOCK_HEIGHT, "lower than a plain block");
  assert.ok(shed.sy < WASTE_BODY_HEIGHT, "lower than an incinerator");
  assert.equal(r.items.block.length + r.items.slab.length, 1, "no chimney");
});

test("a waste-to-energy plant is a grey block, a blue roof slab, and a chimney on top", () => {
  const r = place(GENRE.WASTE_TO_ENERGY, 4, 1, 3, 3);
  assert.equal(r.items.block.length, 2, "the body and the chimney");
  assert.equal(r.items.slab.length, 1, "the roof");
  const body = r.items.block[0];
  const roof = r.items.slab[0];
  const stack = r.items.block[1];
  assert.deepEqual(body.rgb, rgbOfHex(COLORS.plant));
  assert.deepEqual(roof.rgb, rgbOfHex(COLORS.roof));
  assert.ok(close(roof.sy, ROOF_HEIGHT));
  assert.ok(close(bottom(roof), top(body)), "the roof lies on the body");
  assert.ok(close(bottom(stack), top(roof)), "the chimney stands on the roof");
  assert.ok(inside(roof, 4, 1, 3, 3));
  assert.ok(stack.sy > body.sy, "a tall chimney");
});

test("the waste shapes stand on the terrain under their footprint", () => {
  const corners = flat(10);
  const raised = flat(10);
  for (const [vx, vy] of [[4, 1], [5, 1], [4, 2], [5, 2]]) raised[vx * (H + 1) + vy] = 40;
  const low = placementsFor([rec(GENRE.INCINERATOR, 4, 1, 1, 1)], corners, H).items.block[0];
  const up = placementsFor([rec(GENRE.INCINERATOR, 4, 1, 1, 1)], raised, H).items.block[0];
  assert.ok(up.y > low.y, "a raised tile lifts the block");
});

test("the parts of each waste genre come in the right order: ground first, then what stands on it", () => {
  const parts = partsOf(rec(GENRE.WASTE_TO_ENERGY, 0, 0, 2, 2), 5);
  assert.deepEqual(parts.map(([k]) => k), [SHAPES.BLOCK, SHAPES.SLAB, SHAPES.BLOCK]);
  assert.ok(close(bottom(parts[0][1]), 5), "the body stands on the base");
  const landfill = partsOf(rec(GENRE.LANDFILL, 0, 0, 3, 3), 5);
  assert.equal(landfill.length, 1 + DUMP_BOXES.length);
  assert.equal(landfill[0][0], SHAPES.SLAB);
});

test("a waste genre whose footprint is off the map is skipped and not counted", () => {
  const r = placementsFor([rec(GENRE.LANDFILL, W - 1, 0, 3, 3), rec(GENRE.RECYCLING, 0, 0, 1, 1)], flat(), H);
  assert.equal(r.structures, 1);
  assert.equal(r.items.block.length, 1);
});
