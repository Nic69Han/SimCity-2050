// End-to-end: map sizes. A new city of 200 x 150 (custom size) on the real engine: the map and
// its tiles, the funds of a click at the far corner, the refused custom sizes, Enregistrer off
// with its note, and a sample brought back to the original 120 x 100 size.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, waitForReady, newCity, readStatus, readFunds, geometry,
  selectTool, clickTile, engine, Shadow,
} from "./helpers.mjs";

const TIMEOUT = 120000;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

describe("map sizes", () => {
  test("a 200 x 150 new city: canvas, tiles and funds agree with the engine; the size limits are enforced", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await waitForReady(page);
      await page.selectOption("#size", "custom");
      assert.equal(await page.locator("#size-custom").isVisible(), true, "custom size boxes are shown");

      // out-of-range sizes are refused, and the city stays
      await page.fill("#size-w", "79");
      await page.fill("#size-h", "150");
      await newCity(page, "7");
      assert.equal(await page.locator("#new-msg").textContent(), "Largeur hors limites : de 80 à 512");
      assert.equal(await page.locator("#size-w").getAttribute("aria-invalid"), "true");
      assert.equal((await readStatus(page)).seed, null, "no city was made");

      await page.fill("#size-w", "200");
      await page.fill("#size-h", "150");
      await newCity(page, "7");
      const status = await readStatus(page);
      assert.equal(status.seed, 7);
      assert.equal(await page.locator("#size-w").getAttribute("aria-invalid"), null);

      // the canvas has the new map: 200 x 150 tiles
      const g = await geometry(page);
      assert.equal(Math.round(g.w), 200);
      assert.equal(Math.round(g.h), 150);

      // the engine on the same settings: the same funds after a click at the far corner
      const { City } = await engine();
      const shadow = new Shadow(City.new_sized(200, 150, 7));
      assert.equal(status.funds, shadow.funds(), "funds of the new city");
      await selectTool(page, "road");
      await clickTile(page, 199, 149);
      const expected = shadow.down("road", 199, 149);
      assert.equal(expected, 1, "the engine places a road at the far corner");
      assert.equal(await readFunds(page), shadow.funds(), "the page charged the same road");

      // Enregistrer is off for this size, with the reason beside it
      assert.equal(await page.locator("#save").isDisabled(), true);
      assert.match(await page.locator("#save-note").textContent(), /120 × 100/);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a sample brings back the original 120 x 100 engine: Enregistrer is on again", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await waitForReady(page);
      await page.selectOption("#size", "tres-grande");
      await newCity(page, "3");
      assert.equal(await page.locator("#save").isDisabled(), true, "300 x 250 cannot be saved");
      const g = await geometry(page);
      assert.equal(Math.round(g.w), 300);
      assert.equal(Math.round(g.h), 250);

      // a click at the far corner of the 300 x 250 map lands on that tile, charged as the engine does
      const { City } = await engine();
      const shadow = new Shadow(City.new_sized(300, 250, 3));
      await selectTool(page, "road");
      await clickTile(page, 299, 249);
      assert.equal(shadow.down("road", 299, 249), 1, "the engine places a road there");
      assert.equal(await readFunds(page), shadow.funds(), "the page charged the same road");

      await page.selectOption("#city", "kyoto");
      await page.waitForFunction(() => document.getElementById("save")?.disabled === false);
      const back = await geometry(page);
      assert.equal(Math.round(back.w), 120);
      assert.equal(Math.round(back.h), 100);
      assert.equal(await page.locator("#save-note").textContent(), "");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
