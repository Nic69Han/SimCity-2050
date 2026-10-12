// Map views: the colour bands of the original's map windows (map.cpp, getCI), the heat layer
// built from the engine's cluster values, the legends, and the list of view modes.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  VIEW_MODES, BANDS, BAND_COLOURS, bandOf, bandWords, paintHeat, legendOf, modeById, offsetOf,
} from "../overlays.js";

describe("colour bands (the original's thresholds)", () => {
  test("below 50 nothing is drawn; then 50, 100, 150 and 200 start a band", () => {
    assert.deepEqual(BANDS, [50, 100, 150, 200]);
    assert.equal(bandOf(0), 0);
    assert.equal(bandOf(49), 0);
    assert.equal(bandOf(50), 1);
    assert.equal(bandOf(99), 1);
    assert.equal(bandOf(100), 2);
    assert.equal(bandOf(149), 2);
    assert.equal(bandOf(150), 3);
    assert.equal(bandOf(199), 3);
    assert.equal(bandOf(200), 4);
    assert.equal(bandOf(255), 4);
  });

  test("the band with no value has no colour (transparent); the others are opaque-ish", () => {
    const words = bandWords();
    assert.equal(words.length, BAND_COLOURS.length);
    assert.equal(words[0], 0);
    for (let b = 1; b < words.length; b++) assert.notEqual(words[b] >>> 24, 0, `band ${b} has alpha`);
    assert.equal(BAND_COLOURS[0], null);
  });

  test("the colours are distinct (the bands can be told apart)", () => {
    const words = bandWords().slice(1);
    assert.equal(new Set(words).size, words.length);
  });
});

describe("the heat layer", () => {
  // A 4x4 map of 2x2 clusters. Cells are column-major (cx * rows + cy): cluster (0,0) = 0,
  // (0,1) = 60 (tiles x 0..1, y 2..3), (1,0) = 160 (x 2..3, y 0..1), (1,1) = 250.
  const cells = Uint8Array.from([0, 60, 160, 250]);
  const base = { cells, cols: 2, rows: 2, block: 2, w: 4, h: 4, tilePx: 1 };

  test("each tile takes the band of its cluster (cells are column-major)", () => {
    const words = bandWords();
    const out = new Uint32Array(16);
    const coloured = paintHeat(out, base, words);
    assert.equal(coloured, 12, "three clusters of 2x2 tiles are coloured; the first (value 0) is not");
    assert.equal(out[0], 0, "tile (0,0) has value 0: transparent");
    assert.equal(out[2], words[3], "tile (2,0) is cluster (1,0) = 160: band 3");
    assert.equal(out[2 * 4 + 0], words[1], "tile (0,2) is cluster (0,1) = 60: band 1");
    assert.equal(out[3 * 4 + 3], words[4], "tile (3,3) is cluster (1,1) = 250: band 4");
  });

  test("a tile is painted tilePx x tilePx pixels", () => {
    const words = bandWords();
    const out = new Uint32Array(8 * 8);
    paintHeat(out, { ...base, tilePx: 2 }, words);
    assert.equal(out[0], 0, "tile (0,0) is transparent");
    assert.equal(out[4], words[3], "tile (2,0) starts at pixel 4");
    assert.equal(out[1 * 8 + 5], words[3], "and fills its second row and column");
  });

  test("the pollution offset moves the bands (the original starts pollution at 10)", () => {
    const words = bandWords();
    const out = new Uint32Array(16);
    paintHeat(out, { cells: Uint8Array.from([40, 0, 0, 0]), cols: 2, rows: 2, block: 2, w: 4, h: 4, tilePx: 1, offset: 10 }, words);
    assert.equal(out[0], words[1], "40 + 10 reaches the first band");
    const plain = new Uint32Array(16);
    paintHeat(plain, { cells: Uint8Array.from([40, 0, 0, 0]), cols: 2, rows: 2, block: 2, w: 4, h: 4, tilePx: 1 }, words);
    assert.equal(plain[0], 0, "without the offset, 40 is below the first band");
  });

  test("a binary map (power grid) has two states: nothing, or the top band", () => {
    const words = bandWords();
    const out = new Uint32Array(16);
    paintHeat(out, { cells: Uint8Array.from([0, 1, 1, 0]), cols: 2, rows: 2, block: 2, w: 4, h: 4, tilePx: 1, binary: true }, words);
    assert.equal(out[0], 0);
    assert.equal(out[2], words[4]);
  });
});

describe("view modes and legends", () => {
  test("the modes are the normal view and the eight overlays, each with an engine kind", () => {
    assert.equal(VIEW_MODES.length, 9);
    const ids = VIEW_MODES.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, "ids are unique");
    assert.equal(VIEW_MODES[0].kind, null, "the first mode is the normal view");
    const kinds = VIEW_MODES.slice(1).map((m) => m.kind).sort((a, b) => a - b);
    assert.deepEqual(kinds, [0, 1, 2, 3, 4, 5, 6, 7], "one engine kind per overlay");
  });

  test("the labels are the French names of the view selector", () => {
    const labels = VIEW_MODES.map((m) => m.label);
    assert.deepEqual(labels, [
      "Normal", "Densité", "Valeur du terrain", "Criminalité", "Pollution", "Trafic",
      "Réseau électrique", "Pompiers", "Police",
    ]);
  });

  test("modeById falls back to the normal view", () => {
    assert.equal(modeById("pollution").kind, 3);
    assert.equal(modeById("nope").id, "normal");
  });

  test("pollution starts its bands at 10 (map.cpp), the other maps at 0", () => {
    assert.equal(offsetOf(modeById("pollution")), 10);
    assert.equal(offsetOf(modeById("densite")), 0);
  });

  test("the normal view has no legend; each overlay names its bands", () => {
    assert.equal(legendOf(modeById("normal")), null);
    const legend = legendOf(modeById("densite"));
    assert.equal(legend.title, "Densité de population");
    assert.equal(legend.bands.length, 4);
    assert.equal(legend.bands[0].name, "faible");
    assert.equal(legend.bands[3].range, "200 et plus");
  });

  test("the power grid legend has one state: powered", () => {
    const legend = legendOf(modeById("reseau"));
    assert.equal(legend.bands.length, 1);
    assert.equal(legend.bands[0].name, "alimenté");
  });
});
