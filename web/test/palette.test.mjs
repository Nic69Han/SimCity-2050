// Tile colours: the palette shared by the renderer and the legend (web/palette.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PALETTE, buildRgbTable, tileColor, legendEntries, MISSING_TILE_RGBA } from "../palette.js";

const labels = () => legendEntries().map((e) => e.label);

describe("palette data", () => {
  test("ranges are ordered, inside 0..1023, and never overlap", () => {
    const sorted = [...PALETTE].sort((a, b) => a.lo - b.lo);
    for (const e of PALETTE) {
      assert.ok(e.lo >= 0 && e.hi <= 1023 && e.lo <= e.hi, `${e.label} ${e.lo}..${e.hi}`);
    }
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].lo > sorted[i - 1].hi, `${sorted[i - 1].label} overlaps ${sorted[i].label}`);
    }
  });

  test("every entry has a six-digit hex colour and a French label", () => {
    for (const e of PALETTE) {
      assert.match(e.color, /^#[0-9a-f]{6}$/iu, e.label);
      assert.ok(e.label.length > 0);
    }
  });

  test("the legend lists what the page asks for: water, trees, road, power line, rail, the three zones, services, power plants, fire", () => {
    for (const want of [
      "Eau", "Arbres", "Route", "Ligne électrique", "Voie ferrée", "Zone résidentielle",
      "Zone commerciale", "Zone industrielle", "Incendie", "Centrale au charbon", "Centrale nucléaire",
    ]) {
      assert.ok(labels().includes(want), want);
    }
    assert.ok(labels().some((l) => l.startsWith("Services")), "services");
  });

  test("the legend has one row per label (no repeats) and keeps palette order", () => {
    const names = labels();
    assert.equal(new Set(names).size, names.length);
    assert.equal(names[0], "Terrain nu");
    assert.ok(names.indexOf("Eau") < names.indexOf("Route"));
  });
});

describe("tile colour lookup", () => {
  test("known C++ tile numbers map to the expected kind", () => {
    assert.equal(tileColor(2), tileColor(20));
    assert.equal(tileColor(2), PALETTE.find((e) => e.label === "Eau").color);
    assert.equal(tileColor(240), PALETTE.find((e) => e.label === "Zone résidentielle").color);
    assert.equal(tileColor(423), PALETTE.find((e) => e.label === "Zone commerciale").color);
    assert.equal(tileColor(612), PALETTE.find((e) => e.label === "Zone industrielle").color);
    assert.equal(tileColor(745), PALETTE.find((e) => e.label === "Centrale au charbon").color);
    assert.equal(tileColor(811), PALETTE.find((e) => e.label === "Centrale nucléaire").color);
    assert.equal(tileColor(761), PALETTE.find((e) => e.label.startsWith("Services")).color);
  });

  test("the low 10 bits are used, as the renderer does", () => {
    assert.equal(tileColor(1024 + 2), tileColor(2));
  });

  test("a tile with no range has no colour (the renderer paints it magenta)", () => {
    const sparse = [{ lo: 0, hi: 10, color: "#000000", label: "x" }];
    assert.equal(tileColor(500, sparse), null);
  });
});

describe("renderer table", () => {
  const rgb = buildRgbTable();
  const abgr = (hex) => {
    const v = parseInt(hex.slice(1), 16);
    return ((0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | (v >> 16)) >>> 0);
  };

  test("one word per tile character, in little-endian RGBA (ABGR) order", () => {
    assert.equal(rgb.length, 1024);
    assert.equal(rgb[2], abgr("#2a5fb0"));
    // #2a5fb0: red 0x2a, green 0x5f, blue 0xb0 -> bytes R,G,B,A = 2a 5f b0 ff
    const bytes = new Uint8Array(new Uint32Array([rgb[2]]).buffer);
    assert.deepEqual([...bytes], [0x2a, 0x5f, 0xb0, 0xff]);
  });

  test("a tile with no colour is magenta, a tile in a range gets its colour", () => {
    assert.equal(MISSING_TILE_RGBA, 0xffff00ff);
    const holes = buildRgbTable([{ lo: 0, hi: 0, color: "#ffffff", label: "x" }]);
    assert.equal(holes[1], MISSING_TILE_RGBA);
    assert.equal(holes[0], abgr("#ffffff"));
  });

  test("the renderer table agrees with tileColor for every tile", () => {
    for (let t = 0; t < 1024; t++) {
      const c = tileColor(t);
      if (c === null) assert.equal(rgb[t], MISSING_TILE_RGBA, `tile ${t}`);
      else assert.equal(rgb[t], abgr(c), `tile ${t}`);
    }
  });
});
