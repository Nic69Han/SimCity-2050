// End-to-end: the page as a visitor sees it: first load, keyboard, phone width.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { TOOL_LABELS } from "../tools.js";
import { extraCatalog } from "../extra-tools.js";

// The extra tools (relief, water, metro...) come from their modules, not from TOOL_LABELS. An
// engine that answers every method stands for the real one, which has them all.
const EVERY_METHOD = new Proxy({}, { get: () => () => 0 });
const EXTRA = extraCatalog(EVERY_METHOD);
const EXTRA_LABELS = Object.fromEntries(EXTRA.map((t) => [t.key, t.label]));
const EXTRA_COST_TEXT = Object.fromEntries(EXTRA.map((t) => [t.key, t.costText]));
// the 20 building tools of the engine, then the extra tools
const PALETTE_SIZE = 20 + EXTRA.length;
import {
  launchBrowser, openPage, assertNoErrors, readStatus, readPalette, shot, mapDigest, pollUntil,
  baseUrl,
} from "./helpers.mjs";

const TIMEOUT = 60000;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

describe("the page", () => {
  test("(a) loads the sample city with a date, funds and the palette of French tools (20 building tools and the extra tools)", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const status = await readStatus(page);
      assert.notEqual(status.monthIndex, -1, `a month name: ${status.text}`);
      assert.ok(status.year >= 1900, `a year: ${status.text}`);
      assert.equal(status.seed, null, "a sample city has no seed");
      assert.ok(status.funds > 0, "funds are shown");
      assert.equal(await page.inputValue("#city"), "haight", "the sample selector shows Haight-Ashbury");

      const palette = await readPalette(page);
      assert.equal(palette.length, PALETTE_SIZE, "20 building tools and the extra tools");
      assert.equal(new Set(palette.map((p) => p.key)).size, PALETTE_SIZE, "each tool once");
      for (const p of palette) {
        assert.equal(p.label, TOOL_LABELS[p.key] ?? EXTRA_LABELS[p.key], `French label for ${p.key}`);
        assert.ok(p.cost.endsWith("$") || p.cost === "gratuit" || p.cost === EXTRA_COST_TEXT[p.key], `cost shown for ${p.key}: ${p.cost}`);
        assert.equal(p.pressed, false, "no tool selected at start");
      }
      assert.ok((await page.locator("#legend li").count()) > 5, "the colour legend is filled");
      assert.equal(await page.locator("#palette").isVisible(), true);
      await shot(page, "a-loaded");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(h) keyboard shortcuts select a tool and Échap clears it", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const pressed = async () => (await readPalette(page)).filter((p) => p.pressed).map((p) => p.key);
      await page.keyboard.press("r");
      assert.deepEqual(await pressed(), ["road"]);
      await page.keyboard.press("b");
      assert.deepEqual(await pressed(), ["bulldozer"]);
      await page.keyboard.press("1");
      assert.deepEqual(await pressed(), ["residential"]);
      await page.keyboard.press("Escape");
      assert.deepEqual(await pressed(), []);
      // a key bound to no tool changes nothing
      await page.keyboard.press("x");
      assert.deepEqual(await pressed(), []);
      // while the seed box has the focus, letters are typed text, not shortcuts
      await page.click("#seed");
      await page.keyboard.press("r");
      assert.deepEqual(await pressed(), [], "no tool from a letter typed in the seed box");
      assert.equal(await page.inputValue("#seed"), "r");
      await page.fill("#seed", "");
      // the shortcut help lists the keys
      const help = await page.locator("#shortcuts").textContent();
      assert.match(help, /Échap/);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(a2) choosing another sample city in the selector loads it", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const haight = await mapDigest(page);
      await page.selectOption("#city", "kyoto");
      await page.waitForFunction(() => document.getElementById("status").textContent.includes("Kyoto") === false &&
        document.getElementById("status").textContent.includes("·"));
      await pollUntil(async () => (await mapDigest(page)) !== haight, "the Kyoto map to be drawn");
      assert.equal(await page.locator("#tool-msg").textContent(), "");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(a3) while the sample loads, the status line says Chargement… (no numbers of an empty city)", { timeout: TIMEOUT }, async () => {
    const context = await browser.newContext({ locale: "fr-FR" });
    const page = await context.newPage();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/cities/haight.cty", async (route) => {
      await gate;
      await route.continue();
    });
    try {
      await page.goto(baseUrl());
      await page.waitForFunction(() => document.querySelectorAll("#palette button.tool").length > 0);
      assert.equal(await page.locator("#status").textContent(), "Chargement…");
      assert.equal(await page.locator("#stats").textContent(), "", "no population of an empty city either");
      assert.equal(await page.locator("#play").isDisabled(), true, "nothing to play before a city exists");
      // once the sample arrives, the status line shows its date and funds, and only then
      release();
      await page.waitForFunction(() => document.getElementById("status").textContent.includes("$"));
      assert.equal((await readStatus(page)).funds, 1000000, "the sample's funds");
      assert.equal(await page.locator("#play").isDisabled(), false);
    } finally {
      release();
      await context.close();
    }
  });

  test("(j) at 390 px wide: no horizontal page scroll, palette buttons on screen and usable", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      assert.ok(overflow.scroll <= overflow.client, `no horizontal scroll: ${JSON.stringify(overflow)}`);

      const boxes = await page.$$eval("#palette button.tool", (els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { key: el.dataset.tool, left: r.left, right: r.right, width: r.width, height: r.height };
        }));
      assert.equal(boxes.length, PALETTE_SIZE);
      for (const b of boxes) {
        assert.ok(b.left >= 0 && b.right <= 390, `${b.key} fits the width: ${b.left}..${b.right}`);
        // WCAG 2.2 AA target size (24 px minimum)
        assert.ok(b.height >= 24, `${b.key} is at least 24 px tall (${b.height})`);
      }
      const canvas = await page.locator("#map").boundingBox();
      assert.ok(canvas.x >= 0 && canvas.x + canvas.width <= 390, "the map fits the width");

      // a palette button is usable by touch
      await page.locator('#palette button.tool[data-tool="road"]').tap();
      assert.deepEqual((await readPalette(page)).filter((p) => p.pressed).map((p) => p.key), ["road"]);
      await shot(page, "j-phone");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
