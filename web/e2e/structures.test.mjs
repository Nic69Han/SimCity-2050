// End-to-end: the extended buildings (docs/game-design-v04.md) on the real wasm engine. A new city,
// the «Bâtiments étendus» switch, a parc urbain placed with the palette on bare land the engine
// accepts, seen in the panel, on the 2D map and in the simple 3D view (canvas.structuresStats()),
// then bulldozed with the classic tool: the whole building goes at once.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, newCity, selectTool, clickTile, engine, pollUntil, mapDigest, shot,
} from "./helpers.mjs";

const TIMEOUT = 180000;
const SEED = 4242;
const PARK = 1;
// Software WebGL in headless Chromium (no GPU in CI); same switches as view3d.test.mjs.
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

let browser;
before(async () => {
  browser = await launchBrowser({ args: GL_ARGS });
});
after(async () => {
  await browser?.close();
});

const count3d = (page) => page.evaluate(() => document.getElementById("map3d").structuresStats?.() ?? null);

describe("extended buildings", () => {
  test("a park is placed, shown in 2D and 3D, and bulldozed whole", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { query: "?lite=1" });
    try {
      await newCity(page, String(SEED));
      await pollUntil(async () => (await page.locator("#status").textContent()).includes(`Graine ${SEED}`), "the new city");

      // the engine on the same settings picks a site where a park can go
      const { City } = await engine();
      const shadow = City.new_sized(120, 100, SEED);
      shadow.set_structure_rules(true);
      let site = null;
      for (let x = 4; x < 110 && !site; x++) {
        for (let y = 4; y < 90 && !site; y++) {
          if (shadow.structure_preview(PARK, x, y)[0] === 1) site = { x, y };
        }
      }
      assert.ok(site, "bare land for a 2x2 park");

      assert.equal(await page.isVisible("#structures-panel"), true);
      assert.equal(await page.isChecked("#structures-rules"), false);
      await page.locator("#structures-rules").check();
      await pollUntil(async () => /^Activés : aucun bâtiment/u.test(await page.locator("#structures-state").textContent()), "the switch on");

      const before = await mapDigest(page);
      await selectTool(page, `structure_${PARK}`);
      await clickTile(page, site.x, site.y);
      await page.keyboard.press("Escape");
      await pollUntil(async () => /^Activés : 1 bâtiment/u.test(await page.locator("#structures-state").textContent()), "one building");
      assert.notEqual(await mapDigest(page), before, "the park is drawn on the map");
      await shot(page, "structures-2d");

      await page.locator("#view3d").click();
      await page.waitForFunction(() => typeof document.getElementById("map3d").structuresStats === "function");
      await pollUntil(async () => (await count3d(page))?.structures === 1, "the park in 3D");
      assert.ok((await count3d(page)).instances > 0);
      await shot(page, "structures-3d");
      await page.locator("#view3d").click();
      await page.waitForFunction(() => !document.getElementById("map-frame").classList.contains("is-3d"));

      await selectTool(page, "bulldozer");
      await clickTile(page, site.x + 1, site.y + 1);
      await pollUntil(async () => /^Activés : aucun bâtiment/u.test(await page.locator("#structures-state").textContent()), "the park bulldozed");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
