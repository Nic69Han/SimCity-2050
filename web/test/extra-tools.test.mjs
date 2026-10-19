// The registry of extra tool modules (web/extra-tools.js): its contract, the empty water and
// transit modules, and the routing of entries to their module.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  EXTRA_TOOL_MODULES, extraCatalog, extraCalls, extraLabel, extraBlockedReason, isExtraTool,
} from "../extra-tools.js";
import * as water from "../tools-water.js";
import * as transit from "../tools-transit.js";
import { readCatalog, callsFor } from "../tools.js";
import { MockCity } from "./mock-engine.mjs";

describe("every module follows the contract", () => {
  test("the registry lists relief, water and transit, each with its own kind", () => {
    assert.deepEqual(EXTRA_TOOL_MODULES.map((m) => m.KIND), ["relief", "water", "transit", "structures", "zoning"]);
    for (const m of EXTRA_TOOL_MODULES) {
      for (const name of ["catalog", "calls", "label", "blockedReason"]) {
        assert.equal(typeof m[name], "function", `${m.KIND}.${name}`);
      }
    }
  });

  test("the water and transit modules are empty", () => {
    const city = new MockCity(1);
    for (const m of [water, transit]) {
      assert.deepEqual(m.catalog(city), []);
      assert.equal(m.calls(city, { kind: m.KIND }), null);
      assert.equal(m.label(Int32Array.of(1, 10)), undefined);
      assert.equal(m.blockedReason(city, { in3d: false, flags: {} }), "");
    }
  });
});

describe("routing", () => {
  test("an engine entry belongs to no module", () => {
    const [first] = readCatalog(new MockCity(1));
    assert.equal(isExtraTool(first), false);
    assert.equal(extraCalls(new MockCity(1), first), null);
    assert.equal(extraLabel(first, Int32Array.of(1, 5)), undefined);
    assert.equal(extraBlockedReason(first, new MockCity(1), { in3d: false, flags: {} }), "");
    assert.equal(isExtraTool(undefined), false);
  });

  test("an entry goes to the module of its kind, and to no other", () => {
    const city = new MockCity(1);
    const [up] = extraCatalog(city);
    assert.equal(isExtraTool(up), true);
    assert.equal(typeof extraCalls(city, up).down, "function");
    assert.equal(extraLabel(up, Int32Array.of(1, 30)), "30 $");
    assert.equal(isExtraTool({ kind: "unknown" }), false);
    assert.equal(extraCalls(city, { kind: "unknown", id: 1 }), null);
  });

  test("callsFor sends an extra entry to its module and an engine entry to tool_*", () => {
    const city = new MockCity(1);
    const [up] = extraCatalog(city);
    const [first] = readCatalog(city);
    assert.deepEqual([...callsFor(city, up).footprint(2, 3)], [2, 3, 1, 1]);
    assert.equal(callsFor(city, first).footprint.length, 2);
  });

  test("an engine without the terraforming methods gives no entry at all", () => {
    assert.deepEqual(extraCatalog({}), []);
    assert.deepEqual(extraCatalog(null), []);
  });
});
