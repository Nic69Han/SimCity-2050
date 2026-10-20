// The 3D shapes of the power plants, genres 40-46 (web/view3d-structures-model.js, docs/game-design-v10.md).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_HEIGHT, CAPACITY, COLORS, FUSION, GAS, GENRE, HYDRO, KINDS, MICROWAVE, OIL, SOLAR, WIND,
  partsOf, placementsFor, rgbOfHex,
} from "../view3d-structures-model.js";
import { cornerAltitudes } from "../view3d-model.js";

const W = 8, H = 6;
const flat = () => cornerAltitudes(new Uint8Array(W * H).fill(10), W, H);
const rec = (genre, x, y, w, h) => ({ genre, x, y, w, h, state: 0 });
const close = (a, b) => Math.abs(a - b) < 1e-9;
const PLANTS = [40, 41, 42, 43, 44, 45, 46];

// The parts of one structure standing on height `base` (default 0), grouped by shape.
function partsAt(genre, x, y, w, h, base = 0) {
  const out = Object.fromEntries(KINDS.map((k) => [k, []]));
  for (const [shape, p] of partsOf(rec(genre, x, y, w, h), base)) out[shape].push(p);
  return out;
}
const hexOf = (hex) => rgbOfHex(hex).join(",");
const colorsOf = (list) => list.map((p) => p.rgb.join(","));

// Whether the box lies inside the footprint [x, x + w] x [y, y + h] (with a small tolerance).
function insideFootprint(p, x, y, w, h) {
  const e = 1e-9;
  return p.x - p.sx / 2 >= x - e && p.x + p.sx / 2 <= x + w + e &&
    p.z - p.sz / 2 >= y - e && p.z + p.sz / 2 <= y + h + e;
}
const bottom = (p) => p.y - p.sy / 2;
const top = (p) => p.y + p.sy / 2;

describe("every power plant genre has a shape, with the kinds of the contract", () => {
  test("genres 40-46 each give at least one part, and only known shapes", () => {
    for (const g of PLANTS) {
      const parts = partsOf(rec(g, 0, 0, 3, 3), 0);
      assert.ok(parts.length >= 1, `genre ${g}`);
      for (const [shape] of parts) assert.ok(KINDS.includes(shape), `genre ${g}`);
    }
  });

  test("a plant never uses the tree, fountain or obelisk meshes", () => {
    for (const g of PLANTS) {
      const parts = partsAt(g, 0, 0, 3, 3);
      assert.equal(parts.tree.length + parts.fountain.length + parts.obelisk.length, 0, `genre ${g}`);
    }
  });

  test("the genre numbers are the contract's: 40 gas to 46 fusion", () => {
    assert.deepEqual(PLANTS, [GENRE.GAS, GENRE.OIL, GENRE.WIND, GENRE.SOLAR, GENRE.HYDRO, GENRE.MICROWAVE, GENRE.FUSION]);
    assert.equal(GENRE.GAS, 40);
    assert.equal(GENRE.FUSION, 46);
  });
});

describe("the shapes of each power plant", () => {
  test("gas: a grey block with two short stacks on its back, on top of the body", () => {
    const p = partsAt(GENRE.GAS, 0, 0, 3, 3);
    assert.equal(p.block.length, 1 + 2, "one body and two stacks");
    const [body, ...stacks] = p.block;
    assert.equal(colorsOf([body])[0], hexOf(COLORS.gas));
    assert.ok(close(body.sy, GAS.height));
    assert.deepEqual([body.sx, body.sz], [3, 3]);
    assert.equal(p.slab.length, 0);
    for (const st of stacks) {
      assert.equal(colorsOf([st])[0], hexOf(COLORS.chimney));
      assert.ok(close(st.sy, GAS.stack.height), "a short stack");
      assert.ok(close(bottom(st), GAS.height), "stands on the body top");
      assert.ok(insideFootprint(st, 0, 0, 3, 3), "inside the footprint");
    }
    assert.ok(close(stacks[0].x, 0.75) && close(stacks[1].x, 2.25), "two stacks at the fractions of the width");
    assert.ok(GAS.stack.height < OIL.stack.height, "gas stacks are shorter than the oil stack");
  });

  test("gas: two stacks stay apart on a 1x1 footprint", () => {
    const stacks = partsAt(GENRE.GAS, 2, 2, 1, 1).block.slice(1);
    assert.equal(stacks.length, 2);
    assert.ok(stacks[0].x < stacks[1].x, "not on the same spot");
    for (const st of stacks) assert.ok(insideFootprint(st, 2, 2, 1, 1));
  });

  test("oil: a dark block with one tall chimney at the corner", () => {
    const p = partsAt(GENRE.OIL, 1, 1, 3, 3);
    assert.equal(p.block.length, 2);
    const [body, stack] = p.block;
    assert.equal(colorsOf([body])[0], hexOf(COLORS.oil));
    assert.ok(close(body.sy, OIL.height));
    assert.equal(colorsOf([stack])[0], hexOf(COLORS.chimney));
    assert.ok(close(stack.sy, OIL.stack.height), "a tall chimney");
    assert.ok(stack.sy > GAS.stack.height, "taller than a gas stack");
    assert.ok(close(bottom(stack), OIL.height), "stands on the body top");
    assert.ok(close(stack.x, 1 + 3 - OIL.stack.inset) && close(stack.z, 1 + OIL.stack.inset), "at the corner");
    assert.ok(insideFootprint(stack, 1, 1, 3, 3));
  });

  test("wind: a thin white mast (slab) with three blade slabs at its top", () => {
    const p = partsAt(GENRE.WIND, 0, 0, 1, 1);
    assert.equal(p.slab.length, 4, "the mast and three blades");
    assert.equal(p.block.length, 0);
    const [mast, ...blades] = p.slab;
    assert.equal(colorsOf([mast])[0], hexOf(COLORS.windMast));
    assert.ok(close(mast.sy, WIND.mast.height), "a tall mast");
    assert.ok(close(mast.sx, WIND.mast.width) && close(mast.sz, WIND.mast.width), "thin");
    assert.ok(close(bottom(mast), 0), "stands on the base");
    for (const b of blades) {
      assert.equal(colorsOf([b])[0], hexOf(COLORS.windBlade));
      assert.ok(close(b.y, WIND.mast.height), "the blades sit at the top of the mast");
      assert.ok(insideFootprint(b, 0, 0, 1, 1), "the blades stay inside the 1x1 tile");
    }
  });

  test("wind: the three blades are thin arms from the hub, east, west and south", () => {
    const [, east, west, south] = partsAt(GENRE.WIND, 0, 0, 1, 1).slab;
    const hub = { x: 0.5, z: 0.5 };
    assert.ok(close(east.x - hub.x, WIND.blade.length / 2) && close(east.z, hub.z), "east arm");
    assert.ok(close(west.x - hub.x, -WIND.blade.length / 2) && close(west.z, hub.z), "west arm");
    assert.ok(close(south.z - hub.z, WIND.blade.length / 2) && close(south.x, hub.x), "south arm");
    assert.ok(close(east.sx, WIND.blade.length) && close(east.sy, WIND.blade.thick), "thin and as long as the arm");
    assert.ok(close(south.sz, WIND.blade.length) && close(south.sx, WIND.blade.width));
  });

  test("wind: the blades are at most half a side long on a big footprint", () => {
    const [, east] = partsAt(GENRE.WIND, 0, 0, 4, 4).slab;
    assert.ok(close(east.sx, WIND.blade.length), "the blade keeps its length when the footprint allows it");
    const [, narrow] = partsAt(GENRE.WIND, 0, 0, 1, 1).slab;
    assert.ok(narrow.sx <= 1 / 2 + 1e-9, "never past the middle of a 1-tile side");
  });

  test("solar: several flat blue panels, each a thin slab at a different height", () => {
    const p = partsAt(GENRE.SOLAR, 2, 2, 3, 3);
    assert.equal(p.slab.length, SOLAR.rows, "one slab per row");
    assert.equal(p.block.length, 0);
    const blue = hexOf(COLORS.solarPanel);
    const ys = p.slab.map((panel) => panel.y);
    for (const panel of p.slab) {
      assert.equal(colorsOf([panel])[0], blue);
      assert.ok(close(panel.sy, SOLAR.thick), "a thin flat panel");
      assert.ok(insideFootprint(panel, 2, 2, 3, 3), "inside the footprint");
    }
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1] + 1e-9, "each row one step higher");
    assert.ok(close(ys[1] - ys[0], SOLAR.step), "the step is the constant");
  });

  test("solar: the lowest panel is lifted above the ground", () => {
    const [low] = partsAt(GENRE.SOLAR, 0, 0, 3, 3).slab;
    assert.ok(close(bottom(low), SOLAR.lift));
  });

  test("hydro: a long concrete dam across the footprint, with blue water on its north side", () => {
    const p = partsAt(GENRE.HYDRO, 0, 0, 2, 2);
    assert.equal(p.block.length, 1);
    assert.equal(p.slab.length, 1);
    const [dam] = p.block, [water] = p.slab;
    assert.equal(colorsOf([dam])[0], hexOf(COLORS.concrete));
    assert.equal(colorsOf([water])[0], hexOf(COLORS.water));
    assert.ok(close(dam.sx, 2), "as long as the footprint");
    assert.ok(close(dam.sz, HYDRO.dam.depth) && close(dam.z, 1), "a thin wall across the middle");
    assert.ok(close(dam.sy, HYDRO.dam.height));
    assert.ok(close(water.sx, 2) && close(water.sy, HYDRO.water.height));
    assert.ok(water.z < dam.z - dam.sz / 2, "the water is north of the dam");
    assert.ok(close(water.z + water.sz / 2, dam.z - dam.sz / 2), "the water reaches the dam's north face");
    assert.ok(top(water) < top(dam), "the water is lower than the dam top");
    assert.ok(insideFootprint(dam, 0, 0, 2, 2) && insideFootprint(water, 0, 0, 2, 2));
  });

  test("microwave: a block with a stand and a big flat dish on top", () => {
    const p = partsAt(GENRE.MICROWAVE, 0, 0, 3, 3);
    assert.equal(p.block.length, 1);
    assert.equal(p.slab.length, 2, "the stand and the dish");
    const [body] = p.block;
    assert.equal(colorsOf([body])[0], hexOf(COLORS.microwave));
    assert.ok(close(body.sy, MICROWAVE.height));
    assert.ok(close(body.sx, 3 - 2 * MICROWAVE.inset), "the block is inset");
    const [stand, dish] = p.slab;
    assert.ok(close(bottom(stand), MICROWAVE.height) && close(top(stand), MICROWAVE.height + MICROWAVE.stand.height));
    assert.ok(close(bottom(dish), MICROWAVE.height + MICROWAVE.stand.height), "the dish sits on the stand");
    assert.ok(close(dish.sy, MICROWAVE.dish.thick), "a thin flat dish");
    assert.ok(dish.sx > body.sx && dish.sz > body.sz, "the dish is wider than the body");
    assert.ok(insideFootprint(dish, 0, 0, 3, 3));
  });

  test("fusion: a wide block with a dome of stacked blocks that shrink", () => {
    const p = partsAt(GENRE.FUSION, 0, 0, 4, 4);
    assert.equal(p.block.length, 1 + FUSION.dome.steps, "one wide body and the dome steps");
    const [body, ...dome] = p.block;
    assert.equal(colorsOf([body])[0], hexOf(COLORS.fusion));
    assert.ok(close(body.sx, 4) && close(body.sz, 4), "the body covers the footprint");
    assert.ok(close(body.sy, FUSION.height));
    let prevTop = top(body), prevW = body.sx;
    for (const step of dome) {
      assert.equal(colorsOf([step])[0], hexOf(COLORS.fusionDome));
      assert.ok(close(bottom(step), prevTop), "each step stands on the one below");
      assert.ok(close(step.sy, FUSION.dome.step));
      assert.ok(step.sx < prevW - 1e-9, "each step is narrower");
      assert.ok(insideFootprint(step, 0, 0, 4, 4));
      prevTop = top(step);
      prevW = step.sx;
    }
  });

  test("fusion: the dome has the bounded number of steps of the constant", () => {
    assert.equal(FUSION.dome.steps, 3);
    const p = partsAt(GENRE.FUSION, 0, 0, 1, 1);
    assert.equal(p.block.length, 1 + FUSION.dome.steps);
    for (const step of p.block.slice(1)) assert.ok(step.sx > 0 && step.sz > 0, "never a negative size");
  });

  test("the exact part counts of each plant", () => {
    const counts = (g, w, h) => {
      const p = partsAt(g, 0, 0, w, h);
      return KINDS.map((k) => p[k].length);
    };
    //                       slab tree fountain obelisk block
    assert.deepEqual(counts(GENRE.GAS, 3, 3), [0, 0, 0, 0, 3]);
    assert.deepEqual(counts(GENRE.OIL, 3, 3), [0, 0, 0, 0, 2]);
    assert.deepEqual(counts(GENRE.WIND, 1, 1), [4, 0, 0, 0, 0]);
    assert.deepEqual(counts(GENRE.SOLAR, 3, 3), [SOLAR.rows, 0, 0, 0, 0]);
    assert.deepEqual(counts(GENRE.HYDRO, 2, 2), [1, 0, 0, 0, 1]);
    assert.deepEqual(counts(GENRE.MICROWAVE, 3, 3), [2, 0, 0, 0, 1]);
    assert.deepEqual(counts(GENRE.FUSION, 4, 4), [0, 0, 0, 0, 1 + FUSION.dome.steps]);
  });
});

describe("power plants stand on the ground and count against the capacities", () => {
  test("the base height lifts every part of a plant", () => {
    for (const g of PLANTS) {
      const low = partsOf(rec(g, 0, 0, 3, 3), 0);
      const high = partsOf(rec(g, 0, 0, 3, 3), 3);
      assert.equal(low.length, high.length, `genre ${g}`);
      low.forEach(([, a], i) => assert.ok(close(high[i][1].y - a.y, 3), `genre ${g} part ${i}`));
    }
  });

  test("no part of a plant sinks below its base", () => {
    for (const g of PLANTS) {
      for (const [, p] of partsOf(rec(g, 0, 0, 3, 3), 0)) {
        assert.ok(bottom(p) >= -1e-9, `genre ${g}`);
      }
    }
  });

  test("every part of every plant is inside its footprint, on a 1x1 and on a 4x4 tile", () => {
    for (const g of PLANTS) {
      for (const [w, h] of [[1, 1], [4, 4]]) {
        for (const [, p] of partsOf(rec(g, 2, 3, w, h), 0)) {
          assert.ok(insideFootprint(p, 2, 3, w, h), `genre ${g} ${w}x${h}`);
        }
      }
    }
  });

  test("a row of fusion plants past the block capacity drops and counts the extra blocks", () => {
    const caps = { ...CAPACITY, block: 1 };
    const r = placementsFor([rec(GENRE.FUSION, 0, 0, 4, 4), rec(GENRE.FUSION, 4, 0, 4, 4)], flat(), H, caps);
    assert.equal(r.structures, 2);
    assert.equal(r.items.block.length, 1);
    assert.equal(r.dropped, 2 * (1 + FUSION.dome.steps) - 1);
  });

  test("a row of solar plants past the slab capacity drops the extra panels", () => {
    const caps = { ...CAPACITY, slab: 4 };
    const r = placementsFor([rec(GENRE.SOLAR, 0, 0, 3, 3), rec(GENRE.SOLAR, 3, 0, 3, 3)], flat(), H, caps);
    assert.equal(r.items.slab.length, 4);
    assert.equal(r.dropped, 2 * SOLAR.rows - 4);
  });

  test("one of each plant on a full map fits the default capacities", () => {
    const records = [
      rec(GENRE.GAS, 0, 0, 3, 3), rec(GENRE.OIL, 4, 0, 3, 3), rec(GENRE.WIND, 0, 4, 1, 1),
      rec(GENRE.SOLAR, 2, 3, 3, 3), rec(GENRE.HYDRO, 6, 4, 2, 2), rec(GENRE.MICROWAVE, 5, 0, 3, 3),
      rec(GENRE.FUSION, 0, 2, 4, 4),
    ];
    const r = placementsFor(records, flat(), H);
    assert.equal(r.structures, 7);
    assert.equal(r.dropped, 0);
    for (const k of KINDS) assert.ok(r.items[k].length <= CAPACITY[k], k);
  });

  test("a plant past the map edge is skipped, not drawn", () => {
    const r = placementsFor([rec(GENRE.FUSION, W - 2, 0, 4, 4)], flat(), H);
    assert.equal(r.structures, 0);
    assert.equal(r.items.block.length, 0);
  });
});

test("the power plant colours are the ones of the table", () => {
  assert.equal(COLORS.gas, "#b0bec5");
  assert.equal(COLORS.oil, "#37474f");
  assert.equal(COLORS.windMast, "#f5f5f0");
  assert.equal(COLORS.windBlade, "#eeeeee");
  assert.equal(COLORS.solarPanel, "#0d47a1");
  assert.equal(COLORS.concrete, "#bdbdbd");
  assert.equal(COLORS.water, "#29b6f6");
  assert.equal(COLORS.microwave, "#eceff1");
  assert.equal(COLORS.dish, "#90a4ae");
  assert.equal(COLORS.fusion, "#78909c");
  assert.equal(COLORS.fusionDome, "#b0bec5");
});

test("the existing colours and the grey block are untouched by the power plants", () => {
  assert.equal(COLORS.block, "#9e9e9e");
  assert.equal(COLORS.chimney, "#424242");
  assert.equal(BLOCK_HEIGHT, 0.8);
  const parts = partsAt(37, 0, 0, 2, 1);
  assert.equal(parts.block.length, 1, "a genre not listed is still a grey block");
});
