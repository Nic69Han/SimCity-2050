// The zoning tool module (web/tools-zoning.js): catalog, engine calls, labels and the blocked reason,
// through the registry (extra-tools.js) and the palette (tools.js) against the mock engine.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as tools from "../tools-zoning.js";
import { extraCatalog, extraCalls, extraLabel, extraBlockedReason, isExtraTool } from "../extra-tools.js";
import { readCatalog, callsFor, groupCatalog, TOOL_GROUPS, strokeEngineOf, costLabel } from "../tools.js";
import { MockCity, RESULT, START_FUNDS } from "./mock-engine.mjs";

const withZones = (seed = 1, options = {}) => new MockCity(seed, { ...options, densities: true });
const on = (seed = 1, options = {}) => {
  const city = withZones(seed, { rubble: 0, ...options });
  city.set_density_rules(true);
  return city;
};

describe("catalog", () => {
  test("nine entries, one per genre and density, in the zonage group", () => {
    const entries = tools.catalog(withZones(1));
    assert.deepEqual(entries.map((e) => e.id), [
      "zoning:r:leger", "zoning:r:moyen", "zoning:r:dense",
      "zoning:c:leger", "zoning:c:moyen", "zoning:c:dense",
      "zoning:i:leger", "zoning:i:moyen", "zoning:i:dense",
    ]);
    for (const e of entries) {
      assert.equal(e.group, "zonage");
      assert.equal(e.groupLabel, "Zonage");
      assert.equal(e.kind, "zoning");
      assert.equal(e.size, 3);
      assert.equal(e.shortcut, null);
      assert.equal(e.cost, 0, "the price is the preview's, not the catalog's");
      assert.equal(e.costText, "au survol");
    }
  });

  test("keys and French labels", () => {
    const [first, , , , , , , , last] = tools.catalog(withZones(1));
    assert.equal(first.key, "zone_r_leger");
    assert.equal(first.label, "Résidentiel léger");
    assert.equal(last.key, "zone_i_dense");
    assert.equal(last.label, "Industriel dense");
    assert.equal(tools.catalog(withZones(1))[4].label, "Commercial moyen");
  });

  test("empty without the zoning, and it does not depend on the rule", () => {
    assert.deepEqual(tools.catalog(new MockCity(1)), []);
    assert.equal(tools.catalog(withZones(1)).length, 9);
    assert.equal(tools.catalog(on(1)).length, 9);
  });

  test("the group sits right after «Zones», listed once", () => {
    const ids = TOOL_GROUPS.map((g) => g.id);
    assert.equal(ids.filter((id) => id === "zonage").length, 1);
    assert.equal(ids.indexOf("zonage"), ids.indexOf("zones") + 1);
    const group = TOOL_GROUPS.find((g) => g.id === "zonage");
    assert.equal(group.label, "Zonage");
    assert.deepEqual(group.keys, []);
  });

  test("the palette groups the nine zones under «Zonage»", () => {
    const city = on(1);
    const group = groupCatalog([...readCatalog(city), ...extraCatalog(city)]).find((g) => g.id === "zonage");
    assert.ok(group, "the group is not dropped");
    assert.equal(group.tools.length, 9);
  });
});

describe("engine calls", () => {
  test("the footprint is the 3x3 square centred on the clicked tile", () => {
    const city = on(1);
    const [entry] = tools.catalog(city);
    const c = tools.calls(city, entry);
    assert.deepEqual([...c.footprint(10, 12)], [9, 11, 3, 3]);
    assert.deepEqual([...c.footprint(0, 0)], [-1, -1, 3, 3]);
  });

  test("preview and down go to the engine with the genre and the density", () => {
    const city = on(1);
    const entry = tools.catalog(city).find((e) => e.id === "zoning:i:dense");
    const c = tools.calls(city, entry);
    assert.deepEqual([...c.preview(20, 20)], [RESULT.OK, 150]);
    assert.equal(city.funds(), START_FUNDS, "a preview charges nothing");
    assert.equal(c.down(20, 20), RESULT.OK);
    assert.equal(city.funds(), START_FUNDS - 150);
    assert.deepEqual([...city.density_stats()], [0, 0, 1, 0, 0]);
  });

  test("a drag places nothing: one zone per click", () => {
    const city = on(1);
    const [entry] = tools.catalog(city);
    const c = tools.calls(city, entry);
    assert.equal(c.drag(20, 20, 30, 30), 0);
    assert.deepEqual([...city.density_stats()], [0, 0, 0, 0, 0]);
    assert.equal(city.funds(), START_FUNDS);
  });

  test("null for an entry of another module, or without the zoning", () => {
    const city = on(1);
    const [zone] = tools.catalog(city);
    assert.equal(tools.calls(city, { kind: "structures", id: "structures:1" }), null);
    assert.equal(tools.calls(city, { id: "residential" }), null, "an engine entry has no kind");
    assert.equal(tools.calls(new MockCity(1), zone), null);
    assert.equal(tools.calls(city, undefined), null);
  });

  test("through the registry: the zone entries go to this module", () => {
    const city = on(1);
    const zone = extraCatalog(city).find((e) => e.id === "zoning:c:moyen");
    assert.equal(isExtraTool(zone), true);
    assert.deepEqual([...extraCalls(city, zone).footprint(5, 5)], [4, 4, 3, 3]);
    assert.deepEqual([...callsFor(city, zone).preview(20, 20)], [RESULT.OK, 100]);
  });

  test("a stroke of the palette places the zone through the engine", () => {
    const city = on(1);
    const entry = tools.catalog(city).find((e) => e.id === "zoning:r:leger");
    const calls = new Map([[entry.id, tools.calls(city, entry)]]);
    const engine = strokeEngineOf(calls);
    assert.equal(engine.tool_down(entry.id, 20, 20), RESULT.OK);
    assert.equal(city.funds(), START_FUNDS - 80);
    assert.equal(engine.tool_drag(entry.id, 20, 20, 25, 20), 0);
    assert.equal(city.funds(), START_FUNDS - 80);
  });
});

describe("labels and the blocked reason", () => {
  test("a refused tile is labelled «Impossible ici»", () => {
    assert.equal(tools.label(Int32Array.of(RESULT.FAILED, 0)), "Impossible ici");
  });

  test("no preview at all keeps the default label instead of failing", () => {
    assert.equal(tools.label(undefined), undefined);
    assert.equal(tools.label(null), undefined);
  });

  test("an allowed or charged tile keeps the default label (the preview's cost)", () => {
    assert.equal(tools.label(Int32Array.of(RESULT.OK, 80)), undefined);
    assert.equal(tools.label(Int32Array.of(RESULT.OK, 0)), undefined, "Ok is never a refusal");
    assert.equal(tools.label(Int32Array.of(RESULT.NO_MONEY, 150)), undefined);
    assert.equal(tools.label(Int32Array.of(RESULT.NEED_BULLDOZE, 100)), undefined);
  });

  test("the real engine's refused previews (cost 0) get a reason, never «gratuit»", () => {
    const bulldoze = tools.label(Int32Array.of(RESULT.NEED_BULLDOZE, 0));
    const money = tools.label(Int32Array.of(RESULT.NO_MONEY, 0));
    assert.equal(bulldoze, "Terrain à dégager");
    assert.equal(money, "Fonds insuffisants");
    assert.equal(tools.label(Int32Array.of(RESULT.FAILED, 0)), "Impossible ici");
  });

  test("every refused code with cost 0 gets a reason, and costLabel never says «gratuit» for it", () => {
    for (const code of [RESULT.FAILED, RESULT.NEED_BULLDOZE, RESULT.NO_MONEY]) {
      const preview = Int32Array.of(code, 0);
      const text = tools.label(preview);
      assert.notEqual(text, undefined, `code ${code}`);
      assert.notEqual(text, "gratuit");
      assert.notEqual(costLabel(preview, 80), "gratuit", `costLabel with a catalog price, code ${code}`);
    }
  });

  test("an unknown refusal code with no cost falls back to «Impossible ici»", () => {
    assert.equal(tools.label(Int32Array.of(-7, 0)), "Impossible ici");
  });

  test("a refused preview from the real mock engine is labelled, never free", () => {
    const city = on(1);
    const [entry] = tools.catalog(city);
    const preview = tools.calls(city, entry).preview(0, 0);
    assert.equal(preview[0], RESULT.FAILED);
    assert.equal(tools.label(preview), "Impossible ici");
    const rubble = new MockCity(1, { densities: true, rubble: 2000 });
    rubble.set_density_rules(true);
    const rubbleEntry = tools.catalog(rubble)[0];
    const refused = tools.calls(rubble, rubbleEntry).preview(20, 20);
    assert.deepEqual([...refused], [RESULT.NEED_BULLDOZE, 0]);
    assert.equal(tools.label(refused), "Terrain à dégager");
  });

  test("the rule off gives the rule message, in 2D or 3D", () => {
    const city = withZones(1);
    const entry = tools.catalog(city)[0];
    assert.equal(tools.blockedReason(city, { in3d: false }), "Activez les densités de zonage pour zoner par densité.");
    assert.equal(extraBlockedReason(entry, city, { in3d: true, flags: {} }),
      "Activez les densités de zonage pour zoner par densité.");
  });

  test("the rule on: allowed in 2D, the 3D message in 3D", () => {
    const city = on(1);
    const entry = tools.catalog(city)[0];
    assert.equal(extraBlockedReason(entry, city, { in3d: false, flags: {} }), "");
    assert.equal(extraBlockedReason(entry, city, { in3d: true, flags: {} }), tools.blockedReason(city, { in3d: true }));
    assert.match(tools.blockedReason(city, { in3d: true }), /vue 2D/);
  });

  test("no zoning, no reason", () => {
    assert.equal(tools.blockedReason(new MockCity(1), { in3d: true }), "");
  });
});
