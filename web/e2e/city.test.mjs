// End-to-end: new cities (seeds), play and pause, save and open a .cty file.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import {
  launchBrowser, openPage, assertNoErrors, newCity, readStatus, readToolMessage, mapDataUrl,
  selectTool, clickTile, findBlock, readMap, shot, pollUntil, DIRT_LABEL, START_FUNDS,
} from "./helpers.mjs";

const TIMEOUT = 90000;
const CTY_BYTES = 27120; // size of the sample cities, and of a saved one

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

describe("cities", () => {
  test("(f) the same seed gives the same map; another seed gives another; funds start at 20 000", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, "4242");
      const first = await readStatus(page);
      const mapA = await mapDataUrl(page);
      assert.equal(first.seed, 4242);
      assert.equal(first.funds, START_FUNDS);

      await newCity(page, "4242");
      const again = await readStatus(page);
      assert.equal(await mapDataUrl(page), mapA, "same seed: identical canvas pixels");
      assert.equal(again.funds, START_FUNDS);

      await newCity(page, "4243");
      const other = await readStatus(page);
      assert.equal(other.seed, 4243);
      assert.equal(other.funds, START_FUNDS);
      assert.notEqual(await mapDataUrl(page), mapA, "another seed: another map");

      // Enter in the seed box makes the city too
      await page.fill("#seed", "4244");
      await page.press("#seed", "Enter");
      assert.equal((await readStatus(page)).seed, 4244, "Enter starts the city");
      await newCity(page, "4243");

      // a bad seed is refused, the city stays
      const mapB = await mapDataUrl(page);
      await newCity(page, "12a");
      assert.equal(await page.locator("#new-msg").textContent(), "Graine invalide : entrer un nombre entier");
      assert.equal(await mapDataUrl(page), mapB, "no new city for a bad seed");
      assert.equal((await readStatus(page)).seed, 4243);

      // an empty seed picks a random one, shown in the status line
      await page.fill("#seed", "");
      await page.click("#newcity-btn");
      const random = await readStatus(page);
      assert.ok(Number.isInteger(random.seed) && random.seed > 0, `a random seed is shown: ${random.text}`);
      assert.equal(await page.locator("#new-msg").textContent(), "");
      await shot(page, "f-new-city");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(g) Lecture advances the date; Pause stops it", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const dateOf = async () => {
        const s = await readStatus(page);
        return `${s.month} ${s.year}`;
      };
      const start = await dateOf();
      await page.click("#play");
      assert.equal(await page.locator("#play").getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#play").textContent(), "⏸ Pause");

      // about two seconds of play: the date must have moved on (at speed 2 it moves about
      // once a second); the time it took is kept for the pause check below
      const began = Date.now();
      await page.waitForTimeout(2000);
      const seconds = (Date.now() - began) / 1000;
      await pollUntil(async () => (await dateOf()) !== start, "the date to change while playing", 20000);
      console.log(`    date now ${await dateOf()} (started ${start}), after ${seconds.toFixed(1)} s of play`);

      await page.click("#play");
      assert.equal(await page.locator("#play").getAttribute("aria-pressed"), "false");
      assert.equal(await page.locator("#play").textContent(), "▶ Lecture");
      // let an animation frame already scheduled run out, then the date must not move
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const paused = await dateOf();
      const pausedFunds = (await readStatus(page)).funds;
      await page.waitForTimeout(Math.max(2000, seconds * 1000 * 1.5));
      assert.equal(await dateOf(), paused, "the date stays while paused");
      assert.equal((await readStatus(page)).funds, pausedFunds);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  // BUG (web/main.js, setPlaying): each Lecture schedules a new animation-frame loop and
  // Pause only clears `playing`, so Lecture, Pause, Lecture within one frame leaves two loops
  // running: the city then runs at double speed. Found by this test; kept as a TODO until the
  // page cancels the pending frame (e.g. keep the frame id and cancelAnimationFrame it).
  test("(g2) Lecture, Pause, Lecture within one frame runs one loop, not two", {
    timeout: TIMEOUT,
    todo: "page bug in web/main.js setPlaying: a second frame loop starts while the first is pending",
  }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await page.evaluate(() => {
        window.__frames = 0;
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (cb) => {
          window.__frames++;
          return raf(cb);
        };
      });
      const framesIn = (ms) => page.evaluate((m) => new Promise((resolve) => {
        const start = window.__frames;
        setTimeout(() => resolve(window.__frames - start), m);
      }), ms);
      await page.evaluate(() => {
        const b = document.getElementById("play");
        b.click();
        b.click();
        b.click();
      });
      assert.equal(await page.locator("#play").textContent(), "⏸ Pause");
      const doubled = await framesIn(1000);
      await page.click("#play"); // Pause
      await page.waitForTimeout(200);
      await page.click("#play"); // Lecture, one loop
      const single = await framesIn(1000);
      assert.ok(single > 0, "the city plays");
      assert.ok(doubled < single * 1.5, `frames requested per second: ${doubled} after the fast toggles, ${single} for one loop`);
      await page.click("#play");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(l) a file that is not a .cty shows an error and leaves the city as it was", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, "4242");
      const map = await mapDataUrl(page);
      const funds = (await readStatus(page)).funds;
      await page.setInputFiles("#file", { name: "bad.cty", mimeType: "application/octet-stream", buffer: Buffer.from("not a city") });
      await pollUntil(async () => (await page.locator("#status").textContent()).startsWith("Erreur"), "the error message");
      assert.equal(await mapDataUrl(page), map, "the map is unchanged");
      await shot(page, "l-bad-file");
      assert.ok(funds > 0);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  // BUG (web/main.js, load): the error replaces the whole status line, so the date and funds
  // disappear until the next redraw. Kept as a TODO (the test runs, its failure is reported).
  test("(l2) after a refused file the status line still shows the date and funds", {
    timeout: TIMEOUT,
    todo: "page bug in web/main.js load(): the error message replaces the date and funds on the status line",
  }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, "4242");
      await page.setInputFiles("#file", { name: "bad.cty", mimeType: "application/octet-stream", buffer: Buffer.from("not a city") });
      await pollUntil(async () => (await page.locator("#status").textContent()).startsWith("Erreur"), "the error message");
      assert.match(await page.locator("#status").textContent(), /\d\s*\$$/u, "the funds are still shown");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(k) Enregistrer downloads a 27 120-byte .cty; opening it again restores the saved funds and map", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, "4242");
      const savedFunds = (await readStatus(page)).funds;
      const savedMap = await mapDataUrl(page);

      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
      assert.equal(download.suggestedFilename(), "city.cty");
      const path = await download.path();
      assert.equal((await stat(path)).size, CTY_BYTES, "a .cty of 27 120 bytes");

      // change the city: one road on dry land, so the funds move
      const map = await readMap(page);
      const dirt = findBlock(map, DIRT_LABEL, 1);
      await selectTool(page, "road");
      await clickTile(page, dirt.x, dirt.y);
      assert.ok((await readStatus(page)).funds < savedFunds, "the city changed");

      // open the saved file through the file input
      await page.setInputFiles("#file", path);
      await pollUntil(async () => (await readStatus(page)).funds === savedFunds, "the saved funds to come back");
      assert.equal(await readToolMessage(page), "");
      assert.equal(await mapDataUrl(page), savedMap, "the saved map is back");
      assert.equal((await readStatus(page)).seed, null, "a loaded city has no seed");
      await shot(page, "k-reopened");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
