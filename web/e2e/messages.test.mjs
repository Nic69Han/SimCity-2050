// End-to-end: the engine's messages reach the news ticker of the page, in French, with the date
// and the place, on the real wasm engine. The provoked message: zones built with no power plant
// (NEED_ELECTRICITY: more than ten zoned people and no power), then the city plays until the
// ticker lists it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { MESSAGE_TEXT } from "../messages-text.js";
import { MONTHS } from "../status.js";
import {
  launchBrowser, openPage, assertNoErrors, waitForReady, newCity, selectTool, clickTile,
  setSlider, pollUntil, shot,
} from "./helpers.mjs";

const TIMEOUT = 180000;
const SEED = 1;
const FRENCH = new Set(Object.values(MESSAGE_TEXT));

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

/** The ticker's rows: { text, date } of every item shown, newest first. */
async function ticker(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("#messages-list .msg-item")].map((li) => ({
      text: li.querySelector(".msg-text")?.textContent ?? "",
      date: li.querySelector(".msg-date")?.textContent ?? "",
      located: li.querySelector(".msg-locate") !== null,
    })));
}

describe("messages reach the page", () => {
  test("zones without power are reported in French in the ticker, with the date", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await waitForReady(page);
      // The ticker is there, empty, before any message.
      assert.equal(await page.locator("#messages-panel").isVisible(), true, "the panel is shown");
      assert.match(await page.locator("#messages-panel .msg-empty").textContent(), /Aucun message/);

      await newCity(page, String(SEED));
      await selectTool(page, "residential");
      // Zones on a grid across the middle of the map (water and trees refuse some clicks).
      for (let x = 30; x <= 60; x += 3) {
        for (let y = 30; y <= 60; y += 3) await clickTile(page, x, y);
      }
      await setSlider(page, "#speed", 3);
      await page.click("#play");
      await pollUntil(async () => (await ticker(page)).length > 0, "a message in the ticker", 150000);
      await page.click("#play"); // pause: the rows read below are the ones of this moment

      const rows = await ticker(page);
      await shot(page, "messages-ticker");
      assert.ok(rows.length > 0, "the ticker lists the messages");
      for (const row of rows) {
        assert.ok(FRENCH.has(row.text), `a French sentence of the table: "${row.text}"`);
      }
      const [first] = rows;
      assert.match(first.date, /^\S+ 19\d\d$/, `the in-game date: "${first.date}"`);
      assert.ok(MONTHS.includes(first.date.split(" ")[0]), `a month of the status line: "${first.date}"`);

      // The live region announces the newest items politely.
      const announce = page.locator("#messages-panel .msg-announce");
      assert.equal(await announce.getAttribute("aria-live"), "polite");
      assert.ok((await announce.textContent()).includes(first.text), "the announcement has the newest message");

      // A message with a place can be shown on the map.
      const located = rows.find((r) => r.located);
      if (located) {
        await page.locator("#messages-list .msg-locate").first().click();
        assert.equal(await page.locator("#map-frame .msg-flash").isVisible(), true, "the map shows the place");
      }
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
