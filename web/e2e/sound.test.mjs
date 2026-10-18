// End-to-end: the sound button of the page. Muted by default ("Son : coupé"), turned on and off with
// the button ("Son : activé"), the sounds are fetched only once the player has turned them on, and
// a remembered choice waits for the first gesture before it loads anything. No error appears.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, waitForReady, pollUntil, readMap, findRun, findTile, selectTool, clickTile, newCity,
  WATER_LABEL, DIRT_LABEL,
} from "./helpers.mjs";

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

// Test mode: the address ends in ?soundlog=1, and the page lists in window.__soundLog the key of every
// sound it starts (sound.js). The sounds are decoded asynchronously after the button press, so a build is
// repeated on fresh tiles until the first one is heard.
describe("tool sounds", () => {
  const soundLog = (page) => page.evaluate(() => globalThis.__soundLog ?? null);

  test("muted: a road is built in silence; sound on: the build sound plays; a refusal sounds too", { timeout: 90000 }, async () => {
    const { page, errors, close } = await openPage(browser, { query: "?soundlog=1" });
    try {
      assert.deepEqual(await soundLog(page), [], "the log exists in test mode and starts empty");
      await newCity(page, "42"); // a fresh city: bare land and a lake for sure
      await pollUntil(async () => (await page.locator("#status").textContent()).includes("Graine 42"), "the new city");
      const map = await readMap(page);
      const run = findRun(map, DIRT_LABEL, 8); // 8 bare tiles in a row: one road tile per attempt
      const dirt = run?.[0];
      const water = findTile(map, WATER_LABEL);
      assert.ok(run && water, "a bare tile and a water tile in the sample");

      await selectTool(page, "road");
      await clickTile(page, dirt.x, dirt.y);
      assert.deepEqual(await soundLog(page), [], "muted: nothing plays");

      await page.click("#sound-toggle");
      assert.equal(await label(page), "Son : activé");
      let next = 1;
      await pollUntil(async () => {
        const t = run[Math.min(next++, run.length - 1)];
        await clickTile(page, t.x, t.y);
        return (await soundLog(page)).includes("build");
      }, "the build sound to be played once the sounds are decoded", 30000);

      await selectTool(page, "road");
      await pollUntil(async () => {
        await clickTile(page, water.x, water.y); // a road cannot go on water: refused
        return (await soundLog(page)).includes("refused");
      }, "the refusal sound to be played", 30000);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("without ?soundlog=1 the page exposes no log", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      assert.equal(await soundLog(page), null);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
