// 3D view building models, pure part (web/view3d-models-model.js): density level, deterministic
// variant choice, catalog filtering, scale fitting, placement matrix, instance slot bookkeeping.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import {
  MODEL_FILES, CATALOG, KINDS, MODEL_CAPACITY, FOOTPRINT, MAX_UPSCALE, STRETCH_MIN, STRETCH_MAX,
  TREE_FIT_HEIGHT, MODEL_GAIN, TREE_GAIN, gainOf, FACING_REACH, facingQuarter, levelOf, tileHash, chooseModel, usableCatalog, fitScale, writePlacement, createSlotTable,
} from "../view3d-models-model.js";
import { chunkGrid, buildChunk, cornerAltitudes, altitudesOf } from "../view3d-model.js";

const vol = (kind, x, y, sy = 1.5) => ({ kind, x, y, slot: x * 100 + y, base: 2, sx: 0.78, sy, sz: 0.78 });

describe("the catalog", () => {
  test("every id of the catalog has a file, and every file exists and is a .glb", () => {
    for (const levels of Object.values(CATALOG)) {
      assert.ok(levels.length >= 1);
      for (const list of levels) {
        assert.ok(list.length > 0);
        for (const id of list) assert.ok(MODEL_FILES[id], `${id} has a file`);
      }
    }
    for (const file of Object.values(MODEL_FILES)) {
      assert.match(file, /\.glb$/u);
      const path = new URL(`../models/${file}`, import.meta.url);
      assert.ok(existsSync(path), `${file} is shipped`);
    }
  });

  test("it covers the four kinds the 3D view draws, and three levels for buildings", () => {
    assert.deepEqual([...KINDS].sort(), ["commercial", "industrial", "residential", "tree"]);
    for (const k of ["residential", "commercial", "industrial"]) assert.equal(CATALOG[k].length, 3);
  });

  test("the models weigh at most 3 MB with their textures and licence", () => {
    const dirs = ["commercial", "suburban", "industrial"];
    let total = statSync(new URL("../models/LICENSE-kenney.txt", import.meta.url)).size;
    for (const file of Object.values(MODEL_FILES)) total += statSync(new URL(`../models/${file}`, import.meta.url)).size;
    for (const d of dirs) total += statSync(new URL(`../models/${d}/Textures/colormap.png`, import.meta.url)).size;
    assert.ok(total <= 3 * 1024 * 1024, `${total} bytes`);
  });
});

describe("level and variant", () => {
  test("the level follows the volume height; a tree has one level", () => {
    assert.equal(levelOf("residential", 0.5), 0);
    assert.equal(levelOf("residential", 1.2), 1);
    assert.equal(levelOf("commercial", 1.74), 1);
    assert.equal(levelOf("commercial", 1.75), 2);
    assert.equal(levelOf("industrial", 9), 2);
    assert.equal(levelOf("tree", 9), 0);
  });

  test("tileHash is deterministic and spreads over the tiles", () => {
    assert.equal(tileHash(12, 34), tileHash(12, 34));
    assert.notEqual(tileHash(12, 34), tileHash(34, 12));
    const seen = new Set();
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) seen.add(tileHash(x, y) % 4);
    assert.equal(seen.size, 4);
  });

  test("the same volume always gets the same model; the model is of its kind and level", () => {
    for (let x = 0; x < 12; x++) {
      for (let y = 0; y < 12; y++) {
        for (const kind of ["residential", "commercial", "industrial"]) {
          for (const [sy, level] of [[0.6, 0], [1.4, 1], [2.4, 2]]) {
            const a = chooseModel(CATALOG, vol(kind, x, y, sy)), b = chooseModel(CATALOG, vol(kind, x, y, sy));
            assert.deepEqual(a, b);
            assert.ok(CATALOG[kind][level].includes(a.id), `${kind} ${sy}: ${a.id}`);
            assert.ok(a.quarter >= 0 && a.quarter <= 3);
          }
        }
      }
    }
  });

  test("a level with several variants uses them all over a map", () => {
    const ids = new Set();
    for (let x = 0; x < 30; x++) for (let y = 0; y < 30; y++) ids.add(chooseModel(CATALOG, vol("commercial", x, y, 2.4)).id);
    assert.deepEqual([...ids].sort(), [...CATALOG.commercial[2]].sort());
  });

  test("an unknown kind, or an emptied catalog, gives null", () => {
    assert.equal(chooseModel(CATALOG, vol("park", 1, 1)), null);
    assert.equal(chooseModel({ residential: [[]] }, vol("residential", 1, 1)), null);
  });

  test("the volumes of the real buildChunk get a model (the volume record and the catalog agree)", () => {
    const w = 8, h = 8;
    const tiles = new Uint16Array(w * h);
    tiles[2 * h + 2] = 249; // house
    tiles[4 * h + 4] = 21; // tree
    tiles[5 * h + 1] = 432; // commercial
    tiles[1 * h + 6] = 621; // industrial
    const alt = altitudesOf(tiles, null, w, h), grid = chunkGrid(w, h);
    const { volumes } = buildChunk({ grid, chunk: 0, tiles, alt, corners: cornerAltitudes(alt, w, h), tops: new Float32Array(w * h) });
    assert.equal(volumes.length, 4);
    for (const v of volumes) assert.ok(chooseModel(CATALOG, v), v.kind);
  });
});

describe("usableCatalog", () => {
  const all = Object.keys(MODEL_FILES);

  test("all models loaded: the whole catalog", () => {
    assert.deepEqual(usableCatalog(CATALOG, all), CATALOG);
  });

  test("a failed file only thins its level out", () => {
    const u = usableCatalog(CATALOG, all.filter((id) => id !== "com-sky-a"));
    assert.deepEqual(u.commercial[2], ["com-sky-c", "com-sky-e"]);
  });

  test("a level with no model left drops the kind (it keeps its boxes), the others stay", () => {
    const u = usableCatalog(CATALOG, all.filter((id) => !CATALOG.industrial[1].includes(id)));
    assert.equal(u.industrial, undefined);
    assert.ok(u.commercial && u.residential && u.tree);
  });

  test("nothing loaded: nothing usable", () => {
    assert.deepEqual(usableCatalog(CATALOG, []), {});
  });
});

describe("scale and placement", () => {
  test("a building fits its footprint whatever its shape, without distortion in plan", () => {
    for (const dims of [{ w: 2.08, h: 1.5, d: 1.2 }, { w: 0.9, h: 1.3, d: 1.1 }, { w: 1.2, h: 3, d: 1.3 }]) {
      const s = fitScale(dims, vol("commercial", 0, 0, 1.5));
      assert.equal(s.sx, s.sz);
      assert.ok(Math.max(dims.w, dims.d) * s.sx <= FOOTPRINT + 1e-9 || s.sx === MAX_UPSCALE);
      assert.ok(s.sx <= MAX_UPSCALE);
    }
    const big = fitScale({ w: 2, h: 1, d: 1 }, vol("commercial", 0, 0, 1));
    assert.ok(Math.abs(big.sx * 2 - FOOTPRINT) < 1e-9);
  });

  test("the height follows the volume within the stretch bounds", () => {
    const dims = { w: 1, h: 1, d: 1 };
    const s0 = fitScale(dims, vol("commercial", 0, 0, 1)).sx;
    assert.ok(Math.abs(fitScale(dims, vol("commercial", 0, 0, s0 * 1.2)).sy - s0 * 1.2) < 1e-9);
    assert.ok(Math.abs(fitScale(dims, vol("commercial", 0, 0, 100)).sy - s0 * STRETCH_MAX) < 1e-9);
    assert.ok(Math.abs(fitScale(dims, vol("commercial", 0, 0, 0.01)).sy - s0 * STRETCH_MIN) < 1e-9);
  });

  test("a tree is fitted to its height", () => {
    const s = fitScale({ w: 0.2, h: 0.77, d: 0.2 }, { kind: "tree", sy: 1 });
    assert.ok(Math.abs(s.sy * 0.77 - TREE_FIT_HEIGHT) < 1e-9);
    assert.equal(s.sx, s.sy);
  });

  test("the placement matrix: translation on the tile centre and the ground, quarter turns about Y", () => {
    const out = new Float32Array(32);
    writePlacement(out, 16, { x: 3, y: 5, base: 2.5 }, 0, { sx: 2, sy: 3, sz: 4 });
    assert.deepEqual([...out.slice(0, 16)], new Array(16).fill(0), "only its own 16 floats are written");
    assert.deepEqual([...out.slice(16, 32)], [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 3.5, 2.5, 5.5, 1]);
    writePlacement(out, 0, { x: 0, y: 0, base: 0 }, 1, { sx: 1, sy: 1, sz: 1 });
    // a quarter turn sends +X to -Z
    assert.deepEqual([out[0], out[1], out[2]], [0, 0, -1]);
    assert.deepEqual([out[8], out[9], out[10]], [1, 0, 0]);
    writePlacement(out, 0, { x: 0, y: 0, base: 0 }, 4, { sx: 1, sy: 1, sz: 1 });
    assert.equal(out[0], 1, "four quarter turns are the identity");
  });
});

describe("instance slots", () => {
  test("add packs the keys, repeats give the same index, a full table says -1", () => {
    const t = createSlotTable(3);
    assert.deepEqual([t.add(10), t.add(20), t.add(10), t.add(30), t.add(40)], [0, 1, 0, 2, -1]);
    assert.equal(t.count, 3);
    assert.equal(t.indexOf(30), 2);
    assert.equal(t.indexOf(40), -1);
  });

  test("remove moves the last key into the hole and says where from and to", () => {
    const t = createSlotTable(MODEL_CAPACITY);
    for (const k of [1, 2, 3, 4]) t.add(k);
    assert.deepEqual(t.remove(2), { from: 3, to: 1 });
    assert.equal(t.keyAt(1), 4);
    assert.equal(t.indexOf(4), 1);
    assert.equal(t.indexOf(2), -1);
    assert.equal(t.count, 3);
    assert.deepEqual(t.remove(3), { from: 2, to: 2 }, "removing the last moves nothing");
    assert.equal(t.remove(99), null);
    t.clear();
    assert.equal(t.count, 0);
  });

  test("a long churn of adds and removes keeps the table consistent and within capacity", () => {
    const t = createSlotTable(50);
    const live = new Set();
    for (let i = 0; i < 2000; i++) {
      const key = tileHash(i, 7) % 120;
      if (i % 3 === 0) {
        t.remove(key);
        live.delete(key);
      } else if (t.add(key) >= 0) live.add(key);
      assert.ok(t.count <= 50);
    }
    assert.equal(t.count, live.size);
    for (const key of live) assert.equal(t.keyAt(t.indexOf(key)), key);
  });
});

// Tile words (palette): dirt, road, house (a zone tile), empty residential zone, tree.
const DIRT = 0, ROAD = 64, HOUSE = 249, RES_EMPTY = 240, TREE = 21;

describe("buildings face the road", () => {
  const W = 9, H = 9;
  const city = (edit) => {
    const t = new Uint16Array(W * H).fill(DIRT);
    edit((x, y, word) => { t[x * H + y] = word; });
    return t;
  };

  test("a road on one side gives the quarter turn that points the front at it", () => {
    // south is +y (quarter 0), east +x (1), north -y (2), west -x (3)
    for (const [dx, dy, quarter] of [[0, 1, 0], [1, 0, 1], [0, -1, 2], [-1, 0, 3]]) {
      const t = city((set) => { set(4, 4, HOUSE); set(4 + dx, 4 + dy, ROAD); });
      assert.equal(facingQuarter(t, W, H, 4, 4), quarter, `road at (${dx}, ${dy})`);
    }
  });

  test("no road within reach: -1 (the hash yaw stays); the map edge is not a road", () => {
    const t = city((set) => { set(4, 4, HOUSE); set(0, 0, HOUSE); });
    assert.equal(facingQuarter(t, W, H, 4, 4), -1);
    assert.equal(facingQuarter(t, W, H, 0, 0), -1);
  });

  test("the road is seen across the rest of its zone, up to FACING_REACH tiles", () => {
    assert.equal(FACING_REACH, 2);
    const t = city((set) => { set(4, 4, HOUSE); set(5, 4, RES_EMPTY); set(6, 4, ROAD); set(2, 4, ROAD); });
    assert.equal(facingQuarter(t, W, H, 4, 4), 1, "east, through the zone tile");
    // dirt in between: the road behind it is not the road of this zone
    const u = city((set) => { set(4, 4, HOUSE); set(5, 4, DIRT); set(6, 4, ROAD); });
    assert.equal(facingQuarter(u, W, H, 4, 4), -1);
    // three tiles away: out of reach
    const f = city((set) => { set(4, 4, HOUSE); set(5, 4, HOUSE); set(6, 4, HOUSE); set(7, 4, ROAD); });
    assert.equal(facingQuarter(f, W, H, 4, 4), -1);
  });

  test("the nearest road wins; a tie goes to the tile hash and is deterministic", () => {
    const near = city((set) => { set(4, 4, HOUSE); set(4, 5, ROAD); set(3, 4, HOUSE); set(2, 4, ROAD); });
    assert.equal(facingQuarter(near, W, H, 4, 4), 0, "adjacent road beats the road two tiles away");
    const tie = city((set) => { set(4, 4, HOUSE); set(5, 4, ROAD); set(3, 4, ROAD); });
    const q = facingQuarter(tie, W, H, 4, 4);
    assert.ok(q === 1 || q === 3);
    assert.equal(facingQuarter(tie, W, H, 4, 4), q);
    const seen = new Set();
    for (let x = 1; x < 8; x++) {
      for (let y = 1; y < 8; y++) {
        const t = city((set) => { set(x, y, HOUSE); set(x + 1, y, ROAD); set(x - 1, y, ROAD); });
        seen.add(facingQuarter(t, W, H, x, y));
      }
    }
    assert.deepEqual([...seen].sort(), [1, 3], "the tie is spread over both sides");
  });

  test("chooseModel uses the facing for buildings, and the hash yaw for trees and without a facing", () => {
    for (let x = 0; x < 6; x++) {
      for (let q = 0; q < 4; q++) {
        assert.equal(chooseModel(CATALOG, vol("residential", x, 3), q).quarter, q);
        assert.equal(chooseModel(CATALOG, vol("tree", x, 3, 1), q).quarter, chooseModel(CATALOG, vol("tree", x, 3, 1)).quarter);
      }
      assert.equal(chooseModel(CATALOG, vol("commercial", x, 3), -1).quarter, chooseModel(CATALOG, vol("commercial", x, 3)).quarter);
    }
  });
});

describe("model brightness", () => {
  test("the gain lifts the slate colour maps to the terrain without clipping them", () => {
    const MEAN_TEXEL = 0.55; // brightest mean texel of the models (about 140 / 255)
    assert.ok(MODEL_GAIN > 1 && MODEL_GAIN <= 2, `gain ${MODEL_GAIN}`);
    assert.ok(MEAN_TEXEL * MODEL_GAIN <= 1, "a mean texel stays below white");
    assert.ok(0.45 * MODEL_GAIN >= 0.65, "an average building texel reaches terrain brightness");
    assert.equal(gainOf("com-a"), MODEL_GAIN);
    assert.equal(gainOf("sub-tree-large"), TREE_GAIN, "trees keep their own green");
  });
});
