// End-to-end: the v1.0 finish (docs/game-design-v1.md) on the real wasm engine. The «Langue» selector turns
// the fixed interface to English and back (the choice is kept on reload), and the 2D map is walked with the
// keyboard: the arrows move the tile cursor and the live region announces the tile.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, openPage, assertNoErrors, pollUntil, shot } from "./helpers.mjs";

const TIMEOUT = 120000;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

describe("v1.0 finish", () => {
  test("English interface, kept on reload, then French again", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      assert.equal((await page.locator("#save").textContent()).trim(), "Enregistrer");
      await page.locator("#language").selectOption("en");
      await pollUntil(async () => (await page.locator("#save").textContent()).trim() === "Save", "the English labels");
      assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
      await page.reload();
      await pollUntil(async () => (await page.locator("#save").textContent()).trim() === "Save", "English kept on reload");
      await page.locator("#language").selectOption("fr");
      await pollUntil(async () => (await page.locator("#save").textContent()).trim() === "Enregistrer", "French again");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("the arrows move the tile cursor on the 2D map and the tile is announced", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const live = page.locator("#map-frame [aria-live='polite']");
      await page.locator("#map").focus();
      await page.keyboard.press("ArrowRight");
      await pollUntil(async () => /^Tuile \d+, \d+/u.test((await live.textContent()) ?? ""), "a tile announced");
      const first = await live.textContent();
      await page.keyboard.press("ArrowDown");
      await pollUntil(async () => (await live.textContent()) !== first, "another tile announced");
      await shot(page, "keyboard-map");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
