// End-to-end: the zoning densities (docs/game-design-v07.md) on the real wasm engine. A new city, the
// «Densités de zonage» switch, a light residential zone placed with the palette where the engine
// accepts it: the panel counts it and «Voir les densités» tints the map.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, newCity, selectTool, clickTile, engine, pollUntil, shot, TILE_PX,
} from "./helpers.mjs";

const TIMEOUT = 120000;
const SEED = 4243;
const RESIDENTIAL = 1, LIGHT = 1;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

const state = (page) => page.locator("#zoning-state").textContent();

describe("zoning densities", () => {
  test("a light residential zone is placed, counted, and shown by the densities view", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, String(SEED));
      await pollUntil(async () => (await page.locator("#status").textContent()).includes(`Graine ${SEED}`), "the new city");

      // the engine on the same settings picks a centre where a light residential zone can go
      const { City } = await engine();
      const shadow = City.new_sized(120, 100, SEED);
      shadow.set_density_rules(true);
      let site = null;
      for (let x = 4; x < 110 && !site; x++) {
        for (let y = 4; y < 90 && !site; y++) {
          if (shadow.zone_preview(RESIDENTIAL, LIGHT, x, y)[0] === 1) site = { x, y };
        }
      }
      assert.ok(site, "bare land for a 3x3 zone");

      assert.equal(await page.isVisible("#zoning-panel"), true);
      await page.locator("#zoning-rules").check();
      await pollUntil(async () => /^Zones légères : 0/u.test(await state(page)), "the switch on");

      await selectTool(page, "zone_r_leger");
      await clickTile(page, site.x, site.y);
      await page.keyboard.press("Escape");
      await pollUntil(async () => /^Zones légères : 1 /u.test(await state(page)), "one light zone");

      // the colour the page painted at the zone centre: the densities view tints it
      const pixel = () => page.evaluate(([x, y, px]) => {
        const c = document.getElementById("map");
        return Array.from(c.getContext("2d").getImageData(x * px + px / 2, y * px + 1, 1, 1).data).join();
      }, [site.x, site.y, TILE_PX]);
      const before = await pixel();
      await page.locator("#zoning-view").check();
      await pollUntil(async () => (await pixel()) !== before, "the densities tint on the map");
      await shot(page, "zoning-densities");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
