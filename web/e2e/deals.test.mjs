// End-to-end: the deals panel on the real wasm engine. The shadow engine (the same wasm package, in
// Node) gives the expected numbers: the offers the panel shows are the engine's, and after the same
// ticks the funds of the page equal those of a shadow with the same deal.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, readStatus, readSample, shadowCity, playFrames,
  expectedText, shot, countFrames,
} from "./helpers.mjs";

const TIMEOUT = 120000;
const MAX_TICKS = 4000;
const norm = (s) => s.replace(/[  ]/g, " ");

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

describe("deals panel", () => {
  test("the rule is off at first; turning it on lists the engine's offers and surplus", { timeout: TIMEOUT }, async () => {
    const cty = await readSample("haight");
    const shadow = await shadowLikePage(cty);
    shadow.city.set_deals_rules(true);
    const { page, errors, close } = await openPage(browser);
    try {
      assert.equal(await page.isVisible("#deals-panel"), true);
      assert.equal(await page.textContent("#deals-panel h2"), "Accords avec les voisins");
      assert.equal(await page.isChecked("#deals-rules"), false);
      assert.equal(await page.isVisible("#deal-offers"), false, "nothing on the table with the rule off");

      await page.check("#deals-rules");
      await page.waitForSelector("#deal-offers li");
      const rows = await page.$$("#deal-offers li");
      assert.equal(rows.length, 8);
      const expected = Array.from(shadow.city.surplus());
      assert.match(norm(await page.textContent("#deal-surplus")), new RegExp(`électricité ${String(expected[0]).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} unités`));
      const first = norm(await rows[0].textContent());
      assert.match(first, /Valmont \(nord\) · Électricité/);
      const offer = Array.from(shadow.city.deal_offers()).slice(0, 6);
      assert.ok(first.includes(`Recette : ${String(offer[4]).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} $ par an`), first);
      assert.equal(await page.isEnabled("#deal-offers li:first-child button"), true);
      assert.equal(norm(await page.textContent("#deal-total")), "Aucun accord en cours.");
      await shot(page, "deals-offers");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("signing an electricity deal lists it, pays at the collection like the engine, and cancelling removes it", { timeout: TIMEOUT }, async () => {
    const cty = await readSample("haight");
    const { page, errors, close } = await openPage(browser);
    try {
      await countFrames(page);
      await page.check("#deals-rules");
      await page.waitForSelector("#deal-offers li");
      await page.click("#deal-offers li:first-child button");
      await page.waitForSelector("#deal-active li");
      const row = norm(await page.textContent("#deal-active li"));
      assert.match(row, /Valmont \(nord\) · Électricité/);
      assert.match(row, /Honoré/);
      assert.match(norm(await page.textContent("#deal-total")), /\(1 en cours\)/);
      assert.equal(await page.textContent("#deal-notice"), "Accord signé.");
      assert.equal(await page.isEnabled("#deal-offers li:first-child button"), false, "already signed");

      const run = await playFrames(page, 300);
      assert.ok(run.ran >= 300, `ran ${run.ran} frames`);
      const withDeal = await shadowLikePage(cty);
      withDeal.city.set_deals_rules(true);
      assert.equal(withDeal.city.accept_deal(0), 1);
      const ticks = shadowAtPage(withDeal, { status: run.status, stats: run.stats });
      assert.ok(ticks > 0, "the page ran ticks");
      assert.equal((await readStatus(page)).funds, withDeal.city.funds(), "funds as the engine with the deal");
      await shot(page, "deals-signed");

      await page.click("#deal-active li button");
      await page.waitForFunction(() => document.querySelectorAll("#deal-active li").length === 0);
      assert.equal(await page.textContent("#deal-notice"), "Accord résilié.");
      assert.equal(norm(await page.textContent("#deal-total")), "Aucun accord en cours.");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a loaded city shows the engine's rule, not the page's earlier choice", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await page.check("#deals-rules");
      await page.waitForSelector("#deal-offers li");
      const loaded = page.waitForResponse((r) => r.url().endsWith("/cities/kyoto.cty"));
      await page.selectOption("#city", "kyoto");
      await loaded;
      await page.waitForFunction(() => !document.querySelector("#deals-rules").checked);
      assert.equal(await page.isVisible("#deal-offers"), false);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
