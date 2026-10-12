// Tile art: what each tile character is drawn as, the 3x3 / 4x4 / 6x6 zone blocks, the key that
// decides a tile's picture, and the shimmer clock. Pure logic (no canvas): see tiles.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  artClass, artKey, decodeKey, zonePiece, unpoweredCentre, shimmerPhase, shimmers, variantOf,
  SHIMMER_MS, SHIMMER_PHASES, TILE_LIMIT,
} from "../tiles.js";

const ZONEBIT = 0x0400;
const PWRBIT = 0x8000;

describe("what a tile character is drawn as", () => {
  test("every character of the 10-bit range has a class (unknown numbers are dirt)", () => {
    for (let c = 0; c < TILE_LIMIT; c++) {
      assert.equal(typeof artClass(c), "string", `character ${c}`);
    }
    assert.equal(artClass(1019), "dirt");
    assert.equal(artClass(1023), "dirt");
  });

  test("the classes named by tile_chars.rs", () => {
    const cases = {
      0: "dirt", 2: "water", 4: "water", 5: "shore", 20: "shore", 21: "tree", 37: "woods",
      44: "rubble", 48: "flood", 52: "radiation", 56: "fire", 63: "fire", 64: "bridge", 66: "road",
      76: "road", 77: "road-wire", 79: "bridge", 80: "traffic", 94: "traffic", 95: "bridge",
      144: "traffic", 158: "traffic", 208: "wire", 220: "wire", 221: "rail-wire", 224: "rail",
      236: "rail", 237: "rail-road", 240: "zone", 249: "zone", 265: "zone", 423: "zone", 612: "zone",
      693: "zone", 745: "zone", 827: "lightning", 828: "bridge", 832: "radar", 840: "fountain",
      844: "tele", 852: "smoke", 860: "explosion", 916: "smoke", 932: "football", 948: "bridge",
      952: "nuke-swirl", 956: "zone", 1018: "zone",
    };
    for (const [c, cls] of Object.entries(cases)) assert.equal(artClass(Number(c)), cls, `character ${c}`);
  });

  test("the shimmer classes are water (shores included), fire and radiation, and nothing else", () => {
    assert.equal(shimmers(2), true);
    assert.equal(shimmers(12), true);
    assert.equal(shimmers(56), true);
    assert.equal(shimmers(52), true);
    assert.equal(shimmers(37), false);
    assert.equal(shimmers(66), false);
    assert.equal(shimmers(240), false);
  });
});

describe("zone blocks: the 3x3 (4x4, 6x6) pieces of one building", () => {
  // Every block of the engine's zone tile ranges, grouped by family and block index.
  function blocks(from, to) {
    const map = new Map();
    for (let c = from; c <= to; c++) {
      const p = zonePiece(c);
      if (!p) continue;
      const key = `${p.family}/${p.block}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ c, ...p });
    }
    return map;
  }

  test("each block's tiles cover its footprint exactly once", () => {
    for (let c = 240; c <= 1018; c++) {
      const p = zonePiece(c);
      if (!p || p.family === "house") continue;
      assert.ok(p.zx >= 0 && p.zx < p.n && p.zy >= 0 && p.zy < p.n, `piece ${c} inside its ${p.n}x${p.n} footprint`);
    }
    for (const [key, pieces] of blocks(240, 1018)) {
      if (key.startsWith("house")) continue;
      const n = pieces[0].n;
      const seen = new Set(pieces.map((p) => `${p.zx},${p.zy}`));
      if (pieces.length === n * n) assert.equal(seen.size, n * n, `block ${key} has every piece once`);
      for (const p of pieces) assert.equal(p.n, n, `block ${key} has one size`);
    }
  });

  test("a 3x3 block's centre is its middle piece, the tile with the zone bit", () => {
    assert.deepEqual(zonePiece(265), { family: "res", n: 3, block: 0, density: 0, z: 4, zx: 1, zy: 1 });
    assert.equal(zonePiece(436).zx, 1); // commercial block 0 centre (CZB)
    assert.equal(zonePiece(436).zy, 1);
    assert.equal(zonePiece(716).zx, 1); // airport 6x6 centre
    assert.equal(zonePiece(716).n, 6);
    assert.equal(zonePiece(698).zx, 1); // seaport 4x4 centre
    assert.equal(zonePiece(698).zy, 1);
    assert.equal(zonePiece(750).n, 4); // power plant
  });

  test("residential blocks start after the empty lot and before the hospital; density cycles", () => {
    assert.equal(zonePiece(261).block, 0);
    assert.equal(zonePiece(261).zx, 0);
    assert.equal(zonePiece(261).zy, 0);
    assert.equal(zonePiece(404).block, 15);
    assert.equal(zonePiece(405).family, "hospital");
    assert.equal(zonePiece(414).family, "church");
    const densities = [0, 1, 2, 3].map((k) => zonePiece(261 + 9 * k).density);
    assert.deepEqual(densities, [0, 1, 2, 3]);
    assert.equal(zonePiece(261 + 9 * 4).density, 0);
  });

  test("houses are single tiles with their own density, and not blocks", () => {
    const h = zonePiece(249);
    assert.equal(h.family, "house");
    assert.equal(h.n, 1);
    assert.equal(zonePiece(260).density, 11);
  });

  test("a tile outside every block has no piece", () => {
    assert.equal(zonePiece(0), null);
    assert.equal(zonePiece(100), null);
    assert.equal(zonePiece(827), null);
    assert.equal(zonePiece(1019), null);
  });

  test("churches 1 to 7 are 3x3 blocks after the zone ranges", () => {
    assert.equal(zonePiece(960).family, "church");
    assert.equal(zonePiece(960).zx, 1);
    assert.equal(zonePiece(960).zy, 1);
    assert.equal(zonePiece(1018).block, 6);
  });
});

describe("keys: what decides a tile's picture", () => {
  test("a key is below 2^15 and decodes back", () => {
    for (let t = 0; t < 1024; t += 7) {
      for (const flags of [0, ZONEBIT, ZONEBIT | PWRBIT]) {
        const key = artKey(t | flags, 3, 5, 2);
        assert.ok(key >= 0 && key < 1 << 15, `key of ${t} ${flags}`);
        assert.equal(decodeKey(key).c, t);
      }
    }
  });

  test("the power icon bit is set for an unpowered zone centre only", () => {
    assert.equal(decodeKey(artKey(265 | ZONEBIT, 0, 0, 0)).powerIcon, 1);
    assert.equal(decodeKey(artKey(265 | ZONEBIT | PWRBIT, 0, 0, 0)).powerIcon, 0);
    assert.equal(decodeKey(artKey(265, 0, 0, 0)).powerIcon, 0);
    assert.equal(unpoweredCentre(265 | ZONEBIT), true);
    assert.equal(unpoweredCentre(265 | ZONEBIT | PWRBIT), false);
    assert.equal(unpoweredCentre(265), false);
  });

  test("only the shimmer classes change with the phase", () => {
    for (let phase = 0; phase < SHIMMER_PHASES; phase++) {
      assert.equal(decodeKey(artKey(2, 0, 0, phase)).phase, phase, "water shimmers");
      assert.equal(decodeKey(artKey(240, 0, 0, phase)).phase, 0, "a house does not");
    }
    assert.notEqual(artKey(56, 0, 0, 0), artKey(56, 0, 0, 1), "fire has a look per phase");
  });

  test("dirt and woods have a position variant (0..3), other classes do not", () => {
    const seen = new Set();
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        const v = variantOf(x, y);
        assert.ok(v >= 0 && v <= 3);
        seen.add(v);
        assert.equal(decodeKey(artKey(0, x, y, 0)).variant, v);
      }
    }
    assert.equal(seen.size, 4, "all four variants occur");
    assert.equal(decodeKey(artKey(66, 1, 2, 0)).variant, 0, "a road has one look");
    assert.equal(variantOf(3, 4), variantOf(3, 4), "the same tile always gets the same variant");
  });
});

describe("shimmer clock", () => {
  test("the phase steps every SHIMMER_MS and cycles through SHIMMER_PHASES", () => {
    assert.equal(shimmerPhase(0), 0);
    assert.equal(shimmerPhase(SHIMMER_MS - 1), 0);
    assert.equal(shimmerPhase(SHIMMER_MS), 1);
    assert.equal(shimmerPhase(SHIMMER_MS * SHIMMER_PHASES), 0, "back to the first look");
    const phases = new Set();
    for (let t = 0; t < SHIMMER_MS * SHIMMER_PHASES * 2; t += SHIMMER_MS) phases.add(shimmerPhase(t));
    assert.equal(phases.size, SHIMMER_PHASES);
  });
});
