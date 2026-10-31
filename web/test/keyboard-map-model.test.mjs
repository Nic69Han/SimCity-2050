// Tests of the keyboard map's pure part (web/keyboard-map-model.js): the cursor starts in the middle, moves
// by one tile or by CURSOR_JUMP with Maj, never leaves the map (edges, a smaller map), ignores other keys,
// belongs to the map only outside fields and without Ctrl/Cmd/Alt, and announces the tile in French.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CURSOR_JUMP, APPLY_KEY, MAP_KEYS, initialCursor, clampCursor, move, keyBelongsToMap, describeTile,
} from "../keyboard-map-model.js";
import { formatZoneStatus } from "../query.js";

const plain = { target: { tagName: "CANVAS", isContentEditable: false } };
const key = (k, extra = {}) => ({ key: k, ...plain, ...extra });

describe("the cursor's start and bounds", () => {
  test("the cursor starts in the middle of the map", () => {
    assert.deepEqual(initialCursor(120, 100), { x: 60, y: 50 });
    assert.deepEqual(initialCursor(1, 1), { x: 0, y: 0 });
  });

  test("a map size must be whole and at least 1", () => {
    assert.throws(() => initialCursor(0, 10), RangeError);
    assert.throws(() => initialCursor(10, 1.5), RangeError);
    assert.throws(() => clampCursor({ x: 0, y: 0 }, NaN, 4), RangeError);
  });

  test("a cursor outside the map is clamped inside it, and a cursor that is not whole tiles is an error", () => {
    assert.deepEqual(clampCursor({ x: 500, y: -3 }, 120, 100), { x: 119, y: 0 });
    assert.deepEqual(clampCursor({ x: 5, y: 5 }, 120, 100), { x: 5, y: 5 });
    assert.throws(() => clampCursor({ x: 1.5, y: 0 }, 120, 100), RangeError);
    assert.throws(() => clampCursor(null, 120, 100), RangeError);
  });
});

describe("moving the cursor", () => {
  const map = { w: 120, h: 100 };
  const at = (x, y) => ({ x, y });
  const go = (state, k, jump = false) => move(state, k, map.w, map.h, jump);

  test("each arrow moves by one tile", () => {
    assert.deepEqual(go(at(10, 10), "ArrowLeft"), at(9, 10));
    assert.deepEqual(go(at(10, 10), "ArrowRight"), at(11, 10));
    assert.deepEqual(go(at(10, 10), "ArrowUp"), at(10, 9));
    assert.deepEqual(go(at(10, 10), "ArrowDown"), at(10, 11));
  });

  test("Maj with an arrow moves by CURSOR_JUMP tiles", () => {
    assert.equal(CURSOR_JUMP, 8);
    assert.deepEqual(go(at(20, 20), "ArrowRight", true), at(28, 20));
    assert.deepEqual(go(at(20, 20), "ArrowUp", true), at(20, 12));
  });

  test("the edges hold: no move leaves the map, with or without a jump", () => {
    assert.deepEqual(go(at(0, 0), "ArrowLeft"), at(0, 0));
    assert.deepEqual(go(at(0, 0), "ArrowUp", true), at(0, 0));
    assert.deepEqual(go(at(119, 99), "ArrowRight"), at(119, 99));
    assert.deepEqual(go(at(119, 99), "ArrowDown", true), at(119, 99));
    assert.deepEqual(go(at(3, 0), "ArrowLeft", true), at(0, 0), "a jump past the edge stops at it");
  });

  test("a key that is not an arrow leaves the cursor where it is", () => {
    assert.deepEqual(go(at(4, 4), "a"), at(4, 4));
    assert.deepEqual(go(at(4, 4), APPLY_KEY), at(4, 4));
  });

  test("the result is a new object, the input is not changed", () => {
    const state = at(4, 4);
    const moved = go(state, "ArrowDown");
    assert.notEqual(moved, state);
    assert.deepEqual(state, at(4, 4));
  });

  test("on a smaller map the cursor comes back inside, then moves from there", () => {
    assert.deepEqual(move(at(100, 90), "ArrowLeft", 20, 20), at(18, 19));
  });

  test("a walk of arrows never leaves the map", () => {
    let state = initialCursor(7, 5);
    const keys = ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"];
    for (let i = 0; i < 200; i++) {
      state = move(state, keys[(i * 7) % 4], 7, 5, i % 3 === 0);
      assert.ok(state.x >= 0 && state.x < 7 && state.y >= 0 && state.y < 5);
    }
  });
});

describe("which keys belong to the map", () => {
  test("the arrows and Entrée belong to the map", () => {
    assert.deepEqual([...MAP_KEYS].sort(), ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Enter"]);
    for (const k of MAP_KEYS) assert.equal(keyBelongsToMap(key(k)), true, k);
  });

  test("other keys do not belong to the map", () => {
    assert.equal(keyBelongsToMap(key("a")), false);
    assert.equal(keyBelongsToMap(key("Escape")), false);
    assert.equal(keyBelongsToMap(key(" ")), false);
  });

  test("Maj with an arrow still belongs to the map", () => {
    assert.equal(keyBelongsToMap(key("ArrowLeft", { shiftKey: true })), true);
  });

  test("Ctrl, Cmd or Alt with a key is not the map's", () => {
    assert.equal(keyBelongsToMap(key("ArrowLeft", { ctrlKey: true })), false);
    assert.equal(keyBelongsToMap(key("Enter", { metaKey: true })), false);
    assert.equal(keyBelongsToMap(key("ArrowUp", { altKey: true })), false);
  });

  test("a key typed in a field is never the map's", () => {
    for (const tagName of ["INPUT", "input", "SELECT", "TEXTAREA"]) {
      assert.equal(keyBelongsToMap(key("ArrowLeft", { target: { tagName } })), false, tagName);
    }
    assert.equal(keyBelongsToMap(key("Enter", { target: { tagName: "DIV", isContentEditable: true } })), false);
  });

  test("the canvas and other elements without a field keep the keys", () => {
    assert.equal(keyBelongsToMap(key("ArrowDown", { target: { tagName: "CANVAS" } })), true);
    assert.equal(keyBelongsToMap({ key: "ArrowDown" }), true, "an event without a target is the map's");
  });

  test("a missing event is not the map's", () => {
    assert.equal(keyBelongsToMap(undefined), false);
  });
});

describe("what is announced for a tile", () => {
  test("a tile with nothing to report says so", () => {
    assert.equal(describeTile(12, 40, []), "Tuile 12, 40 : rien à signaler");
  });

  test("the category of the tile, as the query tool names it, lowercased after the colon", () => {
    assert.equal(describeTile(12, 40, ["Route"]), "Tuile 12, 40 : route");
  });

  test("the fields follow the category, separated by commas", () => {
    assert.equal(
      describeTile(3, 4, ["Zone résidentielle", "Densité : faible", "Pollution : aucune"]),
      "Tuile 3, 4 : zone résidentielle, Densité : faible, Pollution : aucune",
    );
  });

  test("the text uses the lines of the query tool (formatZoneStatus) of a real query", () => {
    const lines = formatZoneStatus([8]); // a road, no field
    assert.equal(describeTile(12, 40, lines), "Tuile 12, 40 : route");
    assert.equal(describeTile(0, 0, formatZoneStatus([])), "Tuile 0, 0 : rien à signaler");
  });
});
