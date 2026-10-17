// Relief rules and terraforming, page side: the checkbox logic (web/relief.js), the terraforming
// catalog entries and their engine calls (web/tools.js), and the mock's terraform rules.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  supportsRelief, supportsTerraform, readRelief, setRelief, reliefBlockedReason, lineTiles, RELIEF_HELP,
} from "../relief.js";
import {
  RESULT, readCatalog, callsFor, groupCatalog, shortcutRows, TOOL_GROUPS,
} from "../tools.js";
import {
  catalog as reliefCatalog, label as reliefLabel, blockedReason as moduleBlockedReason,
} from "../tools-relief.js";
import { extraCatalog, extraBlockedReason } from "../extra-tools.js";
import { MockCity, MOCK_TOOLS, TERRAFORM_COST, CASCADE_DEPTH, ALT_MAX, START_FUNDS } from "./mock-engine.mjs";

// An engine with the relief methods that holds the flag where it likes (a file may carry it on).
function engineWithFlag(flag, { accept = true } = {}) {
  let on = flag;
  return {
    relief_rules: () => on,
    set_relief_rules(v) {
      if (accept) on = v;
    },
  };
}

describe("feature detection", () => {
  test("the flag needs both methods", () => {
    assert.equal(supportsRelief(new MockCity(1)), true);
    assert.equal(supportsRelief(engineWithFlag(false)), true);
    assert.equal(supportsRelief({ relief_rules: () => false }), false);
    assert.equal(supportsRelief({ set_relief_rules() {} }), false);
    assert.equal(supportsRelief(null), false);
  });

  test("the terraforming tools need terraform and terraform_preview", () => {
    assert.equal(supportsTerraform(new MockCity(1)), true);
    assert.equal(supportsTerraform({ terraform() {} }), false);
    assert.equal(supportsTerraform({ terraform_preview() {} }), false);
    assert.equal(supportsTerraform(undefined), false);
  });

  test("an engine without the relief methods reads as rules off", () => {
    assert.equal(readRelief({}), false);
    assert.equal(setRelief({}, true), false);
  });
});

describe("the checkbox reads the engine's flag", () => {
  test("it shows what the engine holds, even when the file turned the rules on", () => {
    assert.equal(readRelief(engineWithFlag(true)), true);
    assert.equal(readRelief(engineWithFlag(false)), false);
  });

  test("setRelief returns the engine's answer, not the value asked for", () => {
    assert.equal(setRelief(engineWithFlag(false), true), true);
    assert.equal(setRelief(engineWithFlag(true), false), false);
    assert.equal(setRelief(engineWithFlag(false, { accept: false }), true), false, "a refusing engine");
  });

  test("the values are booleans whatever the engine returns", () => {
    const city = { relief_rules: () => 1, set_relief_rules() {} };
    assert.equal(readRelief(city), true);
    assert.equal(setRelief(city, "yes"), true);
  });

  test("the mock is off by default, on after set_relief_rules, off again after a new city or a load", () => {
    const city = new MockCity(3);
    assert.equal(readRelief(city), false);
    assert.equal(setRelief(city, true), true);
    city.new_random_city(4);
    assert.equal(readRelief(city), false, "a new city starts with the rules off");
    setRelief(city, true);
    city.load_cty(new Uint8Array(0));
    assert.equal(readRelief(city), false, "a loaded city reads its own flag");
  });

  test("the help text is French and names the three effects", () => {
    assert.match(RELIEF_HELP, /pente coûte du terrassement/u);
    assert.match(RELIEF_HELP, /routes en pente coûtent plus cher/u);
    assert.match(RELIEF_HELP, /relever et abaisser le terrain/u);
  });
});

describe("why the terraforming tools are blocked", () => {
  test("rules off: the reason names the checkbox, in 2D or 3D", () => {
    for (const in3d of [false, true]) {
      assert.match(reliefBlockedReason({ rules: false, in3d }), /Règles de relief/u);
    }
  });

  test("rules on in 2D: the reason says the view must be 3D", () => {
    assert.match(reliefBlockedReason({ rules: true, in3d: false }), /vue 3D/u);
  });

  test("rules on in 3D: allowed (empty reason)", () => {
    assert.equal(reliefBlockedReason({ rules: true, in3d: true }), "");
  });
});

describe("drag line", () => {
  test("a drag terraforms every tile it crosses, start excluded, end included", () => {
    assert.deepEqual(lineTiles(2, 2, 5, 2), [{ x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }]);
    assert.deepEqual(lineTiles(5, 2, 2, 2), [{ x: 4, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 2 }]);
    assert.deepEqual(lineTiles(1, 1, 1, 4), [{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 1, y: 4 }]);
  });

  test("a diagonal crosses one tile per step and never skips a tile", () => {
    const line = lineTiles(0, 0, 3, 3);
    assert.equal(line.length, 3);
    assert.deepEqual(line.at(-1), { x: 3, y: 3 });
    const wide = lineTiles(0, 0, 6, 2);
    assert.equal(wide.at(-1).x, 6);
    for (let i = 1; i < wide.length; i++) {
      assert.ok(Math.abs(wide[i].x - wide[i - 1].x) <= 1 && Math.abs(wide[i].y - wide[i - 1].y) <= 1);
    }
  });

  test("the same tile: nothing to do", () => {
    assert.deepEqual(lineTiles(4, 4, 4, 4), []);
  });
});

describe("terraforming catalog entries", () => {
  test("no entries when the engine has no terraforming", () => {
    assert.deepEqual(reliefCatalog({}), []);
    assert.deepEqual(reliefCatalog(new MockCity(1)).map((t) => t.key), ["relever", "abaisser"]);
  });

  test("two entries in the Terrain group, with French labels and the keys U and D", () => {
    const [up, down] = reliefCatalog(new MockCity(1));
    assert.deepEqual(
      { id: up.id, key: up.key, label: up.label, kind: up.kind, delta: up.delta, shortcut: up.shortcut, group: up.group },
      { id: "relief:1", key: "relever", label: "Relever", kind: "relief", delta: 1, shortcut: "u", group: "terrain" },
    );
    assert.deepEqual(
      { id: down.id, label: down.label, delta: down.delta, shortcut: down.shortcut },
      { id: "relief:-1", label: "Abaisser", delta: -1, shortcut: "d" },
    );
    assert.equal(up.group, "terrain");
    assert.ok(TOOL_GROUPS.some((g) => g.id === "terrain"), "the group of the entries exists");
    const terrain = groupCatalog([...readCatalog(new MockCity(1)), ...reliefCatalog(new MockCity(1))])
      .find((g) => g.id === "terrain");
    assert.deepEqual(terrain.tools.map((t) => t.key).slice(-2), ["relever", "abaisser"]);
    assert.equal(terrain.label, "Terrain");
  });

  test("the shortcuts do not clash with any other shortcut, and they reach the help", () => {
    const catalog = [...readCatalog(new MockCity(1)), ...reliefCatalog(new MockCity(1))];
    const letters = catalog.map((t) => t.shortcut).filter(Boolean);
    assert.equal(new Set(letters).size, letters.length, "one shortcut per key");
    assert.deepEqual(reliefCatalog(new MockCity(1)).map((t) => t.shortcut), ["u", "d"]);
    const rows = shortcutRows(catalog);
    assert.ok(rows.some((r) => r.key === "U" && r.label === "Relever"));
    assert.ok(rows.some((r) => r.key === "D" && r.label === "Abaisser"));
  });

  test("the hover label is the engine's cost when allowed, a dash otherwise", () => {
    assert.equal(reliefLabel(Int32Array.of(RESULT.OK, 30)), "30 $");
    assert.equal(reliefLabel(Int32Array.of(RESULT.OK, 0)), "gratuit");
    assert.equal(reliefLabel(Int32Array.of(RESULT.NO_MONEY, 40)), "—");
    assert.equal(reliefLabel(Int32Array.of(RESULT.FAILED, 0)), "—");
  });
});

describe("the relief module through the registry", () => {
  test("the registry lists the relief entries first, the empty modules add none", () => {
    const city = new MockCity(1);
    assert.deepEqual(extraCatalog(city), reliefCatalog(city));
    assert.deepEqual(extraCatalog({}), []);
  });

  test("blocked: rules off, then flat map, then free; the engine tools are never blocked", () => {
    const city = new MockCity(1);
    const [up] = reliefCatalog(city);
    const rulesOff = "Activez « Règles de relief » pour relever ou abaisser le terrain";
    const flat = "Relever et abaisser se font en vue 3D : l'altitude ne se voit qu'en 3D";
    assert.equal(extraBlockedReason(up, city, { in3d: true, flags: {} }), rulesOff);
    assert.equal(extraBlockedReason(up, city, { in3d: false, flags: { relief: false } }), rulesOff);
    assert.equal(extraBlockedReason(up, city, { in3d: false, flags: { relief: true } }), flat);
    assert.equal(extraBlockedReason(up, city, { in3d: true, flags: { relief: true } }), "");
    assert.equal(moduleBlockedReason(city, { in3d: true, flags: { relief: true } }), "");
    assert.equal(extraBlockedReason({ id: 3 }, city, { in3d: false, flags: {} }), "");
  });

  test("the entries carry the texts the palette shows", () => {
    const [up] = reliefCatalog(new MockCity(1));
    assert.equal(up.costText, "selon pente");
    assert.equal(up.idleHint, "coût affiché au survol");
  });
});

describe("engine calls of a catalog entry", () => {
  // A recorder with the engine's methods: each call is logged, results come from `answer`.
  function recorder(answer = () => RESULT.OK) {
    const log = [];
    const engine = {
      tool_footprint: (...a) => (log.push(["footprint", ...a]), Int32Array.of(0, 0, 3, 3)),
      tool_preview: (...a) => (log.push(["preview", ...a]), Int32Array.of(1, 10)),
      tool_down: (...a) => (log.push(["down", ...a]), answer(...a)),
      tool_drag: (...a) => (log.push(["drag", ...a]), 0),
      terraform: (...a) => (log.push(["terraform", ...a]), answer(...a)),
      terraform_preview: (...a) => (log.push(["terraform_preview", ...a]), Int32Array.of(1, 10)),
    };
    return { engine, log };
  }

  test("a building tool still goes to the tool_* methods, unchanged", () => {
    const { engine, log } = recorder();
    const entry = { id: 3, kind: undefined };
    const c = callsFor(engine, entry);
    c.footprint(4, 4);
    c.preview(4, 4);
    c.down(4, 4);
    c.drag(4, 4, 5, 4);
    assert.deepEqual(log, [
      ["footprint", 3, 4, 4], ["preview", 3, 4, 4], ["down", 3, 4, 4], ["drag", 3, 4, 4, 5, 4],
    ]);
  });

  test("a raise terraforms the tile with delta +1, previews with terraform_preview", () => {
    const { engine, log } = recorder();
    const [up] = reliefCatalog(engine);
    const c = callsFor(engine, up);
    assert.deepEqual([...c.footprint(4, 5)], [4, 5, 1, 1], "one tile");
    c.preview(4, 5);
    c.down(4, 5);
    assert.deepEqual(log, [["terraform_preview", 4, 5, 1], ["terraform", 4, 5, 1]]);
  });

  test("a lower terraforms with delta -1", () => {
    const { engine, log } = recorder();
    const [, down] = reliefCatalog(engine);
    callsFor(engine, down).down(2, 2);
    assert.deepEqual(log, [["terraform", 2, 2, -1]]);
  });

  test("a drag terraforms each tile it crosses, once, with the entry's delta", () => {
    const { engine, log } = recorder();
    const [, down] = reliefCatalog(engine);
    callsFor(engine, down).drag(2, 2, 4, 2);
    assert.deepEqual(log, [["terraform", 3, 2, -1], ["terraform", 4, 2, -1]]);
  });

  test("the result of a down is the ToolResult code of the engine", () => {
    const { engine } = recorder(() => RESULT.NO_MONEY);
    const [up] = reliefCatalog(engine);
    assert.equal(callsFor(engine, up).down(1, 1), RESULT.NO_MONEY);
  });
});

describe("the mock's terraforming rules", () => {
  // A city with the rules on and no rubble. The lake of the mock is at x 3..9, y 3..7.
  const city = (seed, size, extra = {}) => {
    const c = new MockCity(seed, { width: size, height: size, rubble: 0, ...extra });
    c.set_relief_rules(true);
    return c;
  };

  test("off: terraform returns 0 and costs nothing; the preview says 0 and 0", () => {
    const c = new MockCity(2, { width: 40, height: 40, rubble: 0 });
    const h0 = c.heights();
    assert.equal(c.terraform(20, 20, 1), RESULT.FAILED);
    assert.deepEqual([...c.terraform_preview(20, 20, 1)], [RESULT.FAILED, 0]);
    assert.deepEqual(c.heights(), h0);
    assert.equal(c.funds(), START_FUNDS);
  });

  test("on: a raise moves the tile by one step and charges 10 per tile moved, as the preview said", () => {
    const c = city(2, 40);
    const h0 = c.heights();
    const i = 20 * 40 + 20;
    const [result, cost] = c.terraform_preview(20, 20, 1);
    assert.equal(result, RESULT.OK);
    assert.equal(cost % TERRAFORM_COST, 0, "a multiple of the price per tile");
    assert.equal(c.terraform(20, 20, 1), RESULT.OK);
    assert.equal(c.heights()[i], h0[i] + 1);
    assert.equal(c.funds(), START_FUNDS - cost);
  });

  test("a preview changes nothing", () => {
    const c = city(2, 40);
    const h0 = c.heights();
    c.terraform_preview(20, 20, 1);
    c.terraform_preview(20, 20, -1);
    assert.deepEqual(c.heights(), h0);
    assert.equal(c.funds(), START_FUNDS);
  });

  test("the slope cascade: neighbours move one step, only within 3 tiles, and some do move", () => {
    // One raise makes a slope of 1 step only; several raises of the same tile make the neighbours
    // fall more than 2 steps behind, and they follow.
    const c = city(1, 40, { funds: 1e9 });
    let cascaded = false, spent = 0;
    const origin = { x: 20, y: 20 };
    for (let k = 0; k < 6; k++) {
      const before = c.heights();
      assert.equal(c.terraform(origin.x, origin.y, 1), RESULT.OK);
      const after = c.heights();
      let moved = 0;
      for (let x = 0; x < 40; x++) {
        for (let y = 0; y < 40; y++) {
          const i = x * 40 + y;
          const d = Math.abs(after[i] - before[i]);
          if (d === 0) continue;
          moved++;
          assert.equal(d, 1, `tile (${x}, ${y}) moved by one step`);
          const dist = Math.abs(x - origin.x) + Math.abs(y - origin.y);
          assert.ok(dist <= CASCADE_DEPTH, `tile (${x}, ${y}) is ${dist} steps away`);
        }
      }
      spent += TERRAFORM_COST * moved;
      assert.equal(c.funds(), 1e9 - spent, "10 dollars per tile moved");
      if (moved > 1) cascaded = true;
    }
    assert.ok(cascaded, "the cascade reaches a neighbour");
  });

  test("water is refused and costs nothing", () => {
    const c = city(5, 40);
    assert.equal(c.terraform(4, 4, 1), RESULT.FAILED, "a lake tile");
    assert.deepEqual([...c.terraform_preview(4, 4, -1)], [RESULT.FAILED, 0]);
  });

  test("a building needs a bulldozer first (NeedBulldoze); dirt next to it is fine", () => {
    const c = city(6, 40);
    c.tool_down(MOCK_TOOLS.findIndex((t) => t.key === "residential"), 20, 20);
    assert.equal(c.terraform(20, 20, 1), RESULT.NEED_BULLDOZE);
    assert.equal(c.terraform(30, 30, 1), RESULT.OK);
  });

  test("the altitude limit: a tile at 63 cannot be raised, a tile at 0 cannot be lowered", () => {
    const c = city(7, 40, { funds: 1e9 });
    let last = RESULT.OK;
    for (let k = 0; k < 400 && last === RESULT.OK; k++) last = c.terraform(20, 20, 1);
    assert.equal(last, RESULT.FAILED);
    assert.equal(c.heights()[20 * 40 + 20], ALT_MAX);
    assert.equal(c.terraform(20, 20, 1), RESULT.FAILED, "still refused at the top");
    let low = RESULT.OK;
    for (let k = 0; k < 400 && low === RESULT.OK; k++) low = c.terraform(25, 25, -1);
    assert.equal(low, RESULT.FAILED);
    assert.equal(c.heights()[25 * 40 + 25], 0);
  });

  test("funds below the cost: NoMoney and nothing moves", () => {
    const c = city(8, 40, { funds: 5 });
    const h0 = c.heights();
    assert.equal(c.terraform(20, 20, 1), RESULT.NO_MONEY);
    assert.deepEqual(c.heights(), h0);
    assert.equal(c.funds(), 5);
  });

  test("outside the map: Failed", () => {
    const c = city(9, 12);
    assert.equal(c.terraform(-1, 3, 1), RESULT.FAILED);
    assert.equal(c.terraform(3, 12, -1), RESULT.FAILED);
  });
});
