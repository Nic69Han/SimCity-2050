// End-to-end: the detailed economy (docs/game-design-v11.md) on the real wasm engine. The sample city, the
// «Économie détaillée» switch, a tax rate changed in the table (the engine keeps it), a bond issued (the
// funds go up by its amount and the bond is listed), the wealth view shown.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, openPage, assertNoErrors, pollUntil, shot } from "./helpers.mjs";

const TIMEOUT = 120000;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});


describe("detailed economy", () => {
  test("a tax rate is set, a bond is issued and listed, the wealth view is shown", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      assert.equal(await page.isVisible("#economy-panel"), true);
      await page.locator("#economy-rules").check();
      await pollUntil(async () => page.isVisible("#economy-wealth-view"), "the rule on");

      // a tax rate: residential, modest class, to 12 %
      const cell = page.locator("#tax-1-1");
      await cell.fill("12");
      await cell.press("Enter");
      await pollUntil(async () => (await cell.inputValue()) === "12", "the rate kept by the engine");

      // a bond: listed, with its «Rembourser» button
      assert.equal(await page.locator("#bond-issue").isEnabled(), true);
      await page.locator("#bond-issue").click();
      await pollUntil(async () => (await page.locator("#economy-bond-list li").count()) === 1, "one bond");
      assert.match(await page.locator("#economy-bond-list").textContent(), /10\s?000/u);

      await page.locator("#economy-wealth-view").check();
      assert.equal(await page.isChecked("#economy-wealth-view"), true);
      await shot(page, "economy");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
