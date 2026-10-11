// End-to-end: new cities (seeds), play and pause, save and open a .cty file.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import {
  launchBrowser, openPage, assertNoErrors, newCity, readStatus, readToolMessage, mapDataUrl,
  selectTool, clickTile, findBlock, readMap, shot, pollUntil, DIRT_LABEL, START_FUNDS,
  countFrames, readSample, shadowCity,
} from "./helpers.mjs";
import { tileColor } from "../palette.js";

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

  test("(g2) Lecture, Pause, Lecture within one frame runs one loop, not two (no double speed)", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await countFrames(page);
      const framesIn = async (ms) => {
        const from = await page.evaluate(() => window.__frames);
        await page.waitForTimeout(ms);
        return (await page.evaluate(() => window.__frames)) - from;
      };
      // three toggles in one task: Lecture, Pause, Lecture (no frame runs between them)
      await page.evaluate(() => {
        const b = document.getElementById("play");
        b.click();
        b.click();
        b.click();
      });
      assert.equal(await page.locator("#play").textContent(), "⏸ Pause");
      const afterToggles = await framesIn(1000);
      await page.click("#play"); // Pause
      await page.waitForTimeout(200);
      assert.equal(await framesIn(300), 0, "no frame runs while paused");
      await page.click("#play"); // Lecture: one loop
      const single = await framesIn(1000);
      await page.click("#play");
      assert.ok(single > 0, "the city plays");
      assert.ok(afterToggles < single * 1.5,
        `frames run per second: ${afterToggles} after the fast toggles, ${single} for one loop`);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(l) a file that is not a .cty shows an error in its own line and leaves the city as it was", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, "4242");
      const map = await mapDataUrl(page);
      const funds = (await readStatus(page)).funds;
      await page.setInputFiles("#file", { name: "bad.cty", mimeType: "application/octet-stream", buffer: Buffer.from("not a city") });
      await pollUntil(async () => (await page.locator("#load-msg").textContent()).startsWith("Erreur"), "the error message");
      assert.equal(await mapDataUrl(page), map, "the map is unchanged");
      assert.equal((await readStatus(page)).funds, funds, "the funds are unchanged");
      await shot(page, "l-bad-file");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(l2) after a refused file the status line keeps the date and funds; the error is in #load-msg", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, "4242");
      const before = await page.locator("#status").textContent();
      await page.setInputFiles("#file", { name: "bad.cty", mimeType: "application/octet-stream", buffer: Buffer.from("not a city") });
      await pollUntil(async () => (await page.locator("#load-msg").textContent()).startsWith("Erreur"), "the error message");
      assert.equal(await page.locator("#status").textContent(), before, "the status line is untouched");
      assert.match(await page.locator("#status").textContent(), /\d\s*\$$/u, "the funds are still shown");
      assert.equal(await page.locator("#tool-msg").textContent(), "", "the tool message is not used for load errors");
      // a good file clears the error
      await page.setInputFiles("#file", { name: "city.cty", mimeType: "application/octet-stream", buffer: await readSample("kyoto") });
      await pollUntil(async () => (await page.locator("#load-msg").textContent()) === "", "the error to clear");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(n) the city selector names the city on the map: Ville aléatoire, Fichier local; a sample re-loads", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const selected = () => page.$eval("#city", (s) => s.options[s.selectedIndex].textContent);
      const haight = await mapDataUrl(page);
      assert.equal(await selected(), "Haight-Ashbury");

      // a new city: the selector says so (and keeps the samples in its list)
      await newCity(page, "4242");
      const random = await mapDataUrl(page);
      assert.equal(await selected(), "Ville aléatoire");
      assert.equal(await page.locator("#city option").count(), 4);

      // a sample: the map and the selector are that sample's again
      await page.selectOption("#city", "haight");
      await pollUntil(async () => (await mapDataUrl(page)) === haight, "the Haight-Ashbury map to come back");
      assert.equal(await selected(), "Haight-Ashbury");
      assert.equal(await page.locator("#city option").count(), 3, "the choice entry is gone");
      assert.equal((await readStatus(page)).funds, 1000000);
      assert.notEqual(random, haight);

      // a local file (the Kyoto sample's bytes): the selector says Fichier local, and the
      // date and funds are Kyoto's. (Pixels are not compared across loads: a city loaded after
      // another one can differ in a few tile words, see the report.)
      await page.selectOption("#city", "kyoto");
      await pollUntil(async () => (await mapDataUrl(page)) !== haight, "the Kyoto map");
      const kyotoStatus = await page.locator("#status").textContent();
      await page.selectOption("#city", "haight");
      await pollUntil(async () => (await page.locator("#status").textContent()) !== kyotoStatus, "Haight-Ashbury again");
      await page.setInputFiles("#file", { name: "kyoto.cty", mimeType: "application/octet-stream", buffer: await readSample("kyoto") });
      await pollUntil(async () => (await page.locator("#status").textContent()) === kyotoStatus, "the opened file's status");
      assert.equal(await selected(), "Fichier local");
      assert.equal(await page.locator("#load-msg").textContent(), "");
      // a sample chosen after a file loads it again
      await page.selectOption("#city", "haight");
      await pollUntil(async () => (await page.locator("#status").textContent()) !== kyotoStatus, "Haight-Ashbury after the file");
      assert.equal(await selected(), "Haight-Ashbury");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  // BUG (engine, crates/micropolis-core load_cty): a .cty loaded into an engine that holds another
  // city keeps some tile words of that city, so Kyoto after Haight-Ashbury differs from a fresh
  // engine's Kyoto in a few tiles. Kept as a TODO until the core is deterministic across loads.
  // The fresh reference is the shadow engine (same bytes, a new City); the page's pixels are read
  // per tile at the tile centre and compared with the palette colour of each tile word.
  test("(o) Kyoto loaded after Haight-Ashbury draws the same map as Kyoto in a fresh engine", {
    timeout: TIMEOUT,
    todo: "engine bug: load_cty depends on the previous city (a few Kyoto tiles differ), see the BUG comment",
  }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const haight = await mapDataUrl(page);
      await page.selectOption("#city", "kyoto");
      await pollUntil(async () => (await mapDataUrl(page)) !== haight, "the Kyoto map");
      const map = await readMap(page);

      const fresh = await shadowCity({ cty: await readSample("kyoto") });
      const { city } = fresh;
      const h = city.height();
      const tiles = city.tiles();
      const wrong = [];
      for (let x = 0; x < map.w; x++) {
        for (let y = 0; y < map.h; y++) {
          const want = tileColor(tiles[x * h + y]);
          const got = map.at(x, y).hex;
          if (want !== got) wrong.push(`${x},${y}: ${got} (fresh ${want})`);
        }
      }
      assert.deepEqual(wrong, [], `${wrong.length} tiles differ from a fresh engine's Kyoto`);
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
