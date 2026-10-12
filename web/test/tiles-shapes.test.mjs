// Road, rail, wire and shore shapes of the tile art. The masks are the engine's own connection
// masks (connect.rs: N = 1, E = 2, S = 4, W = 8): the shape of a tile is the set of its arms.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { roadMask, railMask, wireMask, shoreLandSides, N, E, S, W } from "../tiles.js";

// connect.rs ROAD_TABLE / RAIL_TABLE / WIRE_TABLE, indexed by the neighbour bits. The shape of
// a tile is the last index that gives it: the same rule the table cross-check below uses.
const ROAD_TABLE = [66, 67, 66, 68, 67, 67, 69, 73, 66, 71, 66, 72, 70, 75, 74, 76];
const RAIL_TABLE = [226, 227, 226, 228, 227, 227, 229, 233, 226, 231, 226, 232, 230, 235, 234, 236];
const WIRE_TABLE = [210, 211, 210, 212, 211, 211, 213, 217, 210, 215, 210, 216, 214, 219, 218, 220];

function lastIndexOf(table, tile) {
  let found = -1;
  table.forEach((t, i) => { if (t === tile) found = i; });
  return found;
}

describe("road, rail and wire shapes", () => {
  test("every connection set of the engine table has the road shape of its tile", () => {
    for (let bits = 0; bits < 16; bits++) {
      const tile = ROAD_TABLE[bits];
      const i = lastIndexOf(ROAD_TABLE, tile);
      assert.equal(roadMask(tile), i, `road ${tile} (table index ${i})`);
    }
  });

  test("rails and wires follow the same table", () => {
    for (let bits = 0; bits < 16; bits++) {
      const rail = RAIL_TABLE[bits];
      assert.equal(railMask(rail), lastIndexOf(RAIL_TABLE, rail), `rail ${rail}`);
      const wire = WIRE_TABLE[bits];
      assert.equal(wireMask(wire), lastIndexOf(WIRE_TABLE, wire), `wire ${wire}`);
    }
  });

  test("straight roads, corners, T junctions and the crossing", () => {
    assert.equal(roadMask(66), E | W, "ROADS is horizontal");
    assert.equal(roadMask(67), N | S, "ROADS2 is vertical");
    assert.equal(roadMask(68), N | E, "ROADS3 is a north-east corner");
    assert.equal(roadMask(76), N | E | S | W, "the intersection");
    assert.equal(roadMask(73), N | E | S, "a T");
  });

  test("traffic tiles show the shape of the road they replace", () => {
    // from the sample cities: 84 is a north-east corner (ROADS3 = 68), 89 a north-east-south T
    assert.equal(roadMask(84), roadMask(68));
    assert.equal(roadMask(85), roadMask(69));
    assert.equal(roadMask(89), roadMask(73));
    assert.equal(roadMask(92), roadMask(76));
    assert.equal(roadMask(146), roadMask(66), "heavy traffic, horizontal");
    assert.equal(roadMask(147), roadMask(67), "heavy traffic, vertical");
    assert.equal(roadMask(156), roadMask(76), "heavy traffic, crossing");
  });

  test("road on power and road on rail carry the road in their name", () => {
    assert.equal(roadMask(77), E | W);
    assert.equal(roadMask(78), N | S);
    assert.equal(wireMask(77), E | W, "the wire of road on power");
    assert.equal(roadMask(237), E | W, "road on rail, horizontal");
    assert.equal(railMask(237), E | W);
    assert.equal(railMask(238), N | S);
  });

  test("bridges carry a road over water (their deck is not a connection mask)", () => {
    assert.equal(roadMask(64), E | W);
    assert.equal(roadMask(65), N | S);
  });

  test("a tile without road has no road mask", () => {
    assert.equal(roadMask(0), 0);
    assert.equal(roadMask(240), 0);
    assert.equal(railMask(66), 0);
  });
});

describe("shore shapes (tiles 5..20, from the sample cities)", () => {
  test("the land sides of each shore pair", () => {
    // 5/6: land to the north; 7/8: north and east; 9/10: east; 11/12: east and south
    // 13/14: south; 15/16: south and west; 17/18: west; 19/20: west and north
    assert.equal(shoreLandSides(5), N);
    assert.equal(shoreLandSides(6), N);
    assert.equal(shoreLandSides(7), N | E);
    assert.equal(shoreLandSides(9), E);
    assert.equal(shoreLandSides(11), E | S);
    assert.equal(shoreLandSides(13), S);
    assert.equal(shoreLandSides(15), S | W);
    assert.equal(shoreLandSides(17), W);
    assert.equal(shoreLandSides(19), W | N);
    assert.equal(shoreLandSides(20), W | N);
  });
});
