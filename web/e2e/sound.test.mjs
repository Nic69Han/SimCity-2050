// End-to-end: the sound button of the page. Muted by default ("Son : coupé"), turned on and off with
// the button ("Son : activé"), the sounds are fetched only once the player has turned them on, and
// a remembered choice waits for the first gesture before it loads anything. No error appears.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, openPage, assertNoErrors, waitForReady, pollUntil } from "./helpers.mjs";

const TIMEOUT = 60000;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

// Every request for a sound file, in the order the page made them.
function trackSounds(page) {
  const urls = [];
  page.on("request", (r) => {
    if (r.url().includes("/sounds/")) urls.push(r.url());
  });
  return urls;
}

const label = (page) => page.locator("#sound-toggle").textContent();

describe("sound button", () => {
  test("muted by default, turned on and off by the button, sounds fetched only when on", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const requests = trackSounds(page);
      await page.locator("#sound-controls").waitFor({ state: "visible" });
      assert.equal(await label(page), "Son : coupé");
      assert.equal(requests.length, 0, "no sound is fetched before the player turns sound on");

      await page.click("#sound-toggle");
      assert.equal(await label(page), "Son : activé");
      await pollUntil(async () => requests.length > 0, "the sound files to be fetched");
      assert.equal(await page.evaluate(() => localStorage.getItem("micropolis.sound")), "on");

      await page.click("#sound-toggle");
      assert.equal(await label(page), "Son : coupé");
      assert.equal(await page.evaluate(() => localStorage.getItem("micropolis.sound")), "off");

      assert.equal(await page.locator("#load-msg").textContent(), "");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a remembered choice loads its sounds at the first gesture, not at load", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      // the choice as an earlier visit left it (set directly: a click would start the downloads,
      // and a reload during them aborts those requests, which the page reports as errors)
      await page.evaluate(() => localStorage.setItem("micropolis.sound", "on"));

      const requests = trackSounds(page);
      await page.reload();
      await waitForReady(page);
      await page.locator("#sound-controls").waitFor({ state: "visible" });
      assert.equal(await label(page), "Son : activé", "the choice is remembered");
      assert.equal(requests.length, 0, "nothing is fetched before a gesture");

      await page.locator("h1").click(); // a gesture of the player, not on the button
      await pollUntil(async () => requests.length > 0, "the sound files to be fetched after a gesture");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
