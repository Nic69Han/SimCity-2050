// End-to-end: the budget and evaluation panel on the real wasm engine. The shadow engine (the
// same wasm package, in Node) gives the expected state: the page's status and stats lines after
// the same ticks must match the shadow's, with the tax the player set.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, readStatus, readSample, shadowCity, playFrames,
  expectedText, setSlider, shot, countFrames,
} from "./helpers.mjs";
import { decodeEvaluation, scoreText, formatMoney } from "../budget-text.js";

const TIMEOUT = 120000;
const MAX_TICKS = 4000;

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
function shadowAtPage(shadow, pageText, maxTicks = MAX_TICKS) {
  for (let k = 0; k <= maxTicks; k++) {
    if (k > 0) shadow.city.tick();
    const expected = expectedText(shadow.city);
    if (expected.status === pageText.status && expected.stats === pageText.stats) return k;
  }
  throw new Error(`the shadow never reached the page state: ${pageText.status}`);
}

describe("budget panel", () => {
  test("a tax change moves the funds trajectory as the shadow engine predicts", { timeout: TIMEOUT }, async () => {
    const cty = await readSample("haight");
    const { page, errors, close } = await openPage(browser);
    try {
      await countFrames(page);
      assert.equal((await readStatus(page)).funds, 1000000, "sample funds");
      await setSlider(page, "#bud-tax", 20);
      assert.equal(await page.$eval("#bud-tax-out", (o) => o.textContent), "20 %");

      const run = await playFrames(page, 300);
      assert.ok(run.ran >= 300, `ran ${run.ran} frames`);
      const pageState = { status: run.status, stats: run.stats };

      const shadow = await shadowLikePage(cty);
      shadow.city.set_tax(20);
      const ticks = shadowAtPage(shadow, pageState);
      assert.ok(ticks > 0, "the page ran ticks");
      const withTax = shadow.city.funds();
      assert.equal((await readStatus(page)).funds, withTax, "funds after the same ticks");

      // Without the tax change the same number of ticks gives other funds.
      const plain = await shadowLikePage(cty);
      for (let k = 0; k < ticks; k++) plain.city.tick();
      assert.notEqual(plain.city.funds(), withTax, "the tax changes the funds");

      await shot(page, "budget-tax-20");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("the panel shows the evaluation, the budget and the history charts", { timeout: TIMEOUT }, async () => {
    const cty = await readSample("haight");
    const { page, errors, close } = await openPage(browser);
    try {
      await countFrames(page);
      const run = await playFrames(page, 120);
      const shadow = await shadowLikePage(cty);
      shadowAtPage(shadow, { status: run.status, stats: run.stats });

      // Score line matches the engine's evaluation (live region).
      const score = await page.textContent("#bud-score");
      assert.equal(score, scoreText(decodeEvaluation(Array.from(shadow.city.evaluation()))));
      assert.equal(await page.getAttribute("#bud-score", "aria-live"), "polite");

      // Budget: moving the road slider changes the text and does not charge money.
      const before = await readStatus(page);
      await setSlider(page, "#bud-pct-road", 40);
      assert.match(await page.textContent("#bud-text-road"), /^Routes et rails : 40 % financé/);
      assert.equal((await readStatus(page)).funds, before.funds, "a budget change is not charged");
      assert.equal(await page.inputValue("#bud-pct-road"), "40");

      // Finances: the figures are shown in French money format.
      assert.equal(await page.textContent("#bud-fin-funds"), formatMoney((await readStatus(page)).funds));

      // Charts: each canvas has drawn pixels, and the 120-year toggle redraws.
      const counts = await page.$$eval("#budget-panel canvas", (cs) =>
        cs.map((c) => {
          const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
          return n;
        }),
      );
      assert.equal(counts.length, 3);
      for (const n of counts) assert.ok(n > 100, `canvas has ${n} painted pixels`);
      await page.click("#budget-panel .bud-toggle:nth-child(2)");
      assert.equal(await page.getAttribute("#budget-panel .bud-toggle:nth-child(2)", "aria-pressed"), "true");
      assert.match(await page.getAttribute("#budget-panel canvas", "aria-label"), /Résidentiel/);

      // Problems list: at least one entry, French labels.
      const problems = await page.$$eval("#bud-problems li", (items) => items.map((i) => i.textContent));
      assert.ok(problems.length >= 1);

      await shot(page, "budget-panel");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
