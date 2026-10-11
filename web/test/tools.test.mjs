// Palette logic: catalog reading, labels, groups, shortcuts, result messages, feature detection.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  RESULT, TILE_PX, TOOL_GROUPS, TOOL_LABELS, SHORTCUTS,
  resultMessage, supportsTools, readCatalog, groupCatalog, groupOf, shortcutFor,
  toolIdForShortcut, formatCost, outlineRect, hoverVerdict, shortcutRows, costLabel,
} from "../tools.js";
import { MockCity, MOCK_TOOLS } from "./mock-engine.mjs";

describe("result -> message (aria-live status, French)", () => {
  test("NoMoney (-2)", () => {
    assert.equal(resultMessage(RESULT.NO_MONEY), "Pas assez d'argent");
    assert.equal(resultMessage(-2), "Pas assez d'argent");
  });
  test("NeedBulldoze (-1)", () => {
    assert.equal(resultMessage(RESULT.NEED_BULLDOZE), "Terrain à dégager d'abord (bulldozer)");
  });
  test("Failed (0)", () => {
    assert.equal(resultMessage(RESULT.FAILED), "Impossible de construire ici");
  });
  test("Ok (1) clears the message", () => {
    assert.equal(resultMessage(RESULT.OK), "");
  });
  test("an unknown code gets a generic message, never a crash", () => {
    assert.equal(resultMessage(42), "Action impossible");
  });
  test("codes match docs/tools-contract.md", () => {
    assert.deepEqual(RESULT, { NO_MONEY: -2, NEED_BULLDOZE: -1, FAILED: 0, OK: 1 });
  });
});

describe("feature detection", () => {
  test("a full engine supports the palette", () => {
    assert.equal(supportsTools(new MockCity(1)), true);
  });
  test("an engine without tool_info (today's City) keeps the page as it is", () => {
    const old = {
      width: () => 10, height: () => 10, tiles: () => new Uint16Array(100), tick() {},
    };
    assert.equal(typeof old.tool_info, "undefined");
    assert.equal(supportsTools(old), false);
    assert.equal(supportsTools({}), false);
    assert.equal(supportsTools(null), false);
    assert.equal(supportsTools(undefined), false);
  });
  test("tool_info present but a required method missing: palette off", () => {
    for (const missing of ["tool_count", "tool_key", "tool_down", "tool_drag", "tool_preview", "tool_footprint"]) {
      const city = new MockCity(1);
      city[missing] = undefined;
      assert.equal(supportsTools(city), false, missing);
    }
  });
  test("a non-function tool_info is not a tool API", () => {
    const city = new MockCity(1);
    city.tool_info = 3;
    assert.equal(supportsTools(city), false);
  });
});

describe("catalog read from the engine", () => {
  const city = new MockCity(1, { rubble: 0 });
  const catalog = readCatalog(city);

  test("one entry per engine tool, with id, key, cost and size from the engine", () => {
    assert.equal(catalog.length, MOCK_TOOLS.length);
    const road = catalog.find((t) => t.key === "road");
    assert.deepEqual(
      { id: road.id, cost: road.cost, size: road.size, label: road.label },
      { id: MOCK_TOOLS.findIndex((t) => t.key === "road"), cost: 10, size: 1, label: "Route" },
    );
    const airport = catalog.find((t) => t.key === "airport");
    assert.equal(airport.size, 6);
    assert.equal(airport.cost, 10000);
  });

  test("French labels for the known keys", () => {
    assert.equal(catalog.find((t) => t.key === "residential").label, "Zone résidentielle");
    assert.equal(catalog.find((t) => t.key === "coal_power").label, "Centrale à charbon");
    assert.equal(catalog.find((t) => t.key === "bulldozer").label, "Bulldozer");
  });

  test("an unknown key from the engine is shown as its key, in group Autres", () => {
    const odd = {
      tool_count: () => 1,
      tool_info: () => Int32Array.of(0, 7, 1),
      tool_key: () => "hydro_dam",
    };
    const [t] = readCatalog(odd);
    assert.equal(t.label, "hydro_dam");
    assert.equal(t.group, "autres");
    assert.equal(t.shortcut, null);
    const groups = groupCatalog(readCatalog(odd));
    assert.deepEqual(groups.map((g) => g.label), ["Autres"]);
  });

  test("every catalog key is in exactly one display group", () => {
    const seen = new Map();
    for (const g of TOOL_GROUPS) for (const k of g.keys) seen.set(k, (seen.get(k) ?? 0) + 1);
    for (const [k, n] of seen) assert.equal(n, 1, `${k} listed in ${n} groups`);
    assert.equal(groupOf("road").id, "reseaux");
    assert.equal(groupOf("residential").id, "zones");
    assert.equal(groupOf("coal_power").id, "energie");
    assert.equal(groupOf("bulldozer").id, "terrain");
    assert.equal(groupOf("query").id, "requete");
    assert.equal(groupOf("nope").id, "autres");
  });

  test("groupCatalog keeps the display order and drops empty groups", () => {
    const groups = groupCatalog(catalog);
    assert.deepEqual(groups.map((g) => g.id), ["reseaux", "zones", "services", "energie", "terrain", "requete"]);
    const total = groups.reduce((n, g) => n + g.tools.length, 0);
    assert.equal(total, catalog.length);
    const onlyRoads = groupCatalog(catalog.filter((t) => t.key === "road"));
    assert.deepEqual(onlyRoads.map((g) => g.id), ["reseaux"]);
  });

  test("costs are formatted, zero is free", () => {
    assert.equal(formatCost(0), "gratuit");
    assert.match(formatCost(1000), /^1\s?000 \$$/u); // thousands separator varies by ICU build
    assert.equal(formatCost(5), "5 $");
  });
});

describe("shortcuts", () => {
  test("every shortcut is a single character and used only once", () => {
    const values = Object.values(SHORTCUTS);
    for (const v of values) assert.equal(v.length, 1);
    assert.equal(new Set(values).size, values.length);
  });

  test("the table maps known keys and nothing else", () => {
    assert.equal(shortcutFor("bulldozer"), "b");
    assert.equal(shortcutFor("road"), "r");
    assert.equal(shortcutFor("residential"), "1");
    assert.equal(shortcutFor("unknown_tool"), null);
    assert.equal(shortcutFor("constructor"), null, "inherited properties are not shortcuts");
  });

  test("a typed key selects the engine tool with that shortcut (case-insensitive)", () => {
    const catalog = readCatalog(new MockCity(1));
    assert.equal(toolIdForShortcut("b", catalog), MOCK_TOOLS.findIndex((t) => t.key === "bulldozer"));
    assert.equal(toolIdForShortcut("R", catalog), MOCK_TOOLS.findIndex((t) => t.key === "road"));
    assert.equal(toolIdForShortcut("z", catalog), null);
    assert.equal(toolIdForShortcut("Enter", catalog), null, "only single characters");
    assert.equal(toolIdForShortcut("", catalog), null);
  });

  test("a shortcut only fires for a tool the engine reports", () => {
    const partial = [{ id: 3, key: "road", shortcut: "r" }];
    assert.equal(toolIdForShortcut("b", partial), null);
    assert.equal(toolIdForShortcut("r", partial), 3);
  });
});

describe("hover outline geometry and verdict", () => {
  test("footprint in tiles becomes a pixel rectangle at TILE_PX per tile", () => {
    assert.equal(TILE_PX, 6);
    assert.deepEqual(outlineRect([4, 5, 1, 1]), { x: 24, y: 30, w: 6, h: 6 });
    assert.deepEqual(outlineRect([4, 5, 3, 3]), { x: 24, y: 30, w: 18, h: 18 });
    assert.deepEqual(outlineRect([2, 2, 6, 6], 10), { x: 20, y: 20, w: 60, h: 60 });
  });

  test("green only when preview result is Ok (1); red otherwise", () => {
    assert.equal(hoverVerdict(Int32Array.of(1, 100)), "ok");
    assert.equal(hoverVerdict(Int32Array.of(-2, 100)), "bad");
    assert.equal(hoverVerdict(Int32Array.of(-1, 1)), "bad");
    assert.equal(hoverVerdict(Int32Array.of(0, 0)), "bad");
  });

  test("big tools: the mock's footprint is a square centred on the pointer tile", () => {
    const city = new MockCity(1, { rubble: 0 });
    const fp3 = [...city.tool_footprint(MOCK_TOOLS.findIndex((t) => t.key === "residential"), 10, 10)];
    assert.deepEqual(fp3, [9, 9, 3, 3]);
    const fp6 = [...city.tool_footprint(MOCK_TOOLS.findIndex((t) => t.key === "airport"), 10, 10)];
    assert.deepEqual(fp6, [8, 8, 6, 6]);
  });
});

describe("keyboard help rows", () => {
  test("one row per shortcut the engine reports, upper-cased and sorted, then Échap", () => {
    const rows = shortcutRows(readCatalog(new MockCity(1)));
    const keys = rows.map((r) => r.key);
    assert.equal(keys.at(-1), "Échap");
    const shortcutKeys = keys.slice(0, -1);
    assert.equal(shortcutKeys.length, Object.keys(SHORTCUTS).filter((k) => MOCK_TOOLS.some((t) => t.key === k)).length);
    assert.deepEqual([...shortcutKeys], [...shortcutKeys].sort((a, b) => a.localeCompare(b, "fr")));
    assert.deepEqual(rows.find((r) => r.key === "B"), { key: "B", label: "Bulldozer" });
    assert.deepEqual(rows.find((r) => r.key === "1"), { key: "1", label: "Zone résidentielle" });
  });

  test("a tool without a shortcut gets no row", () => {
    const rows = shortcutRows([{ id: 0, key: "hydro_dam", label: "hydro_dam", shortcut: null }]);
    assert.deepEqual(rows, [{ key: "Échap", label: "Abandonner l'outil choisi" }]);
  });
});

describe("cost on the hover label", () => {
  test("when the placement is Ok, the preview's cost is shown, even zero (never the catalog price)", () => {
    assert.equal(costLabel(Int32Array.of(1, 45), 10), "45 $");
    assert.equal(costLabel(Int32Array.of(1, 0), 10), "gratuit");
  });

  test("otherwise the preview's cost if it has one, else the catalog price", () => {
    assert.equal(costLabel(Int32Array.of(-2, 500), 100), "500 $");
    assert.equal(costLabel(Int32Array.of(0, 0), 100), "100 $");
    assert.equal(costLabel(Int32Array.of(-1, 0), 100), "100 $");
  });

  test("the mock's preview cost on trees is what tool_down charges (terrain adds cost)", () => {
    const city = new MockCity(1, { rubble: 0 });
    const res = MOCK_TOOLS.findIndex((t) => t.key === "residential");
    // a 3x3 residential on the trees at (20..22, 20..22)
    for (let x = 20; x < 23; x++) for (let y = 20; y < 23; y++) city.tool_down(MOCK_TOOLS.findIndex((t) => t.key === "forest"), x, y);
    const [result, cost] = city.tool_preview(res, 21, 21);
    assert.equal(result, 1);
    assert.equal(cost, 100 + 9 * 10, "catalog 100 plus 10 per tree tile");
    assert.equal(costLabel(city.tool_preview(res, 21, 21), 100), "190 $");
    const before = city.funds();
    assert.equal(city.tool_down(res, 21, 21), 1);
    assert.equal(before - city.funds(), cost);
  });
});
