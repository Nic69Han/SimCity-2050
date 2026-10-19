// The 2D vehicles layer (web/map-layer-vehicles.js) and its pure model (map-layer-vehicles-model.js),
// against a fake engine: the real contract is the engine's, this checks what the page does with it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  decodeVehicles, vehicleRect, loadColor, kindColor, lengthFactor, LOAD_TINT_MIN, LOAD_JAM, MAX_DRAWN,
  TINT_COLORS, KIND_COLORS, UNKNOWN_KIND_COLOR, BASE_LENGTH, LENGTH_FACTOR, METRO_KIND, shownIn2D,
} from "../map-layer-vehicles-model.js";
import { VEHICLES_LAYER } from "../map-layer-vehicles.js";
import { MAP_LAYERS } from "../map-layers.js";
import { setPlanShown, setMetroToolActive } from "../transit-model.js";

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

// A fake engine: a w x h map, a traffic load per tile (engine tile order, x * h + y), and a list of vehicle records.
class FakeTraffic {
  constructor({ w = 4, h = 3, rules = true, load = null, records = [] } = {}) {
    this.w = w;
    this.h = h;
    this.rules = rules;
    this.load = load ?? new Uint8Array(w * h);
    this.records = records;
    this.askedMax = [];
  }
  width() { return this.w; }
  height() { return this.h; }
  agent_rules() { return this.rules; }
  vehicles(max) {
    this.askedMax.push(max);
    return Int32Array.from(this.records.flat()).subarray(0, max * 5);
  }
  traffic_load() { return this.load; }
}

describe("decoding the vehicle records", () => {
  test("reads [id, kind, x16, y16, direction] into tiles", () => {
    const out = decodeVehicles(Int32Array.of(7, 1, 16, 40, 2, 9, 0, 0, 8, 3));
    assert.deepEqual(out, [
      { id: 7, kind: 1, x: 1, y: 2.5, dir: 2 },
      { id: 9, kind: 0, x: 0, y: 0.5, dir: 3 },
    ]);
  });

  test("a trailing incomplete record is ignored", () => {
    assert.equal(decodeVehicles(Int32Array.of(1, 0, 16, 16, 1, 2, 0, 0)).length, 1);
    assert.deepEqual(decodeVehicles(Int32Array.of(1, 0, 16, 16)), []);
  });

  test("an empty, missing or non-array input gives no vehicle", () => {
    assert.deepEqual(decodeVehicles(new Int32Array(0)), []);
    assert.deepEqual(decodeVehicles(undefined), []);
    assert.deepEqual(decodeVehicles(null), []);
    assert.deepEqual(decodeVehicles(42), []);
  });
});

describe("the rectangle of a vehicle", () => {
  test("north and south are tall, east and west are wide, centred on the position", () => {
    const at = (dir) => vehicleRect({ id: 0, kind: 0, x: 2, y: 3, dir }, 12);
    // scale 12: short side 4 px, long side 8 px; centre (24, 36)
    assert.deepEqual(at(0), [22, 32, 4, 8]);
    assert.deepEqual(at(2), [22, 32, 4, 8]);
    assert.deepEqual(at(1), [20, 34, 8, 4]);
    assert.deepEqual(at(3), [20, 34, 8, 4]);
  });

  test("the short side is at least 1 px on a small scale", () => {
    const [, , w, h] = vehicleRect({ x: 0, y: 0, dir: 1 }, 2);
    assert.equal(Math.min(w, h), 1);
    assert.equal(Math.max(w, h), 2);
  });

  test("the length depends on the kind: bus x2.2, train and metro x2.6, car and taxi as before", () => {
    assert.equal(BASE_LENGTH, 2);
    assert.deepEqual({ ...LENGTH_FACTOR }, { 0: 1, 1: 2.2, 2: 1, 3: 2.6, 4: 2.6 });
    assert.equal(Object.isFrozen(LENGTH_FACTOR), true);
    const longSide = (kind, dir) => {
      const [, , w, h] = vehicleRect({ kind, x: 2, y: 3, dir }, 12); // short side 4 px
      return dir === 1 || dir === 3 ? w : h;
    };
    assert.equal(longSide(0, 0), 8, "car: 2 short sides, as before");
    assert.equal(longSide(2, 2), 8, "taxi: as a car");
    assert.ok(Math.abs(longSide(1, 0) - 17.6) < 1e-9, "bus: 8 x 2.2");
    assert.ok(Math.abs(longSide(3, 1) - 20.8) < 1e-9, "train: 8 x 2.6");
    assert.ok(Math.abs(longSide(4, 3) - 20.8) < 1e-9, "metro: 8 x 2.6");
  });

  test("the width stays the short side for every kind, and the box stays centred", () => {
    for (const kind of [0, 1, 2, 3, 4]) {
      const [x, y, w, h] = vehicleRect({ kind, x: 2, y: 3, dir: 1 }, 12);
      assert.equal(h, 4, `kind ${kind}: short side`);
      assert.ok(Math.abs(x + w / 2 - 24) < 1e-9, `kind ${kind}: centred on x`);
      assert.equal(y + h / 2, 36, `kind ${kind}: centred on y`);
    }
  });

  test("a kind outside the table, or no kind, has the base length", () => {
    assert.equal(lengthFactor(0), 1);
    assert.equal(lengthFactor(1), 2.2);
    assert.equal(lengthFactor(7), 1);
    assert.equal(lengthFactor(-1), 1);
    assert.equal(lengthFactor(undefined), 1);
    assert.equal(lengthFactor("toString"), 1);
    const [, , w, h] = vehicleRect({ x: 0, y: 0, dir: 0 }, 12);
    assert.equal(h, 8);
    assert.equal(w, 4);
  });
});

describe("colours and thresholds", () => {
  test("no tint below the minimum load, orange from it, red above the jam", () => {
    assert.equal(LOAD_TINT_MIN, 128);
    assert.equal(LOAD_JAM, 200);
    assert.equal(loadColor(0), null);
    assert.equal(loadColor(LOAD_TINT_MIN - 1), null);
    assert.equal(loadColor(LOAD_TINT_MIN), TINT_COLORS.busy);
    assert.equal(loadColor(LOAD_JAM), TINT_COLORS.busy);
    assert.equal(loadColor(LOAD_JAM + 1), TINT_COLORS.jam);
    assert.equal(loadColor(255), TINT_COLORS.jam);
    assert.equal(loadColor(undefined), null);
    assert.notEqual(TINT_COLORS.busy, TINT_COLORS.jam);
  });

  test("each kind has its colour, an unknown kind is grey", () => {
    for (const kind of [0, 1, 2, 3, 4]) assert.equal(kindColor(kind), KIND_COLORS[kind]);
    assert.equal(new Set([0, 1, 2, 3, 4].map(kindColor)).size, 5);
    assert.equal(kindColor(5), UNKNOWN_KIND_COLOR);
    assert.equal(kindColor(-1), UNKNOWN_KIND_COLOR);
    assert.equal(kindColor("toString"), UNKNOWN_KIND_COLOR);
    assert.equal(UNKNOWN_KIND_COLOR, "#9e9e9e");
  });
});

describe("the layer", () => {
  test("registered after the transit layer, with its name", () => {
    assert.equal(VEHICLES_LAYER.name, "vehicles");
    assert.equal(MAP_LAYERS.at(-1), VEHICLES_LAYER);
  });

  test("not visible for an engine without the API, or with the rule off", () => {
    assert.equal(VEHICLES_LAYER.visible({}), false);
    // an engine with the rule but without the vehicles and the traffic
    assert.equal(VEHICLES_LAYER.visible({ width: () => 4, height: () => 3, agent_rules: () => true }), false);
    assert.equal(VEHICLES_LAYER.visible(new FakeTraffic({ rules: false })), false);
    assert.equal(VEHICLES_LAYER.visible(new FakeTraffic({ rules: true })), true);
  });

  test("draws the tint of the busy tiles, then the vehicles, inside save and restore", () => {
    // 4 x 3 map, index x * 3 + y: tile (1, 0) busy, tile (2, 2) in a jam; scale 12 (short side 4 px)
    const load = new Uint8Array(12);
    load[1 * 3 + 0] = LOAD_TINT_MIN;
    load[2 * 3 + 2] = 255;
    const city = new FakeTraffic({
      load,
      records: [[5, 2, 32, 16, 1]], // a taxi at (2, 1), heading east: 8 px wide, 4 px tall
    });
    const { ctx, log } = recorder();
    VEHICLES_LAYER.draw(ctx, city, 12);
    assert.deepEqual(log, [
      ["save"],
      ["rect", 12, 0, 12, 12, TINT_COLORS.busy],
      ["rect", 24, 24, 12, 12, TINT_COLORS.jam],
      ["rect", 20, 10, 8, 4, KIND_COLORS[2]],
      ["restore"],
    ]);
  });

  test("a bus is drawn longer than a taxi, in its own colour", () => {
    const city = new FakeTraffic({ records: [[5, 1, 32, 16, 1]] }); // a bus at (2, 1), heading east
    const { ctx, log } = recorder();
    VEHICLES_LAYER.draw(ctx, city, 12);
    const [, x, y, w, h, color] = log.find((e) => e[0] === "rect");
    assert.ok(Math.abs(w - 17.6) < 1e-9, "17.6 px long");
    assert.equal(h, 4);
    assert.ok(Math.abs(x - (24 - 8.8)) < 1e-9);
    assert.equal(y, 10);
    assert.equal(color, KIND_COLORS[1]);
  });

  test("draws nothing but the frame for an empty map and no vehicle", () => {
    const { ctx, log } = recorder();
    VEHICLES_LAYER.draw(ctx, new FakeTraffic(), 8);
    assert.deepEqual(log, [["save"], ["restore"]]);
  });

  test("reads at most MAX_DRAWN vehicles from the engine", () => {
    assert.equal(MAX_DRAWN, 2000);
    const city = new FakeTraffic();
    VEHICLES_LAYER.draw(recorder().ctx, city, 8);
    assert.deepEqual(city.askedMax, [MAX_DRAWN]);
  });

  test("the vehicles drawn stop at MAX_DRAWN even when the engine sends more", () => {
    const records = Array.from({ length: MAX_DRAWN + 50 }, (_, i) => [i, 0, 16, 16, 0]);
    const city = new FakeTraffic({ w: 2, h: 2, records });
    const { ctx, log } = recorder();
    VEHICLES_LAYER.draw(ctx, city, 8);
    const rects = log.filter((e) => e[0] === "rect");
    assert.equal(rects.length, MAX_DRAWN);
  });
});

describe("the 2D rule for metro rames", () => {
  test("a rame (kind 4) is drawn only when metroOn is true; every other kind is always drawn", () => {
    assert.equal(METRO_KIND, 4);
    assert.equal(shownIn2D(4, true), true);
    assert.equal(shownIn2D(4, false), false);
    for (const metroOn of [false, true]) {
      for (const kind of [0, 1, 2, 3, 99]) assert.equal(shownIn2D(kind, metroOn), true, `kind ${kind}`);
    }
  });

  test("metroOn must be the boolean true: any other value hides a rame", () => {
    for (const metroOn of [undefined, null, 1, "yes", {}]) assert.equal(shownIn2D(4, metroOn), false, String(metroOn));
  });

  test("the layer hides a rame unless the metro plan or a metro tool is shown; a train is always drawn", () => {
    const records = [[1, 3, 32, 16, 1], [2, 4, 64, 16, 1]]; // a train and a rame, both at tile row 1
    const colours = () => {
      const { ctx, log } = recorder();
      VEHICLES_LAYER.draw(ctx, new FakeTraffic({ records }), 12);
      return log.filter((e) => e[0] === "rect").map((e) => e[5]);
    };
    try {
      setPlanShown(false);
      setMetroToolActive(false);
      assert.deepEqual(colours(), [KIND_COLORS[3]], "no plan, no tool: the train only");
      setPlanShown(true);
      assert.deepEqual(colours(), [KIND_COLORS[3], KIND_COLORS[4]], "plan shown: the rame too");
      setPlanShown(false);
      setMetroToolActive(true);
      assert.deepEqual(colours(), [KIND_COLORS[3], KIND_COLORS[4]], "metro tool active: the rame too");
    } finally {
      setPlanShown(false);
      setMetroToolActive(false);
    }
  });
});
