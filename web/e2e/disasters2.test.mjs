// End-to-end: SC3000 disasters and highways (docs/game-design-v13.md) on the real wasm engine. The sample
// city, the «Autoroutes» switch, a highway laid with the palette on a road the engine accepts (counted in
// the panel, the map tinted by the highways view), then «Catastrophes étendues» and a meteor triggered
// from the panel (reported in the panel's statistics).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, selectTool, clickTile, pollUntil, shot, shadowCity, readSample, TILE_PX,
} from "./helpers.mjs";

const TIMEOUT = 120000;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

const text = (page, id) => page.locator(id).textContent();

describe("SC3000 disasters and highways", () => {
  test("a highway is laid and shown, a meteor is triggered and reported", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      // the engine on the same city picks a road tile that takes a highway
      const { city } = await shadowCity({ cty: await readSample("haight") });
      city.set_highway_rules(true);
      let site = null;
      for (let x = 2; x < city.width() - 2 && !site; x++) {
        for (let y = 2; y < city.height() - 2 && !site; y++) {
          if (city.highway_preview(x, y)[0] === 1) site = { x, y };
        }
      }
      assert.ok(site, "a road tile for a highway");

      assert.equal(await page.isVisible("#disasters2-panel"), true);
      await page.locator("#highways-rules").check();
      await selectTool(page, "highway");
      await clickTile(page, site.x, site.y);
      await page.keyboard.press("Escape");
      await pollUntil(async () => /Autoroutes : 1 tuile/u.test(await text(page, "#highways-stats")), "one highway tile");

      const pixel = () => page.evaluate(([x, y, px]) => {
        const c = document.getElementById("map");
        return Array.from(c.getContext("2d").getImageData(x * px + px / 2, y * px + px / 2, 1, 1).data).join();
      }, [site.x, site.y, TILE_PX]);
      const before = await pixel();
      await page.locator("#highways-view").check();
      await pollUntil(async () => (await pixel()) !== before, "the highway tinted on the map");

      await page.locator("#disasters2-rules").check();
      await page.locator("#trigger-3").click();
      await pollUntil(async () => /Dernière catastrophe : Météorite/u.test(await text(page, "#disasters2-stats")), "the meteor reported");
      await shot(page, "disasters2");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
