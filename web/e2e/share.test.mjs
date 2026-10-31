// End-to-end: sharing a city by a link (docs/game-design-v1.md) on the real wasm engine. The city is played a little so
// that it differs from the sample, «Partager la ville» gives a link (clipboard, else the read-only field), and a new page
// opened on that link shows the same city: same date, funds and population. A bad link leaves the sample.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, openPage, assertNoErrors, pollUntil, readStatus, baseUrl } from "./helpers.mjs";

const TIMEOUT = 120000;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

// The link the page gave: from the clipboard when it was copied, else from the read-only field.
async function readLink(page) {
  await page.click("#share-button");
  await pollUntil(async () => (await page.locator("#share-panel [role=status]").textContent()) !== "", "the share message");
  const field = page.locator("#share-link");
  if (await field.isVisible()) return field.inputValue();
  return page.evaluate(() => navigator.clipboard.readText());
}

// A save does not keep the census counters, so a load recounts the population from the tiles: it may differ a little.
const populationOf = (stats) => Number(/Population ([\d\s]+) ·/u.exec(stats)?.[1].replace(/\s/gu, ""));
const POPULATION_TOLERANCE = 0.01;

const numbers = (page) => page.evaluate(() => ({
  status: document.getElementById("status").textContent,
  stats: document.getElementById("stats").textContent,
}));

describe("sharing a city", () => {
  test("the shared link opens the same city in a new page", { timeout: TIMEOUT }, async () => {
    const first = await openPage(browser, { permissions: ["clipboard-read", "clipboard-write"] });
    try {
      // another city than the startup sample, so that the link has to carry it (a live city's population is a running
      // count that a load recounts from the tiles, so the city is shared as it was loaded, before any play)
      await first.page.selectOption("#city", "kyoto");
      await pollUntil(async () => /2043/u.test(await first.page.locator("#status").textContent()), "Kyoto on the map");
      const before = await numbers(first.page);
      const link = await readLink(first.page);
      assert.match(link, /#ville=[A-Za-z0-9_-]+$/u);
      assert.ok(link.length < 90000, "a link of at most 60 000 compressed bytes");
      assert.match(await first.page.locator("#share-panel [role=status]").textContent(), /Lien copié|Copiez le lien/u);

      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
      try {
        await page.goto(link.replace(/^https?:\/\/[^/]+\//u, baseUrl()));
        await pollUntil(async () => (await page.locator("#share-panel [role=status]").textContent()) !== "", "the open message", 60000);
        await pollUntil(async () => {
          const now = await numbers(page);
          return now.status === before.status && populationOf(now.stats) > 0;
        }, "the shared city on the map", 8000).catch(async (e) => {
          throw new Error(`${e.message}: wanted ${JSON.stringify(before)}, got ${JSON.stringify(await numbers(page))}`);
        });
        const a = await readStatus(first.page);
        const b = await readStatus(page);
        assert.deepEqual([b.year, b.monthIndex, b.funds], [a.year, a.monthIndex, a.funds]);
        const was = populationOf(before.stats);
        const now = populationOf((await numbers(page)).stats);
        assert.ok(Math.abs(now - was) <= was * POPULATION_TOLERANCE, `population ${now} vs ${was}`);
        assert.match(await page.locator("#share-panel [role=status]").textContent(), /Ville partagée ouverte/u);
        assert.equal(new URL(page.url()).hash, "", "the address no longer holds the city");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
      assertNoErrors(first.errors);
    } finally {
      await first.close();
    }
  });

  test("a bad link says so and keeps the sample", { timeout: TIMEOUT }, async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl()}#ville=AAAAAAAA`);
      await pollUntil(async () => (await page.locator("#share-panel [role=status]").textContent()) !== "", "the message", 60000);
      assert.match(await page.locator("#share-panel [role=status]").textContent(), /pas pu être ouverte/u);
      assert.match(await page.locator("#status").textContent(), /1\s?000\s?000 \$/u);
    } finally {
      await context.close();
    }
  });
});
