// End-to-end: the ordinances panel on the real wasm engine. The shadow engine (the same wasm
// package, in Node) gives the expected numbers: the cost the panel shows is the engine's, and
// after the same ticks the funds of the page equal those of a shadow with the same ordinance on
// and are lower than those of a shadow without it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, readStatus, readSample, shadowCity, playFrames,
  expectedText, shot, countFrames,
} from "./helpers.mjs";

const TIMEOUT = 120000;
const MAX_TICKS = 4000;
const norm = (s) => s.replace(/[\u00a0\u202f]/g, " ");
/** 1200 -> "1 200": the page's grouping, after norm(). */
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

/** The shadow gets the settings the page applies on load: speed 2, catastrophes off. */
async function shadowLikePage(cty) {
  const shadow = await shadowCity({ cty });
  shadow.city.set_speed(2);
  shadow.city.enable_disasters(false);
  return shadow;
}

/** Advances the shadow until its status and stats lines equal the page's (or fails). */
function shadowAtPage(shadow, pageText) {
  for (let k = 0; k <= MAX_TICKS; k++) {
    if (k > 0) shadow.city.tick();
    const expected = expectedText(shadow.city);
    if (expected.status === pageText.status && expected.stats === pageText.stats) return k;
  }
  throw new Error(`the shadow never reached the page state: ${pageText.status}`);
}

describe("ordinances panel", () => {
  test("lists the eight ordinances, off, with their costs and effects", { timeout: TIMEOUT }, async () => {
    const cty = await readSample("haight");
    const shadow = await shadowLikePage(cty);
    const { page, errors, close } = await openPage(browser);
    try {
      assert.equal(await page.isVisible("#ordinances-panel"), true);
      assert.equal(await page.textContent("#ordinances-panel h2"), "Ordonnances");
      const boxes = await page.$$("#ordinances-panel input[type=checkbox]");
      assert.equal(boxes.length, 8);
      for (const box of boxes) assert.equal(await box.isChecked(), false);
      assert.equal(norm(await page.textContent("#ord-total")), "Aucune ordonnance en vigueur.");

      // Row 0: name, the engine's cost for the sample, and the effect line.
      const cost = shadow.city.ordinance_info(0)[0];
      const row = norm(await page.textContent("#ordinances-panel li:first-child"));
      assert.match(row, /Police de proximité/);
      assert.ok(row.includes(`${grouped(cost)} $ par an`), row);
      assert.match(row, /Criminalité −15 %/);
      // Labels are tied to their checkboxes.
      assert.equal(await page.textContent("label[for=ord-community_policing]"), "Police de proximité");
      await shot(page, "ordinances-panel");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("ticking one shows the cost and lowers the funds after a stretch of play", { timeout: TIMEOUT }, async () => {
    const cty = await readSample("haight");
    const { page, errors, close } = await openPage(browser);
    try {
      await countFrames(page);
      const shadowInfo = await shadowLikePage(cty);
      const cost = shadowInfo.city.ordinance_info(0)[0];
      await page.check("#ord-community_policing");
      assert.equal(await page.isChecked("#ord-community_policing"), true);
      assert.equal(norm(await page.textContent("#ord-total")), `Coût total : ${grouped(cost)} $ par an (1 en vigueur).`);

      const run = await playFrames(page, 300);
      assert.ok(run.ran >= 300, `ran ${run.ran} frames`);
      const pageState = { status: run.status, stats: run.stats };

      const withOrdinance = await shadowLikePage(cty);
      withOrdinance.city.set_ordinance(0, true);
      const ticks = shadowAtPage(withOrdinance, pageState);
      assert.ok(ticks > 0, "the page ran ticks");
      assert.equal((await readStatus(page)).funds, withOrdinance.city.funds(), "funds as the engine with the ordinance");

      const without = await shadowLikePage(cty);
      for (let k = 0; k < ticks; k++) without.city.tick();
      assert.ok(
        withOrdinance.city.funds() < without.city.funds(),
        `funds ${withOrdinance.city.funds()} < ${without.city.funds()} after ${ticks} ticks`,
      );
      assert.equal(await page.isChecked("#ord-community_policing"), true, "still on while playing");
      await shot(page, "ordinances-on");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a loaded city shows the engine's set, not the page's earlier choice", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await page.check("#ord-recycling");
      await page.check("#ord-curfew");
      assert.match(norm(await page.textContent("#ord-total")), /\(2 en vigueur\)/);
      // Another sample: the load replaces the city and its ordinances (none in the file).
      const loaded = page.waitForResponse((r) => r.url().endsWith("/cities/kyoto.cty"));
      await page.selectOption("#city", "kyoto");
      await loaded;
      await page.waitForFunction(() => !document.querySelector("#ord-recycling").checked);
      for (const box of await page.$$("#ordinances-panel input[type=checkbox]")) {
        assert.equal(await box.isChecked(), false);
      }
      assert.equal(norm(await page.textContent("#ord-total")), "Aucune ordonnance en vigueur.");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
