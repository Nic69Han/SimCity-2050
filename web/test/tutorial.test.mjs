// Tests of the guided first steps (web/tutorial-model.js) and of its record (saves.js createPrefs with
// the guide's key): each step's check on hand-made tile arrays, the order of the steps, no regression,
// and storage that fails. The page part (web/tutorial.js) is covered by web/e2e/tutorial.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  STEPS, POWER_BIT, POPULATION_GOAL, progress, tilesDigest, supportsTutorial, sanitizeRecord, zoneOf,
} from "../tutorial-model.js";
import { createPrefs } from "../saves.js";
import { MockCity } from "./mock-engine.mjs";

const W = 6; // width
const H = 5; // height (column-major: index x * H + y)
const RES = 240; // empty residential zone
const HOUSE = 249; // a house in a residential zone
const COM = 423; // empty commercial zone
const IND = 612; // empty industrial zone
const ROAD = 66; // road, north-south... (any road character works: roadMask > 0)
const WIRE = 208; // power line, east-west
const COAL = 745; // coal power plant
const NUCLEAR = 811; // nuclear power plant
const FIRE_STATION = 761; // a service, not a power plant
const DIRT = 0;

// Snapshot with the given tiles placed at [x, y, tile]; everything else is dirt.
function snap(placed = [], extra = {}) {
  const tiles = new Uint16Array(W * H);
  for (const [x, y, tile] of placed) tiles[x * H + y] = tile;
  return { tiles, width: W, height: H, population: 0, monthsElapsed: 0, ...extra };
}

const stepDone = (id) => STEPS.find((s) => s.id === id).done;

describe("the steps", () => {
  test("seven steps, in the order of the design, each with a French title and hint", () => {
    assert.equal(STEPS.length, 7);
    assert.deepEqual(STEPS.map((s) => s.id), ["zone", "road", "plant", "wire", "zones", "run", "population"]);
    assert.equal(new Set(STEPS.map((s) => s.id)).size, 7, "ids are unique");
    assert.equal(STEPS[0].title, "Posez une zone résidentielle");
    assert.equal(STEPS[1].title, "Reliez-la par une route");
    assert.equal(STEPS[2].title, "Construisez une centrale électrique");
    assert.equal(STEPS[3].title, "Raccordez la zone avec une ligne électrique");
    assert.equal(STEPS[4].title, "Ajoutez une zone commerciale et une zone industrielle");
    assert.equal(STEPS[5].title, "Lancez la simulation");
    assert.equal(STEPS[6].title, "Atteignez 500 habitants");
    for (const s of STEPS) {
      assert.ok(s.title.length > 0 && s.hint.length > 0, `${s.id} has a title and a hint`);
      assert.equal(typeof s.done, "function");
    }
    assert.equal(POPULATION_GOAL, 500);
  });

  test("step 1: a residential zone, empty or built, and nothing else", () => {
    const done = stepDone("zone");
    assert.equal(done(snap([[2, 2, RES]])), true);
    assert.equal(done(snap([[2, 2, 248]])), true, "any tile of the 3x3 empty zone");
    assert.equal(done(snap([[2, 2, HOUSE]])), true, "a house of a residential zone");
    assert.equal(done(snap([[2, 2, COM]])), false, "a commercial zone is not residential");
    assert.equal(done(snap([[2, 2, ROAD], [3, 2, WIRE]])), false);
    assert.equal(done(snap()), false, "an empty city");
  });

  test("step 2: a road touches a residential zone on one of its four sides", () => {
    const done = stepDone("road");
    assert.equal(done(snap([[1, 2, ROAD], [2, 2, RES]])), true, "road west of the zone");
    assert.equal(done(snap([[3, 2, ROAD], [2, 2, RES]])), true, "road east of the zone");
    assert.equal(done(snap([[2, 1, ROAD], [2, 2, RES]])), true, "road north of the zone");
    assert.equal(done(snap([[2, 3, ROAD], [2, 2, RES]])), true, "road south of the zone");
    assert.equal(done(snap([[1, 1, ROAD], [2, 2, RES]])), false, "a diagonal road does not touch");
    assert.equal(done(snap([[0, 0, ROAD], [1, 0, RES]])), true, "map edge, column 0");
    assert.equal(done(snap([[5, 4, ROAD], [5, 3, RES]])), true, "map edge, last row and column");
    assert.equal(done(snap([[0, 4, ROAD], [3, 1, RES]])), false, "a road far from the zone");
    assert.equal(done(snap([[1, 2, ROAD], [2, 2, COM]])), false, "a road by a commercial zone only");
    assert.equal(done(snap([[1, 2, WIRE], [2, 2, RES]])), false, "a power line is not a road");
  });

  test("step 3: a power plant (coal or nuclear), not any other building", () => {
    const done = stepDone("plant");
    assert.equal(done(snap([[1, 1, COAL]])), true);
    assert.equal(done(snap([[1, 1, NUCLEAR]])), true);
    assert.equal(done(snap([[1, 1, FIRE_STATION]])), false);
    assert.equal(done(snap([[1, 1, RES]])), false);
  });

  test("step 4: a power line exists and a residential zone has power (the status bit)", () => {
    const done = stepDone("wire");
    assert.equal(done(snap([[1, 1, WIRE], [2, 1, RES | POWER_BIT]])), true);
    assert.equal(done(snap([[1, 1, WIRE], [2, 1, RES]])), false, "a zone without power");
    assert.equal(done(snap([[2, 1, RES | POWER_BIT]])), false, "power but no power line");
    assert.equal(done(snap([[1, 1, WIRE], [2, 1, COM | POWER_BIT]])), false, "only a residential zone counts");
    assert.equal(done(snap([[1, 1, WIRE], [2, 1, COAL | POWER_BIT]])), false);
  });

  test("step 5: a commercial zone and an industrial zone, both", () => {
    const done = stepDone("zones");
    assert.equal(done(snap([[1, 1, COM]])), false);
    assert.equal(done(snap([[1, 1, IND]])), false);
    assert.equal(done(snap([[1, 1, COM], [4, 3, IND]])), true);
    assert.equal(done(snap([[1, 1, RES], [4, 3, IND]])), false);
  });

  test("step 6: the game time has advanced at least one month since the guide started", () => {
    const done = stepDone("run");
    assert.equal(done(snap([], { monthsElapsed: 0 })), false);
    assert.equal(done(snap([], { monthsElapsed: 1 })), true);
  });

  test("step 7: the population reaches the goal", () => {
    const done = stepDone("population");
    assert.equal(done(snap([], { population: POPULATION_GOAL - 1 })), false);
    assert.equal(done(snap([], { population: POPULATION_GOAL })), true);
  });

  test("zoneOf: the zone of an empty or built tile, null for the rest", () => {
    assert.equal(zoneOf(RES), "residential");
    assert.equal(zoneOf(HOUSE), "residential");
    assert.equal(zoneOf(COM), "commercial");
    assert.equal(zoneOf(IND), "industrial");
    assert.equal(zoneOf(ROAD), null);
    assert.equal(zoneOf(COAL), null);
    assert.equal(zoneOf(DIRT), null);
  });
});

describe("progress", () => {
  test("an empty city is at the first step", () => {
    assert.equal(progress(snap(), 0), 0);
  });

  test("steps complete in order: a later step done early does not count", () => {
    // commercial and industrial zones exist (step 5) but no road, no plant: still at step 2
    const s = snap([[1, 1, RES], [4, 3, COM], [4, 1, IND]], { population: 900, monthsElapsed: 4 });
    assert.equal(progress(s, 0), 1);
  });

  test("a city that satisfies every step is at the end", () => {
    const s = snap([
      [1, 2, ROAD], [2, 2, RES | POWER_BIT], [3, 0, WIRE], [5, 0, COAL], [4, 3, COM], [4, 4, IND],
    ], { population: 500, monthsElapsed: 1 });
    assert.equal(progress(s, 0), STEPS.length);
  });

  test("advances from the previous index while the steps there are done", () => {
    const zone = snap([[1, 1, RES]]);
    assert.equal(progress(zone, 0), 1);
    assert.equal(progress(zone, 1), 1);
  });

  test("never goes backwards: a bulldozed zone does not move the guide back", () => {
    assert.equal(progress(snap(), 2), 2);
    assert.equal(progress(snap(), 5), 5);
  });

  test("a previous index is kept even when the steps before it are not done", () => {
    assert.equal(progress(snap([[2, 2, COM]]), 3), 3);
  });

  test("an invalid previous index counts as 0; too large is the end", () => {
    assert.equal(progress(snap(), -1), 0);
    assert.equal(progress(snap(), 1.5), 0);
    assert.equal(progress(snap(), "2"), 0);
    assert.equal(progress(snap(), undefined), 0);
    assert.equal(progress(snap(), 99), STEPS.length);
  });

  test("the mock engine: a residential zone placed with the tool is step 1", () => {
    const city = new MockCity(1);
    let id = -1;
    for (let i = 0; i < city.tool_count(); i++) if (city.tool_key(i) === "residential") id = city.tool_info(i)[0];
    assert.ok(id >= 0, "the mock has the residential tool");
    const before = progress({ tiles: city.tiles(), width: city.width(), height: city.height(), population: 0, monthsElapsed: 0 }, 0);
    assert.equal(before, 0);
    // the first origin where the mock says the zone can be placed (its map has rubble here and there)
    let origin = null;
    for (let x = 0; x < city.width() && !origin; x++) {
      for (let y = 0; y < city.height() && !origin; y++) if (city.tool_preview(id, x, y)[0] === 1) origin = { x, y };
    }
    assert.ok(origin, "a place to build");
    assert.equal(city.tool_down(id, origin.x, origin.y), 1);
    const after = progress({ tiles: city.tiles(), width: city.width(), height: city.height(), population: 0, monthsElapsed: 0 }, 0);
    assert.equal(after, 1, "the zone is done, the road is next");
  });
});

describe("the digest of the tiles", () => {
  test("equal arrays give equal digests; a changed tile changes it", () => {
    const a = snap([[1, 1, RES]]).tiles;
    const b = snap([[1, 1, RES]]).tiles;
    assert.equal(tilesDigest(a), tilesDigest(b));
    assert.notEqual(tilesDigest(a), tilesDigest(snap([[1, 1, ROAD]]).tiles));
    assert.notEqual(tilesDigest(a), tilesDigest(snap([[1, 1, RES | POWER_BIT]]).tiles), "the status bits count");
    assert.equal(tilesDigest(new Uint16Array(0)), tilesDigest([]));
  });

  test("a plain array and a typed array with the same words give the same digest", () => {
    assert.equal(tilesDigest([0, 240, 66]), tilesDigest(new Uint16Array([0, 240, 66])));
  });
});

describe("the engine check", () => {
  test("the page needs the methods the guide reads", () => {
    assert.equal(supportsTutorial(new MockCity(1)), true);
    assert.equal(supportsTutorial({}), false);
    assert.equal(supportsTutorial(null), false);
    const city = new MockCity(1);
    assert.equal(supportsTutorial({ ...city, tiles: undefined }), false, "no tiles(): no guide");
  });
});

describe("the record kept per browser", () => {
  test("missing or malformed values give the defaults", () => {
    assert.deepEqual(sanitizeRecord(undefined), { dismissed: false, reached: 0 });
    assert.deepEqual(sanitizeRecord(null), { dismissed: false, reached: 0 });
    assert.deepEqual(sanitizeRecord({ dismissed: "yes", reached: "3" }), { dismissed: false, reached: 0 });
    assert.deepEqual(sanitizeRecord({ dismissed: 1, reached: 2.5 }), { dismissed: false, reached: 0 });
  });

  test("valid values are kept; the step count is clamped", () => {
    assert.deepEqual(sanitizeRecord({ dismissed: true, reached: 3 }), { dismissed: true, reached: 3 });
    assert.deepEqual(sanitizeRecord({ reached: 99 }), { dismissed: false, reached: STEPS.length });
    assert.deepEqual(sanitizeRecord({ reached: -2 }), { dismissed: false, reached: 0 });
  });

  test("a working store keeps the record from one page to the next", () => {
    const data = new Map();
    const fake = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    const prefs = createPrefs(fake, "micropolis.tutorial");
    assert.equal(prefs.write({ dismissed: true, reached: 4 }), true);
    assert.deepEqual(sanitizeRecord(createPrefs(fake, "micropolis.tutorial").read()), { dismissed: true, reached: 4 });
  });

  test("a store that throws is not an error: the defaults, and the write says it was not kept", () => {
    const broken = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
    };
    const prefs = createPrefs(broken, "micropolis.tutorial");
    assert.deepEqual(sanitizeRecord(prefs.read()), { dismissed: false, reached: 0 });
    assert.equal(prefs.write({ dismissed: true }), false);
  });

  test("no store at all (private window without localStorage): the defaults, and no error", () => {
    const prefs = createPrefs(null, "micropolis.tutorial");
    assert.deepEqual(sanitizeRecord(prefs.read()), { dismissed: false, reached: 0 });
    assert.doesNotThrow(() => prefs.write({ reached: 1 }));
  });

  test("a stored value that is not JSON is ignored", () => {
    const fake = { getItem: () => "{not json", setItem() {} };
    assert.deepEqual(sanitizeRecord(createPrefs(fake, "micropolis.tutorial").read()), { dismissed: false, reached: 0 });
  });
});
