// The 3D shapes of the rewards and special deals, genres 50-54 and 60-63 (web/view3d-structures-rewards.js,
// docs/game-design-v12.md).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ARCH, BLOCK_HEIGHT, CASINO, CAPACITY, COLORS, COURTHOUSE, GENRE, HALL, KINDS, MAYOR, MISSILE_BASE, STATE_PRISON,
  STATUE, TOXIC_DUMP, partsOf, placementsFor, rgbOfHex,
} from "../view3d-structures-model.js";
import { REWARD_COLORS } from "../view3d-structures-rewards.js";
import { ENERGY_COLORS } from "../view3d-structures-energy.js";
import { cornerAltitudes } from "../view3d-model.js";

const W = 8, H = 6;
const flat = () => cornerAltitudes(new Uint8Array(W * H).fill(10), W, H);
const rec = (genre, x, y, w, h) => ({ genre, x, y, w, h, state: 0 });
const close = (a, b) => Math.abs(a - b) < 1e-9;
const REWARDS = [50, 51, 52, 53, 54];
const DEALS = [60, 61, 62, 63];
const ALL = [...REWARDS, ...DEALS];

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

describe("every reward and special deal has a shape, with the kinds of the contract", () => {
  test("genres 50-54 and 60-63 each give at least one part, and only known shapes", () => {
    for (const g of ALL) {
      const parts = partsOf(rec(g, 0, 0, 3, 3), 0);
      assert.ok(parts.length >= 1, `genre ${g}`);
      for (const [shape] of parts) assert.ok(KINDS.includes(shape), `genre ${g}`);
    }
  });

  test("no reward is drawn as the plain grey block of an unknown genre", () => {
    for (const g of ALL) {
      const parts = partsAt(g, 0, 0, 3, 3);
      const onlyGrey = parts.block.length === 1 && parts.slab.length + parts.tree.length + parts.fountain.length +
        parts.obelisk.length === 0 && colorsOf(parts.block)[0] === hexOf(COLORS.block);
      assert.equal(onlyGrey, false, `genre ${g}`);
    }
  });

  test("the genre numbers are the contract's", () => {
    assert.equal(GENRE.MAYOR_HOUSE, 50);
    assert.equal(GENRE.CITY_HALL, 51);
    assert.equal(GENRE.STATUE, 52);
    assert.equal(GENRE.COURTHOUSE, 53);
    assert.equal(GENRE.ARCH, 54);
    assert.equal(GENRE.CASINO, 60);
    assert.equal(GENRE.STATE_PRISON, 61);
    assert.equal(GENRE.TOXIC_DUMP, 62);
    assert.equal(GENRE.MISSILE_BASE, 63);
  });

  test("only the statue uses the obelisk mesh, and no reward uses trees or fountains", () => {
    for (const g of ALL) {
      const parts = partsAt(g, 0, 0, 3, 3);
      assert.equal(parts.tree.length + parts.fountain.length, 0, `genre ${g}`);
      assert.equal(parts.obelisk.length, g === GENRE.STATUE ? 1 : 0, `genre ${g}`);
    }
  });
});

describe("the shapes of each reward", () => {
  test("mayor's house: a white block with a red roof slab covering it", () => {
    const p = partsAt(GENRE.MAYOR_HOUSE, 0, 0, 2, 2);
    assert.equal(p.block.length, 1);
    assert.equal(p.slab.length, 1);
    const [body] = p.block, [roof] = p.slab;
    assert.equal(colorsOf([body])[0], hexOf(COLORS.mayorWall));
    assert.equal(colorsOf([roof])[0], hexOf(COLORS.mayorRoof));
    assert.ok(close(body.sy, MAYOR.height), "the body has the constant height");
    assert.ok(close(bottom(roof), top(body)), "the roof sits on the body");
    assert.ok(close(roof.sx, 2) && close(roof.sz, 2), "the roof covers the footprint");
    assert.ok(insideFootprint(body, 0, 0, 2, 2) && insideFootprint(roof, 0, 0, 2, 2));
  });

  test("city hall: a wide stone block, columns in front, and a tall tower in the middle", () => {
    const p = partsAt(GENRE.CITY_HALL, 0, 0, 3, 3);
    assert.equal(p.block.length, 2, "the body and the tower");
    assert.equal(p.slab.length, HALL.columns, "the front columns");
    const [body, tower] = p.block;
    assert.equal(colorsOf([body])[0], hexOf(COLORS.hallStone));
    assert.equal(colorsOf([tower])[0], hexOf(COLORS.hallTower));
    assert.ok(close(body.sy, HALL.height));
    assert.ok(close(tower.x, 1.5) && close(tower.z, 1.5), "the tower is central");
    assert.ok(close(bottom(tower), top(body)), "the tower stands on the body");
    assert.ok(tower.sy > HALL.height, "the tower is taller than the body");
    assert.ok(close(tower.sx, 3 * HALL.tower.fraction) && close(tower.sz, 3 * HALL.tower.fraction));
    for (const c of p.slab) {
      assert.equal(colorsOf([c])[0], hexOf(COLORS.hallColumn));
      assert.ok(close(c.z - c.sz / 2, 0), "the columns stand on the front (north) edge");
      assert.ok(close(bottom(c), 0) && close(top(c), HALL.height), "the columns rise to the body top");
      assert.ok(insideFootprint(c, 0, 0, 3, 3), "inside the footprint");
    }
  });

  test("city hall: the columns are spread across the front, in order", () => {
    const xs = partsAt(GENRE.CITY_HALL, 0, 0, 4, 4).slab.map((c) => c.x);
    assert.equal(xs.length, HALL.columns);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1] + 1e-9, "left to right");
  });

  test("statue: a small stone base with an obelisk figure standing on it", () => {
    const p = partsAt(GENRE.STATUE, 0, 0, 1, 1);
    assert.equal(p.block.length, 1, "the base");
    assert.equal(p.obelisk.length, 1, "the figure");
    const [base] = p.block, [figure] = p.obelisk;
    assert.equal(colorsOf([base])[0], hexOf(COLORS.stone));
    assert.equal(colorsOf([figure])[0], hexOf(COLORS.obelisk));
    assert.ok(close(base.sy, STATUE.base) && close(bottom(base), 0), "a low base on the ground");
    assert.ok(close(bottom(figure), top(base)), "the figure stands on the base");
    assert.ok(close(figure.sy, STATUE.figure.height) && close(figure.sx, STATUE.figure.width));
    assert.ok(close(figure.x, 0.5) && close(figure.z, 0.5), "the figure is in the middle");
    assert.ok(insideFootprint(figure, 0, 0, 1, 1) && insideFootprint(base, 0, 0, 1, 1));
  });

  test("courthouse: a stone block, front columns that rise to a flat roof slab", () => {
    const p = partsAt(GENRE.COURTHOUSE, 0, 0, 3, 3);
    assert.equal(p.block.length, 1);
    assert.equal(p.slab.length, COURTHOUSE.columns + 1, "the columns and the roof");
    const [body] = p.block;
    assert.equal(colorsOf([body])[0], hexOf(COLORS.courtStone));
    assert.ok(close(body.sx, 3 - 2 * COURTHOUSE.inset), "the block is inset");
    const roof = p.slab[p.slab.length - 1];
    const cols = p.slab.slice(0, -1);
    assert.equal(colorsOf([roof])[0], hexOf(COLORS.courtRoof));
    assert.ok(close(roof.sx, 3) && close(roof.sz, 3), "the flat roof covers the footprint");
    assert.ok(close(bottom(roof), COURTHOUSE.columnHeight), "the roof rests on the columns");
    for (const c of cols) {
      assert.equal(colorsOf([c])[0], hexOf(COLORS.courtColumn));
      assert.ok(close(top(c), COURTHOUSE.columnHeight), "the columns reach the roof");
      assert.ok(c.z - c.sz / 2 >= -1e-9 && c.z + c.sz / 2 <= COURTHOUSE.column + 1e-9, "on the front edge");
      assert.ok(insideFootprint(c, 0, 0, 3, 3));
    }
    assert.ok(COURTHOUSE.columnHeight > COURTHOUSE.height, "the columns are taller than the body");
  });

  test("arch: two pillars at the west and east edges, and a lintel across their tops", () => {
    const p = partsAt(GENRE.ARCH, 0, 0, 2, 2);
    assert.equal(p.block.length, 2, "two pillars");
    assert.equal(p.slab.length, 1, "one lintel");
    const [west, east] = p.block;
    const [lintel] = p.slab;
    for (const pillar of [west, east]) {
      assert.equal(colorsOf([pillar])[0], hexOf(COLORS.archStone));
      assert.ok(close(pillar.sy, ARCH.pillar.height) && close(bottom(pillar), 0), "stands on the ground");
      assert.ok(close(pillar.sx, ARCH.pillar.width), "square pillars");
    }
    assert.ok(close(west.x - west.sx / 2, 0) && close(east.x + east.sx / 2, 2), "the pillars sit on the edges");
    assert.ok(west.x < 1 && east.x > 1, "one on each side");
    assert.ok(close(bottom(lintel), ARCH.pillar.height) && close(lintel.sy, ARCH.lintel), "the lintel on the pillars");
    assert.ok(close(lintel.sx, 2), "the lintel spans the whole width");
    assert.equal(colorsOf([lintel])[0], hexOf(COLORS.archStone));
    assert.ok(insideFootprint(lintel, 0, 0, 2, 2));
  });

  test("casino: a bright purple block with a gold roof slab", () => {
    const p = partsAt(GENRE.CASINO, 0, 0, 3, 3);
    assert.equal(p.block.length, 1);
    assert.equal(p.slab.length, 1);
    const [body] = p.block, [roof] = p.slab;
    assert.equal(colorsOf([body])[0], hexOf(COLORS.casinoPurple));
    assert.equal(colorsOf([roof])[0], hexOf(COLORS.casinoGold));
    assert.ok(close(body.sy, CASINO.height) && close(bottom(roof), top(body)));
    assert.ok(close(roof.sx, 3) && close(roof.sz, 3), "the gold roof covers the footprint");
  });

  test("state prison: a large dark block, inset, with a low wall around the yard", () => {
    const p = partsAt(GENRE.STATE_PRISON, 0, 0, 4, 4);
    assert.equal(p.block.length, 1);
    assert.equal(p.slab.length, 4, "four wall sides");
    const [body] = p.block;
    assert.equal(colorsOf([body])[0], hexOf(COLORS.statePrison));
    assert.ok(close(body.sx, 4 - 2 * STATE_PRISON.inset), "the block is inset from the walls");
    assert.ok(close(body.sy, STATE_PRISON.height));
    for (const w of p.slab) {
      assert.equal(colorsOf([w])[0], hexOf(COLORS.statePrisonWall));
      assert.ok(close(w.sy, STATE_PRISON.wall.height) && close(bottom(w), 0), "a low wall on the ground");
      assert.ok(w.sy < body.sy, "lower than the block");
      assert.ok(insideFootprint(w, 0, 0, 4, 4), "inside the footprint");
    }
  });

  test("toxic dump: a sickly green mound with yellow barrels on top, inside the footprint", () => {
    const p = partsAt(GENRE.TOXIC_DUMP, 0, 0, 4, 4);
    assert.equal(p.slab.length, 1, "the mound");
    assert.equal(p.block.length, TOXIC_DUMP.barrels.length, "one barrel per entry");
    const [mound] = p.slab;
    assert.equal(colorsOf([mound])[0], hexOf(COLORS.toxicMound));
    assert.ok(close(mound.sy, TOXIC_DUMP.mound) && close(mound.sx, 4) && close(mound.sz, 4));
    for (const b of p.block) {
      assert.equal(colorsOf([b])[0], hexOf(COLORS.toxicBarrel));
      assert.ok(close(bottom(b), TOXIC_DUMP.mound), "each barrel stands on the mound");
      assert.ok(insideFootprint(b, 0, 0, 4, 4));
    }
  });

  test("toxic dump: the barrel count is the bounded constant (four)", () => {
    assert.equal(TOXIC_DUMP.barrels.length, 4);
    for (const [fx, fz] of TOXIC_DUMP.barrels) {
      assert.ok(fx > 0 && fx < 1 && fz > 0 && fz < 1, "centres strictly inside the footprint");
    }
  });

  test("missile base: a sand slab with three tall thin grey silos on top", () => {
    const p = partsAt(GENRE.MISSILE_BASE, 0, 0, 4, 4);
    assert.equal(p.slab.length, 1, "the sand");
    assert.equal(p.block.length, MISSILE_BASE.silos.length, "one silo per entry");
    const [sand] = p.slab;
    assert.equal(colorsOf([sand])[0], hexOf(COLORS.missileSand));
    assert.ok(close(sand.sy, MISSILE_BASE.sand) && close(sand.sx, 4));
    for (const s of p.block) {
      assert.equal(colorsOf([s])[0], hexOf(COLORS.silo));
      assert.ok(close(bottom(s), MISSILE_BASE.sand), "each silo stands on the sand");
      assert.ok(close(s.sx, MISSILE_BASE.silo.width) && close(s.sz, MISSILE_BASE.silo.width), "thin");
      assert.ok(s.sy > 1, "tall");
      assert.ok(insideFootprint(s, 0, 0, 4, 4));
    }
  });

  test("missile base: two or three silos, and at least one tall silo fits a 1x1 tile", () => {
    assert.ok(MISSILE_BASE.silos.length >= 2 && MISSILE_BASE.silos.length <= 3);
    const p = partsAt(GENRE.MISSILE_BASE, 0, 0, 1, 1);
    assert.equal(p.block.length, MISSILE_BASE.silos.length);
    for (const s of p.block) assert.ok(insideFootprint(s, 0, 0, 1, 1));
  });
});

describe("the exact part counts of the rewards", () => {
  test("each reward and special deal has the counts of its shape", () => {
    const counts = (g, w, h) => {
      const p = partsAt(g, 0, 0, w, h);
      return KINDS.map((k) => p[k].length);
    };
    //                                  slab                        tree fountain obelisk block
    assert.deepEqual(counts(GENRE.MAYOR_HOUSE, 2, 2), [1, 0, 0, 0, 1]);
    assert.deepEqual(counts(GENRE.CITY_HALL, 3, 3), [HALL.columns, 0, 0, 0, 2]);
    assert.deepEqual(counts(GENRE.STATUE, 1, 1), [0, 0, 0, 1, 1]);
    assert.deepEqual(counts(GENRE.COURTHOUSE, 3, 3), [COURTHOUSE.columns + 1, 0, 0, 0, 1]);
    assert.deepEqual(counts(GENRE.ARCH, 2, 2), [1, 0, 0, 0, 2]);
    assert.deepEqual(counts(GENRE.CASINO, 3, 3), [1, 0, 0, 0, 1]);
    assert.deepEqual(counts(GENRE.STATE_PRISON, 4, 4), [4, 0, 0, 0, 1]);
    assert.deepEqual(counts(GENRE.TOXIC_DUMP, 4, 4), [1, 0, 0, 0, TOXIC_DUMP.barrels.length]);
    assert.deepEqual(counts(GENRE.MISSILE_BASE, 4, 4), [1, 0, 0, 0, MISSILE_BASE.silos.length]);
  });

  test("the bounded counts of every reward stay small", () => {
    for (const g of ALL) {
      const parts = partsOf(rec(g, 0, 0, 4, 4), 0);
      assert.ok(parts.length <= 12, `genre ${g} has ${parts.length} parts`);
    }
  });
});

describe("rewards stand on the ground, inside their footprint, and count against the capacities", () => {
  test("the base height lifts every part of a reward", () => {
    for (const g of ALL) {
      const low = partsOf(rec(g, 0, 0, 3, 3), 0);
      const high = partsOf(rec(g, 0, 0, 3, 3), 3);
      assert.equal(low.length, high.length, `genre ${g}`);
      low.forEach(([, a], i) => assert.ok(close(high[i][1].y - a.y, 3), `genre ${g} part ${i}`));
    }
  });

  test("no part of a reward sinks below its base", () => {
    for (const g of ALL) {
      for (const [, p] of partsOf(rec(g, 0, 0, 3, 3), 0)) {
        assert.ok(bottom(p) >= -1e-9, `genre ${g}`);
      }
    }
  });

  test("every part of every reward is inside its footprint, on a 1x1 and on a 4x4 tile", () => {
    for (const g of ALL) {
      for (const [w, h] of [[1, 1], [4, 4]]) {
        for (const [, p] of partsOf(rec(g, 2, 3, w, h), 0)) {
          assert.ok(insideFootprint(p, 2, 3, w, h), `genre ${g} ${w}x${h}`);
        }
      }
    }
  });

  test("a row of toxic dumps past the block capacity drops and counts the extra barrels", () => {
    const caps = { ...CAPACITY, block: 1 };
    const r = placementsFor([rec(GENRE.TOXIC_DUMP, 0, 0, 4, 4), rec(GENRE.TOXIC_DUMP, 4, 0, 4, 4)], flat(), H, caps);
    assert.equal(r.structures, 2);
    assert.equal(r.items.block.length, 1);
    assert.equal(r.dropped, 2 * TOXIC_DUMP.barrels.length - 1);
  });

  test("a row of city halls past the slab capacity drops the extra columns", () => {
    const caps = { ...CAPACITY, slab: 2 };
    const r = placementsFor([rec(GENRE.CITY_HALL, 0, 0, 3, 3), rec(GENRE.CITY_HALL, 3, 0, 3, 3)], flat(), H, caps);
    assert.equal(r.items.slab.length, 2);
    assert.equal(r.dropped, 2 * HALL.columns - 2);
  });

  test("one of each reward and special deal on a full map fits the default capacities", () => {
    const records = [
      rec(GENRE.MAYOR_HOUSE, 0, 0, 2, 2), rec(GENRE.CITY_HALL, 2, 0, 3, 3), rec(GENRE.STATUE, 5, 0, 1, 1),
      rec(GENRE.COURTHOUSE, 0, 3, 3, 3), rec(GENRE.ARCH, 4, 3, 2, 2), rec(GENRE.CASINO, 6, 3, 2, 2),
      rec(GENRE.STATE_PRISON, 0, 2, 1, 1), rec(GENRE.TOXIC_DUMP, 0, 0, 1, 1), rec(GENRE.MISSILE_BASE, 1, 1, 1, 1),
    ];
    const r = placementsFor(records, flat(), H);
    assert.equal(r.structures, records.length);
    assert.equal(r.dropped, 0);
    for (const k of KINDS) assert.ok(r.items[k].length <= CAPACITY[k], k);
  });

  test("a reward past the map edge is skipped, not drawn", () => {
    const r = placementsFor([rec(GENRE.ARCH, W - 1, 0, 2, 2)], flat(), H);
    assert.equal(r.structures, 0);
    assert.equal(r.items.block.length, 0);
  });
});

describe("the reward colours", () => {
  test("the colours of the table, as hexadecimal strings", () => {
    assert.equal(REWARD_COLORS.mayorWall, "#fafafa");
    assert.equal(REWARD_COLORS.mayorRoof, "#b71c1c");
    assert.equal(REWARD_COLORS.hallStone, "#b9b4a8");
    assert.equal(REWARD_COLORS.hallColumn, "#e6e1d6");
    assert.equal(REWARD_COLORS.hallTower, "#9c978b");
    assert.equal(REWARD_COLORS.courtStone, "#c9c3b5");
    assert.equal(REWARD_COLORS.courtColumn, "#ebe7dc");
    assert.equal(REWARD_COLORS.courtRoof, "#5d4037");
    assert.equal(REWARD_COLORS.archStone, "#e4dfd2");
    assert.equal(REWARD_COLORS.casinoPurple, "#7b1fa2");
    assert.equal(REWARD_COLORS.casinoGold, "#ffd54f");
    assert.equal(REWARD_COLORS.statePrison, "#2b2b2b");
    assert.equal(REWARD_COLORS.statePrisonWall, "#546e7a");
    assert.equal(REWARD_COLORS.toxicMound, "#a3c44a");
    assert.equal(REWARD_COLORS.toxicBarrel, "#fdd835");
    assert.equal(REWARD_COLORS.missileSand, "#d7c49e");
    assert.equal(REWARD_COLORS.silo, "#8e9399");
  });

  test("every reward colour is merged into COLORS unchanged", () => {
    for (const [k, hex] of Object.entries(REWARD_COLORS)) assert.equal(COLORS[k], hex, k);
  });

  test("no reward colour key reuses a key of another table", () => {
    const earlier = ["park", "tree", "square", "fountain", "stone", "obelisk", "block", "landfill", "dumpBox",
      "incinerator", "chimney", "shed", "plant", "roof", "beige", "schoolRoof", "white", "libraryStone", "column",
      "cross", "prison", "prisonWall", ...Object.keys(ENERGY_COLORS)];
    for (const k of Object.keys(REWARD_COLORS)) assert.ok(!earlier.includes(k), k);
  });

  test("the existing colours and the grey block are untouched by the rewards", () => {
    assert.equal(COLORS.block, "#9e9e9e");
    assert.equal(COLORS.stone, "#8a8f96");
    assert.equal(COLORS.white, "#f5f5f0");
    assert.equal(BLOCK_HEIGHT, 0.8);
    const parts = partsAt(37, 0, 0, 2, 1);
    assert.equal(parts.block.length, 1, "a genre not listed is still a grey block");
  });
});
