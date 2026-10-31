// Land value tiers, density caps and chunk keys for the 3D building models
// (web/view3d-models-landvalue.js and chooseModel / variantSlice of web/view3d-models-model.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, chooseModel, variantSlice, tileHash } from "../view3d-models-model.js";
import {
  LV_MID, LV_HIGH, TIER, TIER_NONE, CAP_NONE, tierOfValue, capOfDensity, readLandValue, readDensity, tierAt, capAt,
  siteAt, chunkKey, chunkKeys, changedChunks,
} from "../view3d-models-landvalue.js";
import { chunkGrid, CHUNK } from "../view3d-model.js";

const vol = (kind, x, y, sy = 1.5) => ({ kind, x, y, slot: x * 100 + y, base: 2, sx: 0.78, sy, sz: 0.78 });
const tier = (t) => ({ tier: t, cap: CAP_NONE });

describe("tiers", () => {
  test("thresholds", () => {
    assert.equal(tierOfValue(0), TIER.MODEST);
    assert.equal(tierOfValue(LV_MID - 1), TIER.MODEST);
    assert.equal(tierOfValue(LV_MID), TIER.MIDDLE);
    assert.equal(tierOfValue(LV_HIGH - 1), TIER.MIDDLE);
    assert.equal(tierOfValue(LV_HIGH), TIER.WEALTHY);
    assert.equal(tierOfValue(255), TIER.WEALTHY);
    assert.equal(tierOfValue(undefined), TIER_NONE);
    assert.equal(tierOfValue(NaN), TIER_NONE);
  });

  test("a cell covers block x block tiles, cells in column order", () => {
    // block 4, 2 columns x 3 rows: index = cx * 3 + cy
    const lv = { cells: Uint8Array.from([10, 70, 200, 0, 0, 0]), block: 4, cols: 2, rows: 3 };
    assert.equal(tierAt(lv, 0, 0), TIER.MODEST);
    assert.equal(tierAt(lv, 3, 3), TIER.MODEST);
    assert.equal(tierAt(lv, 0, 4), TIER.MIDDLE);
    assert.equal(tierAt(lv, 3, 8), TIER.WEALTHY);
    assert.equal(tierAt(lv, 4, 0), TIER.MODEST);
    assert.equal(tierAt(lv, 8, 0), TIER_NONE); // past the columns
    assert.equal(tierAt(lv, 0, 12), TIER_NONE); // past the rows
    assert.equal(tierAt(lv, -1, 0), TIER_NONE);
    assert.equal(tierAt(null, 0, 0), TIER_NONE);
  });
});

describe("reading the engine", () => {
  const okCity = { overlay: () => new Uint8Array(6), overlay_layout: () => [4, 2, 3] };
  test("land value: ok, absent, wrong length, bad layout", () => {
    assert.equal(readLandValue(okCity).cols, 2);
    assert.equal(readLandValue({}), null);
    assert.equal(readLandValue(null), null);
    assert.equal(readLandValue({ overlay: () => new Uint8Array(5), overlay_layout: () => [4, 2, 3] }), null);
    assert.equal(readLandValue({ overlay: () => new Uint8Array(6), overlay_layout: () => [0, 2, 3] }), null);
    assert.equal(readLandValue({ overlay: () => new Uint8Array(6), overlay_layout: () => [4, 2] }), null);
    assert.equal(readLandValue({ overlay: () => null, overlay_layout: () => [4, 2, 3] }), null);
  });

  test("density: only with the rule on, the right length and the API", () => {
    const bytes = new Uint8Array(6);
    const city = (rules, data) => ({ density_rules: () => rules, density_layer: () => data });
    assert.equal(readDensity(city(true, bytes), 3, 2), bytes);
    assert.equal(readDensity(city(false, bytes), 3, 2), null);
    assert.equal(readDensity(city(true, new Uint8Array(5)), 3, 2), null);
    assert.equal(readDensity(city(true, [1, 2]), 1, 2), null);
    assert.equal(readDensity({}, 3, 2), null);
  });
});

describe("variant slices", () => {
  test("thirds, never empty, covering the list", () => {
    for (let n = 1; n <= 12; n++) {
      let next = 0;
      for (const t of [0, 1, 2]) {
        const [lo, hi] = variantSlice(n, t);
        assert.ok(hi > lo && lo >= 0 && hi <= n, `n=${n} t=${t} [${lo},${hi})`);
        if (n >= 3) assert.equal(lo, next);
        next = hi;
      }
      if (n >= 3) assert.equal(next, n);
    }
    assert.deepEqual(variantSlice(3, 0), [0, 1]);
    assert.deepEqual(variantSlice(3, 1), [1, 2]);
    assert.deepEqual(variantSlice(3, 2), [2, 3]);
    assert.deepEqual(variantSlice(2, 0), [0, 1]);
    assert.deepEqual(variantSlice(2, 2), [1, 2]);
    assert.deepEqual(variantSlice(1, 1), [0, 1]);
  });

  test("an unknown tier gets the whole list", () => {
    assert.deepEqual(variantSlice(5, TIER_NONE), [0, 5]);
    assert.deepEqual(variantSlice(5, 3), [0, 5]);
    assert.deepEqual(variantSlice(5, undefined), [0, 5]);
  });
});

describe("chooseModel with a site", () => {
  const sweep = (fn) => { for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) fn(x, y); };

  test("each tier draws only from its slice of the level, and uses all of it", () => {
    for (const kind of ["residential", "commercial", "industrial"]) {
      for (const [sy, level] of [[0.6, 0], [1.4, 1], [2.4, 2]]) {
        const list = CATALOG[kind][level];
        for (const t of [0, 1, 2]) {
          const [lo, hi] = variantSlice(list.length, t);
          const seen = new Set();
          sweep((x, y) => seen.add(chooseModel(CATALOG, vol(kind, x, y, sy), -1, tier(t)).id));
          assert.deepEqual([...seen].sort(), list.slice(lo, hi).sort(), `${kind} L${level} tier ${t}`);
        }
      }
    }
  });

  test("modest never gets a more refined variant than wealthy (order of the catalog)", () => {
    const list = CATALOG.residential[0];
    sweep((x, y) => {
      const a = list.indexOf(chooseModel(CATALOG, vol("residential", x, y, 0.6), -1, tier(0)).id);
      const c = list.indexOf(chooseModel(CATALOG, vol("residential", x, y, 0.6), -1, tier(2)).id);
      assert.ok(a < c);
    });
  });

  test("the hash breaks ties inside the slice (same tile, same answer)", () => {
    const a = chooseModel(CATALOG, vol("residential", 5, 7, 0.6), -1, tier(2));
    assert.deepEqual(a, chooseModel(CATALOG, vol("residential", 5, 7, 0.6), -1, tier(2)));
    const [lo, hi] = variantSlice(CATALOG.residential[0].length, 2);
    assert.equal(a.id, CATALOG.residential[0][lo + (tileHash(5, 7) % (hi - lo))]);
  });

  test("no site, TIER_NONE or no cap behave like today (hash only)", () => {
    sweep((x, y) => {
      const base = chooseModel(CATALOG, vol("commercial", x, y, 2.4));
      assert.deepEqual(chooseModel(CATALOG, vol("commercial", x, y, 2.4), -1, null), base);
      assert.deepEqual(chooseModel(CATALOG, vol("commercial", x, y, 2.4), -1, { tier: TIER_NONE, cap: CAP_NONE }), base);
      assert.equal(base.id, CATALOG.commercial[2][tileHash(x, y) % CATALOG.commercial[2].length]);
    });
  });

  test("the density cap lowers the level only", () => {
    sweep((x, y) => {
      const site = (cap) => ({ tier: TIER_NONE, cap });
      assert.ok(CATALOG.commercial[0].includes(chooseModel(CATALOG, vol("commercial", x, y, 2.4), -1, site(0)).id));
      assert.ok(CATALOG.commercial[1].includes(chooseModel(CATALOG, vol("commercial", x, y, 2.4), -1, site(1)).id));
      assert.ok(CATALOG.commercial[0].includes(chooseModel(CATALOG, vol("commercial", x, y, 0.6), -1, site(1)).id)); // never raised
      assert.ok(CATALOG.commercial[1].includes(chooseModel(CATALOG, vol("commercial", x, y, 1.4), -1, site(1)).id));
    });
  });

  test("cap and tier combine; trees ignore both", () => {
    const m = chooseModel(CATALOG, vol("industrial", 3, 3, 2.4), -1, { tier: 2, cap: 0 });
    assert.ok(CATALOG.industrial[0].includes(m.id));
    const [lo, hi] = variantSlice(CATALOG.industrial[0].length, 2);
    assert.ok(CATALOG.industrial[0].slice(lo, hi).includes(m.id));
    sweep((x, y) => {
      assert.deepEqual(chooseModel(CATALOG, vol("tree", x, y), -1, { tier: 2, cap: 0 }), chooseModel(CATALOG, vol("tree", x, y)));
    });
  });

  test("the density byte maps to the cap", () => {
    assert.equal(capOfDensity(1), 0);
    assert.equal(capOfDensity(2), 1);
    for (const v of [0, 3, 4, 9, undefined]) assert.equal(capOfDensity(v), CAP_NONE);
  });
});

describe("chunk keys", () => {
  const w = 40, h = 20; // 3 x 2 chunks
  const grid = chunkGrid(w, h);
  const lvOf = (value) => ({ cells: new Uint8Array(w * h).fill(value), block: 1, cols: w, rows: h });
  const lvAll = (value) => lvOf(value);

  test("one key per chunk; equal inputs give equal keys", () => {
    const keys = chunkKeys(grid, lvAll(10), null);
    assert.equal(keys.length, grid.count);
    assert.deepEqual(keys, chunkKeys(grid, lvAll(10), null));
    assert.deepEqual(changedChunks(keys, chunkKeys(grid, lvAll(10), null)), []);
  });

  test("a tier change in one tile changes only its chunk", () => {
    const a = lvAll(10), b = lvAll(10);
    const x = CHUNK + 3, y = 2; // chunk column 1, row 0
    b.cells[x * h + y] = 200;
    const changed = changedChunks(chunkKeys(grid, a, null), chunkKeys(grid, b, null));
    assert.deepEqual(changed, [1]);
  });

  test("a value change inside the same tier changes nothing", () => {
    const a = lvAll(10), b = lvAll(10);
    b.cells[5 * h + 5] = 50;
    assert.deepEqual(changedChunks(chunkKeys(grid, a, null), chunkKeys(grid, b, null)), []);
  });

  test("a density cap change in one tile changes its chunk; dense to farm changes nothing", () => {
    const d1 = new Uint8Array(w * h).fill(3), d2 = new Uint8Array(w * h).fill(3);
    d2[(2 * CHUNK + 1) * h + 17] = 1; // chunk (2, 1) = index 5
    assert.deepEqual(changedChunks(chunkKeys(grid, null, d1), chunkKeys(grid, null, d2)), [5]);
    const d3 = new Uint8Array(w * h).fill(4);
    assert.deepEqual(changedChunks(chunkKeys(grid, null, d1), chunkKeys(grid, null, d3)), []);
  });

  test("the rule turning off, or the land value disappearing, redraws the chunks that had a cap or tier", () => {
    const d = new Uint8Array(w * h).fill(1);
    assert.equal(changedChunks(chunkKeys(grid, null, d), chunkKeys(grid, null, null)).length, grid.count);
    assert.equal(changedChunks(chunkKeys(grid, lvAll(10), null), chunkKeys(grid, null, null)).length, grid.count);
  });

  test("changedChunks: no previous keys or another length means all", () => {
    assert.deepEqual(changedChunks(null, [1, 2, 3]), [0, 1, 2]);
    assert.deepEqual(changedChunks([1], [1, 2]), [0, 1]);
    assert.deepEqual(changedChunks([1, 2], [1, 3]), [1]);
  });

  test("an edge chunk loops over the tiles it holds only; siteAt reads both", () => {
    assert.equal(typeof chunkKey(grid, grid.count - 1, lvAll(100), null), "number");
    const d = new Uint8Array(w * h).fill(2);
    assert.deepEqual(siteAt(lvAll(130), d, h, 3, 4), { tier: TIER.WEALTHY, cap: 1 });
    assert.deepEqual(siteAt(null, null, h, 3, 4), { tier: TIER_NONE, cap: CAP_NONE });
    assert.equal(capAt(d, h, 1, 1), 1);
  });
});
