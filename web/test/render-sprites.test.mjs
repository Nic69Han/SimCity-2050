// Sprite records (city.sprites) decoded for the page, and where each moving object is drawn.
// The drawing itself needs a canvas (e2e); the decoding and the geometry are pure.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decodeSprites, spriteCentre, headingFrom, trackingKeys, SPRITE_KINDS, ENGINE_PX } from "../sprites-art.js";

describe("decoding the flat records", () => {
  test("8 integers per record: kind, frame, x, y, x_hot, y_hot, width, height", () => {
    const out = decodeSprites([1, 4, 160, 320, 200, 312, 32, 32, 3, 9, 48, 48, 48, 16, 48, 48]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { kind: 1, name: "train", frame: 4, x: 160, y: 320, xHot: 200, yHot: 312, width: 32, height: 32 });
    assert.equal(out[1].name, "airplane");
    assert.equal(out[1].xHot, 48);
  });

  test("the typed arrays of the engine decode like plain arrays", () => {
    const out = decodeSprites(Int32Array.from([2, 1, 10, 20, 40, -8, 32, 32]));
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "helicopter");
    assert.equal(out[0].yHot, -8);
  });

  test("an empty or malformed list draws nothing", () => {
    assert.deepEqual(decodeSprites([]), []);
    assert.deepEqual(decodeSprites(null), []);
    assert.deepEqual(decodeSprites(undefined), []);
    assert.deepEqual(decodeSprites([1, 2, 3]), [], "not a whole record");
    assert.deepEqual(decodeSprites([1, 2, Number.NaN, 4, 5, 6, 7, 8]), [], "a NaN field drops the record");
  });

  test("kinds that the engine does not know are kept, named unknown", () => {
    const [s] = decodeSprites([42, 1, 0, 0, 0, 0, 8, 8]);
    assert.equal(s.name, "unknown");
  });

  test("the SpriteType table covers the engine's eight moving kinds", () => {
    assert.deepEqual(Object.keys(SPRITE_KINDS).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(SPRITE_KINDS[5], "monster");
    assert.equal(SPRITE_KINDS[6], "tornado");
    assert.equal(SPRITE_KINDS[7], "explosion");
    assert.equal(SPRITE_KINDS[8], "bus");
  });
});

describe("where a sprite is drawn", () => {
  test("the centre is the hot point (x + x_hot, y + y_hot), in tiles of 16 engine pixels", () => {
    const [s] = decodeSprites([4, 1, 160, 320, 48, 0, 48, 48]);
    assert.deepEqual(spriteCentre(s), { x: (160 + 48) / ENGINE_PX, y: 320 / ENGINE_PX });
  });

  test("the heading follows the movement, and is kept while the sprite stands still", () => {
    assert.equal(headingFrom(null, { x: 1, y: 1 }, 0.7), 0.7, "first frame: the previous angle");
    assert.equal(headingFrom({ x: 1, y: 1 }, { x: 2, y: 1 }), 0, "east");
    assert.equal(headingFrom({ x: 1, y: 1 }, { x: 1, y: 2 }), Math.PI / 2, "south");
    assert.equal(headingFrom({ x: 1, y: 1 }, { x: 1, y: 0 }), -Math.PI / 2, "north");
    assert.equal(headingFrom({ x: 1, y: 1 }, { x: 1.001, y: 1 }, 2.5), 2.5, "no movement keeps the angle");
  });

  test("tracking keys number the objects of each kind in list order", () => {
    const list = decodeSprites([1, 1, 0, 0, 0, 0, 8, 8, 3, 1, 0, 0, 0, 0, 8, 8, 1, 1, 0, 0, 0, 0, 8, 8]);
    assert.deepEqual(trackingKeys(list), ["1#0", "3#0", "1#1"]);
  });
});
