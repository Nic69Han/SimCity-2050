// Tests for the palette groups state (web/palette-groups-model.js): storage parse and serialise,
// open by default, reveal, toggling with the selected group kept open, and the group of a tool.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as m from "../palette-groups-model.js";

const IDS = ["reseaux", "zones", "terrain"];

describe("parseStored", () => {
  test("reads the known ids with a boolean value", () => {
    assert.deepEqual(m.parseStored('{"reseaux":false,"zones":true}', IDS), { reseaux: false, zones: true });
  });
  test("ignores unknown ids and values that are not booleans", () => {
    assert.deepEqual(m.parseStored('{"reseaux":"no","nope":false,"terrain":0}', IDS), {});
  });
  test("nothing stored, unreadable or not an object gives an empty state", () => {
    assert.deepEqual(m.parseStored(null, IDS), {});
    assert.deepEqual(m.parseStored(undefined, IDS), {});
    assert.deepEqual(m.parseStored("{not json", IDS), {});
    assert.deepEqual(m.parseStored("[false]", IDS), {});
    assert.deepEqual(m.parseStored("false", IDS), {});
    assert.deepEqual(m.parseStored("null", IDS), {});
  });
  test("a value longer than MAX_STORED_CHARS is not ours", () => {
    const big = `{"reseaux":false${" ".repeat(m.MAX_STORED_CHARS)}}`;
    assert.deepEqual(m.parseStored(big, IDS), {});
  });
  test("only MAX_GROUPS ids are read", () => {
    const many = Array.from({ length: m.MAX_GROUPS + 2 }, (_, i) => `g${i}`);
    const text = JSON.stringify(Object.fromEntries(many.map((id) => [id, false])));
    const state = m.parseStored(text, many);
    assert.equal(Object.keys(state).length, m.MAX_GROUPS);
    assert.equal(state[many[m.MAX_GROUPS]], undefined);
  });
});

describe("serialise", () => {
  test("writes the known ids only, as JSON", () => {
    assert.equal(m.serialise({ reseaux: false, extra: true }, IDS), '{"reseaux":false}');
  });
  test("round-trips through parseStored", () => {
    const state = { reseaux: false, zones: true, terrain: false };
    assert.deepEqual(m.parseStored(m.serialise(state, IDS), IDS), state);
  });
  test("an empty state is an empty object", () => {
    assert.equal(m.serialise({}, IDS), "{}");
  });
});

describe("isOpen and reveal", () => {
  test("every group is open when nothing is stored", () => {
    assert.equal(m.isOpen({}, "reseaux"), true);
  });
  test("a group stored as false is closed", () => {
    assert.equal(m.isOpen({ reseaux: false }, "reseaux"), false);
  });
  test("reveal opens a group and returns the same object when it is open already", () => {
    const closed = { reseaux: false };
    const open = m.reveal(closed, "reseaux");
    assert.equal(m.isOpen(open, "reseaux"), true);
    assert.equal(closed.reseaux, false, "the old state is not changed");
    assert.equal(m.reveal(open, "reseaux"), open);
  });
});

describe("toggle", () => {
  test("closes an open group and opens a closed one", () => {
    const closed = m.toggle({}, "zones", null);
    assert.equal(closed.zones, false);
    assert.equal(m.toggle(closed, "zones", null).zones, true);
  });
  test("the group of the selected tool does not close", () => {
    const state = {};
    assert.equal(m.toggle(state, "zones", "zones"), state);
    assert.equal(m.isOpen(m.toggle(state, "zones", "zones"), "zones"), true);
  });
  test("other groups toggle while a tool is selected", () => {
    assert.equal(m.toggle({}, "terrain", "zones").terrain, false);
  });
});

describe("findSelected", () => {
  test("the id of the group whose tool is selected", () => {
    const groups = [
      { id: "reseaux", selected: false },
      { id: "zones", selected: true },
    ];
    assert.equal(m.findSelected(groups), "zones");
  });
  test("null when no group holds the selected tool, or there are no groups", () => {
    assert.equal(m.findSelected([{ id: "zones", selected: false }]), null);
    assert.equal(m.findSelected([]), null);
  });
});

test("the storage key is named and the limits are positive", () => {
  assert.equal(typeof m.STORAGE_KEY, "string");
  assert.ok(m.STORAGE_KEY.length > 0);
  assert.ok(m.MAX_GROUPS > 0 && m.MAX_STORED_CHARS > 0);
});
