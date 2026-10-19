// The 2D structures layer (web/map-layer-structures.js) and its pure model (map-layer-structures-model.js),
// against a fake engine: the real contract is the engine's, this checks what the page does with it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  decodeStructures, decodeCatalog, rectOf, colorOf, needsPower, isPowered,
  MAX_DRAWN, MAX_CATALOG, STRUCTURE_SIZE, CATALOG_SIZE, STATE_POWERED, FLAG_NEEDS_POWER,
  GENRE_COLORS, UNKNOWN_GENRE_COLOR, OUTLINE_COLOR, POWER_MARK_COLOR,
} from "../map-layer-structures-model.js";
import { STRUCTURES_LAYER } from "../map-layer-structures.js";
import { MAP_LAYERS } from "../map-layers.js";

// A fake context that records what is painted, with the fill style in force at each call.
function recorder() {
  const log = [];
  const ctx = {
    fillStyle: "",
    save: () => log.push(["save"]),
    restore: () => log.push(["restore"]),
    fillRect(x, y, w, h) { log.push(["rect", x, y, w, h, this.fillStyle]); },
  };
  return { ctx, log };
}

// A fake engine: structure records [genre, x, y, w, h, state] and catalog records of 8.
class FakeStructures {
  constructor({ rules = true, records = [], catalog = [] } = {}) {
    this.rules = rules;
    this.records = records;
    this.catalog = catalog;
    this.catalogCalls = 0;
    this.structuresCalls = 0;
  }
  structure_rules() { return this.rules; }
  structures() {
    this.structuresCalls++;
    return Int32Array.from(this.records.flat());
  }
  structure_catalog() {
    this.catalogCalls++;
    return Int32Array.from(this.catalog.flat());
  }
}

// A fake engine without the catalog method.
class NoCatalog extends FakeStructures {
  constructor(opts) {
    super(opts);
    this.structure_catalog = undefined; // the engine has no catalog method
  }
}

const rects = (log) => log.filter((e) => e[0] === "rect");

describe("decoding the structure records", () => {
  test("reads [genre, x, y, largeur, hauteur, etat]", () => {
    const out = decodeStructures(Int32Array.of(1, 4, 5, 2, 2, 1, 3, 0, 0, 3, 3, 0));
    assert.deepEqual(out, [
      { genre: 1, x: 4, y: 5, w: 2, h: 2, state: 1 },
      { genre: 3, x: 0, y: 0, w: 3, h: 3, state: 0 },
    ]);
  });

  test("a trailing incomplete record is ignored", () => {
    assert.equal(decodeStructures(Int32Array.of(1, 0, 0, 2, 2, 1, 2, 0)).length, 1);
    assert.deepEqual(decodeStructures(Int32Array.of(1, 0, 0, 2)), []);
  });

  test("a record with an empty footprint is ignored", () => {
    const arr = Int32Array.of(1, 0, 0, 0, 2, 0, 2, 0, 0, 1, 1, 0, 3, 0, 0, -1, 1, 0);
    assert.deepEqual(decodeStructures(arr).map((r) => r.genre), [2]);
  });

  test("an empty, missing or non-array input gives no structure", () => {
    assert.deepEqual(decodeStructures(new Int32Array(0)), []);
    assert.deepEqual(decodeStructures(undefined), []);
    assert.deepEqual(decodeStructures(null), []);
    assert.deepEqual(decodeStructures(42), []);
  });

  test("at most MAX_DRAWN records are read, the rest is never decoded", () => {
    assert.equal(MAX_DRAWN, 512);
    assert.equal(STRUCTURE_SIZE, 6);
    const records = Array.from({ length: MAX_DRAWN + 40 }, (_, i) => [1, i, 0, 1, 1, 0]);
    const out = decodeStructures(Int32Array.from(records.flat()));
    assert.equal(out.length, MAX_DRAWN);
    assert.equal(out.at(-1).x, MAX_DRAWN - 1);
  });

  test("an explicit max lowers the count read", () => {
    const arr = Int32Array.of(1, 0, 0, 1, 1, 0, 2, 1, 1, 1, 1, 0, 3, 2, 2, 1, 1, 0);
    assert.equal(decodeStructures(arr, 2).length, 2);
    assert.equal(decodeStructures(arr, 0).length, 0);
  });
});

describe("decoding the catalog", () => {
  test("reads [genre, largeur, hauteur, cout, entretien, drapeaux, rayon, effet] by genre", () => {
    assert.equal(CATALOG_SIZE, 8);
    const map = decodeCatalog(Int32Array.of(3, 3, 3, 500, 5, 1, 4, 1));
    assert.deepEqual(map.get(3), {
      genre: 3, w: 3, h: 3, cost: 500, upkeep: 5, flags: 1, radius: 4, effect: 1,
    });
    assert.equal(map.has(1), false);
  });

  test("a trailing incomplete entry is ignored, a missing input is an empty catalog", () => {
    assert.equal(decodeCatalog(Int32Array.of(1, 2, 2, 100, 2, 0, 3, 0, 2, 1)).size, 1);
    assert.equal(decodeCatalog(undefined).size, 0);
    assert.equal(decodeCatalog(null).size, 0);
    assert.equal(decodeCatalog(7).size, 0);
  });

  test("at most MAX_CATALOG entries are read", () => {
    assert.equal(MAX_CATALOG, 64);
    const entries = Array.from({ length: MAX_CATALOG + 5 }, (_, i) => [i + 1, 1, 1, 0, 0, 0, 0, 0]);
    assert.equal(decodeCatalog(Int32Array.from(entries.flat())).size, MAX_CATALOG);
  });
});

describe("geometry, colours and power", () => {
  test("the rectangle is the footprint in pixels", () => {
    assert.deepEqual(rectOf({ x: 4, y: 5, w: 2, h: 3 }, 8), [32, 40, 16, 24]);
  });

  test("park green, square beige, monument grey; an unknown genre is grey", () => {
    assert.equal(colorOf(1), GENRE_COLORS[1]);
    assert.equal(colorOf(2), GENRE_COLORS[2]);
    assert.equal(colorOf(3), GENRE_COLORS[3]);
    assert.equal(new Set([1, 2, 3].map(colorOf)).size, 3);
    for (const genre of [0, 4, -1, 99, "toString"]) assert.equal(colorOf(genre), UNKNOWN_GENRE_COLOR);
    assert.equal(UNKNOWN_GENRE_COLOR, "#9e9e9e");
  });

  test("a genre needs power when bit 0 of its catalog flags is set", () => {
    assert.equal(FLAG_NEEDS_POWER, 1);
    const catalog = decodeCatalog(Int32Array.of(1, 2, 2, 0, 0, 0, 0, 0, 2, 1, 1, 0, 0, 2, 0, 0, 3, 3, 3, 0, 0, 3, 0, 0));
    assert.equal(needsPower(catalog, 1), false); // no flags
    assert.equal(needsPower(catalog, 2), false); // water only (bit 1)
    assert.equal(needsPower(catalog, 3), true); // bits 0 and 1
  });

  test("a genre missing from the catalog, or no catalog, does not need power", () => {
    assert.equal(needsPower(decodeCatalog(null), 1), false);
    assert.equal(needsPower(new Map(), 1), false);
    assert.equal(needsPower(undefined, 1), false);
  });

  test("a structure is powered from bit 0 of its state", () => {
    assert.equal(STATE_POWERED, 1);
    assert.equal(isPowered({ state: 1 }), true);
    assert.equal(isPowered({ state: 3 }), true);
    assert.equal(isPowered({ state: 2 }), false);
    assert.equal(isPowered({ state: 0 }), false);
  });
});

describe("the layer", () => {
  test("named structures, registered between the transit and the vehicles layers", () => {
    assert.equal(STRUCTURES_LAYER.name, "structures");
    assert.equal(MAP_LAYERS.find((l) => l.name === "structures"), STRUCTURES_LAYER);
  });

  test("not visible for an engine without the API, or with the rule off", () => {
    assert.equal(STRUCTURES_LAYER.visible({}), false);
    assert.equal(STRUCTURES_LAYER.visible({ structure_rules: () => true }), false);
    assert.equal(STRUCTURES_LAYER.visible({ structures: () => new Int32Array(0) }), false);
    assert.equal(STRUCTURES_LAYER.visible(new FakeStructures({ rules: false })), false);
    assert.equal(STRUCTURES_LAYER.visible(new FakeStructures({ rules: true })), true);
  });

  test("draws a park: fill, 1px frame inside the footprint, no mark when powered", () => {
    const city = new FakeStructures({ records: [[1, 1, 2, 2, 2, 1]] });
    const { ctx, log } = recorder();
    STRUCTURES_LAYER.draw(ctx, city, 4);
    assert.deepEqual(log, [
      ["save"],
      ["rect", 4, 8, 8, 8, GENRE_COLORS[1]],
      ["rect", 4, 8, 8, 1, OUTLINE_COLOR],
      ["rect", 4, 15, 8, 1, OUTLINE_COLOR],
      ["rect", 4, 8, 1, 8, OUTLINE_COLOR],
      ["rect", 11, 8, 1, 8, OUTLINE_COLOR],
      ["restore"],
    ]);
  });

  test("an unpowered monument that needs power gets a red mark in its top-right corner", () => {
    const city = new FakeStructures({
      records: [[3, 0, 0, 3, 3, 0]],
      catalog: [[3, 3, 3, 500, 5, 1, 4, 0]],
    });
    const { ctx, log } = recorder();
    STRUCTURES_LAYER.draw(ctx, city, 4);
    // scale 4: footprint 12 x 12; mark = max(2, 4 / 4) = 2 px square at (12 - 2, 0)
    assert.deepEqual(rects(log).at(-1), ["rect", 10, 0, 2, 2, POWER_MARK_COLOR]);
    assert.equal(rects(log).length, 1 + 4 + 1);
  });

  test("no red mark when the genre does not need power, or the structure is powered", () => {
    const city = new FakeStructures({
      records: [[1, 0, 0, 2, 2, 0], [3, 4, 4, 3, 3, 1]],
      catalog: [[1, 2, 2, 0, 0, 0, 0, 0], [3, 3, 3, 500, 5, 1, 4, 0]],
    });
    const { ctx, log } = recorder();
    STRUCTURES_LAYER.draw(ctx, city, 4);
    assert.equal(rects(log).some((e) => e[5] === POWER_MARK_COLOR), false);
  });

  test("without the catalog method, no mark is drawn and the rest is the same", () => {
    const city = new NoCatalog({ records: [[3, 0, 0, 3, 3, 0]] });
    const { ctx, log } = recorder();
    STRUCTURES_LAYER.draw(ctx, city, 4);
    assert.equal(rects(log).length, 5);
    assert.equal(rects(log).some((e) => e[5] === POWER_MARK_COLOR), false);
  });

  test("an unknown genre is grey, and the catalog is read once per draw", () => {
    const city = new FakeStructures({ records: [[42, 0, 0, 1, 1, 0], [43, 2, 0, 1, 1, 0]] });
    const { ctx, log } = recorder();
    STRUCTURES_LAYER.draw(ctx, city, 2);
    assert.equal(rects(log)[0][5], UNKNOWN_GENRE_COLOR);
    assert.equal(city.catalogCalls, 1);
    assert.equal(city.structuresCalls, 1);
  });

  test("the mark is cut down to a 1 px footprint at scale 1", () => {
    const city = new FakeStructures({
      records: [[3, 0, 0, 1, 1, 0]],
      catalog: [[3, 1, 1, 0, 0, 1, 0, 0]],
    });
    const { ctx, log } = recorder();
    // scale 1: a 1 px footprint, so the 2 px mark is cut down to 1 px
    STRUCTURES_LAYER.draw(ctx, city, 1);
    assert.deepEqual(rects(log).at(-1), ["rect", 0, 0, 1, 1, POWER_MARK_COLOR]);
  });

  test("the structures drawn stop at MAX_DRAWN even when the engine sends more", () => {
    const records = Array.from({ length: MAX_DRAWN + 30 }, (_, i) => [1, i % 8, 0, 1, 1, 1]);
    const city = new FakeStructures({ records });
    const { ctx, log } = recorder();
    STRUCTURES_LAYER.draw(ctx, city, 4);
    const fills = rects(log).filter((e) => e[5] === GENRE_COLORS[1]);
    assert.equal(fills.length, MAX_DRAWN);
  });

  test("draws nothing but the frame for an empty map", () => {
    const { ctx, log } = recorder();
    STRUCTURES_LAYER.draw(ctx, new FakeStructures(), 8);
    assert.deepEqual(log, [["save"], ["restore"]]);
  });

  test("draws nothing at all for an engine without the API", () => {
    const { ctx, log } = recorder();
    STRUCTURES_LAYER.draw(ctx, {}, 8);
    assert.deepEqual(log, []);
  });
});
