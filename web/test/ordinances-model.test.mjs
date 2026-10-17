// Tests of the pure part of the ordinances panel (web/ordinances-model.js): French texts for
// every ordinance of the engine's table, effect lines, costs, totals, reading an engine.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  TEXTS, REQUIRED, formatSignedPercent, decodeInfo, effectText, costText, totalText, supports,
  readOrdinances, snapshotKey,
} from "../ordinances-model.js";

const NBSP = " ";
const MINUS = "−";

const CORE = readFileSync(
  fileURLToPath(new URL("../../crates/micropolis-core/src/ordinances.rs", import.meta.url)),
  "utf8",
);
// The keys of the engine's table, in order: `Ordinance { key: "...", ...`.
const ENGINE_KEYS = [...CORE.matchAll(/key:\s*"([a-z_]+)"/g)].map((m) => m[1]).filter((k) => k !== "");

/** A fake engine: `infos[i]` = [cost, crime, pollution, land, res, com, ind]. */
function fakeEngine(keys, infos, active = []) {
  return {
    ordinance_count: () => keys.length,
    ordinance_key: (i) => keys[i] ?? "",
    ordinance_info: (i) => Int32Array.from(infos[i] ?? []),
    ordinance_active: (i) => active.includes(i),
    set_ordinance: () => true,
  };
}

describe("French texts", () => {
  test("every ordinance of the engine's table has a name and a help line", () => {
    assert.equal(ENGINE_KEYS.length, 8);
    for (const key of ENGINE_KEYS) {
      assert.ok(TEXTS[key], `texts for ${key}`);
      assert.ok(TEXTS[key].label.length > 2 && TEXTS[key].help.length > 5, key);
    }
    for (const key of Object.keys(TEXTS)) assert.ok(ENGINE_KEYS.includes(key), `${key} is an engine key`);
  });

  test("names are French and distinct", () => {
    const labels = Object.values(TEXTS).map((t) => t.label);
    assert.equal(new Set(labels).size, labels.length);
    assert.ok(labels.includes("Police de proximité") && labels.includes("Couvre-feu des jeunes"));
  });
});

describe("numbers as text", () => {
  test("signed percent uses a real minus and a no-break space", () => {
    assert.equal(formatSignedPercent(8), `+8${NBSP}%`);
    assert.equal(formatSignedPercent(-15), `${MINUS}15${NBSP}%`);
    assert.equal(formatSignedPercent(0), `0${NBSP}%`);
  });

  test("decodeInfo reads the seven fields and tolerates a short or missing array", () => {
    assert.deepEqual(decodeInfo(Int32Array.from([230, -15, 0, 0, 0, 0, 0])), {
      cost: 230, crime: -15, pollution: 0, land: 0, res: 0, com: 0, ind: 0,
    });
    assert.deepEqual(decodeInfo(undefined), { cost: 0, crime: 0, pollution: 0, land: 0, res: 0, com: 0, ind: 0 });
    assert.equal(decodeInfo([5]).cost, 5);
  });

  test("effectText lists the non-zero effects in a fixed order", () => {
    const info = decodeInfo([100, -8, 0, 0, -3, 0, 0]);
    assert.equal(effectText(info), `Criminalité ${MINUS}8${NBSP}%, demande résidentielle ${MINUS}3${NBSP}%`);
    assert.equal(effectText(decodeInfo([100, 0, 0, 10, 0, 0, 0])), `Valeur du terrain +10${NBSP}%`);
    assert.equal(effectText(decodeInfo([100, 0, 0, 0, 0, 0, 0])), "");
    // The cost is not an effect.
    assert.equal(effectText(decodeInfo([999, 0, 0, 0, 0, 0, 0])), "");
  });

  test("costText and totalText", () => {
    assert.equal(costText(1200), `1 200${NBSP}$ par an`);
    const items = [
      { active: true, info: { cost: 200 } },
      { active: false, info: { cost: 999 } },
      { active: true, info: { cost: 150 } },
    ];
    assert.equal(totalText(items), `Coût total : 350${NBSP}$ par an (2 en vigueur).`);
    assert.equal(totalText([{ active: false, info: { cost: 5 } }]), "Aucune ordonnance en vigueur.");
    assert.equal(totalText([]), "Aucune ordonnance en vigueur.");
  });
});

describe("reading the engine", () => {
  test("supports needs every method", () => {
    assert.equal(supports(fakeEngine(["a"], [[1]])), true);
    for (const name of REQUIRED) {
      const engine = fakeEngine(["a"], [[1]]);
      delete engine[name];
      assert.equal(supports(engine), false, name);
    }
    assert.equal(supports(null), false);
    assert.equal(supports({}), false);
  });

  test("readOrdinances gives one item per ordinance with the engine's numbers", () => {
    const engine = fakeEngine(["community_policing", "curfew", "unknown_new"], [
      [230, -15, 0, 0, 0, 0, 0],
      [115, -8, 0, 0, -3, 0, 0],
      [10, 0, 0, 0, 0, 0, 0],
    ], [1]);
    const items = readOrdinances(engine);
    assert.deepEqual(items.map((i) => i.index), [0, 1, 2]);
    assert.deepEqual(items.map((i) => i.active), [false, true, false]);
    assert.equal(items[0].label, "Police de proximité");
    assert.equal(items[2].label, "unknown_new", "an unknown key falls back to the key");
    assert.equal(items[1].info.cost, 115);
  });

  test("snapshotKey changes exactly when something shown changes", () => {
    const keys = ["community_policing", "curfew"];
    const infos = [[230, -15, 0, 0, 0, 0, 0], [115, -8, 0, 0, -3, 0, 0]];
    const base = snapshotKey(readOrdinances(fakeEngine(keys, infos)));
    assert.equal(snapshotKey(readOrdinances(fakeEngine(keys, infos))), base);
    assert.notEqual(snapshotKey(readOrdinances(fakeEngine(keys, infos, [0]))), base, "active");
    assert.notEqual(
      snapshotKey(readOrdinances(fakeEngine(keys, [[231, -15, 0, 0, 0, 0, 0], infos[1]]))),
      base,
      "cost",
    );
  });
});
