// End-to-end: the extended energy (docs/game-design-v10.md) on the real wasm engine. A new city, the
// «Bâtiments étendus» and «Énergie étendue» switches, a wind turbine placed with the palette where the
// engine accepts it: the «Énergie» panel shows the production go up and lists the turbine.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, newCity, selectTool, clickTile, engine, pollUntil, shot,
} from "./helpers.mjs";

const TIMEOUT = 120000;
const SEED = 4245;
const WIND = 42;
const WIND_POWER = 30; // tiles powered by a new turbine (energy.rs)

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

const text = (page, id) => page.locator(id).textContent();
const production = async (page) => {
  const m = /Production : ([\d\s ]+)/u.exec(await text(page, "#energy-stats"));
  return m ? Number(m[1].replace(/\D/gu, "")) : null;
};

describe("extended energy", () => {
  test("a wind turbine raises the production shown in the energy panel", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, String(SEED));
      await pollUntil(async () => (await text(page, "#status")).includes(`Graine ${SEED}`), "the new city");

      // the engine on the same settings picks a site where a turbine can go
      const { City } = await engine();
      const shadow = City.new_sized(120, 100, SEED);
      shadow.set_structure_rules(true);
      shadow.set_energy_rules(true);
      let site = null;
      for (let x = 4; x < 110 && !site; x++) {
        for (let y = 4; y < 90 && !site; y++) {
          if (shadow.structure_preview(WIND, x, y)[0] === 1) site = { x, y };
        }
      }
      assert.ok(site, "bare land for a turbine");

      await page.locator("#structures-rules").check();
      assert.equal(await page.isVisible("#energy-panel"), true);
      await page.locator("#energy-rules").check();
      await pollUntil(async () => (await production(page)) !== null, "the energy statistics");
      const before = await production(page);

      await selectTool(page, `structure_${WIND}`);
      await clickTile(page, site.x, site.y);
      await page.keyboard.press("Escape");
      await pollUntil(async () => (await production(page)) === before + WIND_POWER, "the turbine's power");
      assert.match(await text(page, "#energy-plants"), /Éolienne/u);
      await shot(page, "energy-wind");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
