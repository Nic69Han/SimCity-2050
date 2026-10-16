// End-to-end: the advisors panel on the real wasm engine. Four advisors in French, and a high tax
// rate changes the advice of the Finances or Urbanisme advisor. No console error.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, openPage, assertNoErrors, setSlider, pollUntil } from "./helpers.mjs";

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

const readAdvisors = (page) =>
  page.$$eval("#advisors-panel li.adv", (items) =>
    items.map((li) => ({
      id: li.dataset.advisor,
      title: li.querySelector("h3 span")?.textContent ?? "",
      severity: li.querySelector(".adv-sev")?.textContent ?? "",
      diagnosis: li.querySelector(".adv-diag")?.textContent ?? "",
      action: li.querySelector(".adv-act")?.textContent ?? "",
    })));

describe("advisors panel", () => {
  test("four French advisors on the sample; a high tax changes the advice", { timeout: 120000 }, async () => {
    const { page, errors, close } = await openPage(browser, { viewport: { width: 390, height: 800 } });
    try {
      await page.waitForSelector("#advisors-panel:not([hidden]) li.adv");
      const before = await readAdvisors(page);
      assert.deepEqual(before.map((a) => a.id).sort(), ["environment", "finances", "planning", "security"]);
      for (const a of before) {
        assert.ok(["Tout va bien", "Attention", "Urgent"].includes(a.severity), `${a.id}: ${a.severity}`);
        assert.match(a.diagnosis, /[a-zé]{3,} [a-zé]{2,}/i, a.id);
        assert.match(a.action, /^Conseil : \S+/, a.id);
      }
      const heading = await page.locator("#advisors-panel h2").textContent();
      assert.equal(heading, "Conseillers");
      // compact on a phone: no horizontal scroll of the page
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal scroll");

      await setSlider(page, "#bud-tax", 20);
      await pollUntil(async () => {
        const now = await readAdvisors(page);
        const pick = (l) => JSON.stringify(l.filter((a) => a.id === "finances" || a.id === "planning"));
        return pick(now) !== pick(before);
      }, "the Finances or Urbanisme advice changes with a 20 % tax");
      const planning = (await readAdvisors(page)).find((a) => a.id === "planning");
      assert.equal(planning.severity, "Urgent");
      assert.match(planning.diagnosis, /20 %/);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
