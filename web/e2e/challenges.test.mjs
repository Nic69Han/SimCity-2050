// End-to-end: the challenges (docs/game-design-v1.md) on the real wasm engine. «Une année sans faillite» is started from
// the panel (the page loads its sample through the city selector), the time left goes down as the city plays, and the
// result is announced and kept in localStorage; a seed challenge starts a new city through «Nouvelle ville».
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, openPage, assertNoErrors, pollUntil, countFrames, shot } from "./helpers.mjs";

const TIMEOUT = 180000;
const START = "Commencer";

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

const item = (page, title) => page.locator("#challenges-panel li.challenge", { hasText: title });
const running = (page) => page.locator("#challenges-panel .challenge-running");
const result = (page) => page.locator("#challenges-panel [role=status]");

describe("challenges", () => {
  test("the panel lists at least six challenges, each with «Commencer»", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      assert.equal(await page.isVisible("#challenges-panel"), true);
      assert.equal(await page.locator("#challenges-panel h2").textContent(), "Défis");
      assert.ok((await page.locator("#challenges-panel li.challenge").count()) >= 6);
      assert.equal(await running(page).isVisible(), false);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a year without bankruptcy is started, progresses and is won", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await countFrames(page);
      await item(page, "Une année sans faillite").getByRole("button", { name: START }).click();
      await pollUntil(async () => running(page).isVisible(), "the running challenge");
      assert.match(await running(page).textContent(), /Il reste 1 an\./u);
      assert.match(await running(page).textContent(), /Fonds : 1\s?000\s?000 \$/u);

      await page.locator("#speed").evaluate((el) => {
        el.value = "3";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.click("#play");
      // the time left goes down below a year, then the verdict comes
      await pollUntil(async () => /Il reste \d+ mois\./u.test(await running(page).textContent().catch(() => "")) ||
        (await result(page).textContent()) !== "", "the time left going down", 120000);
      await pollUntil(async () => /^Défi gagné/u.test(await result(page).textContent()), "the win", 150000);
      await page.click("#play");
      assert.match(await result(page).textContent(), /^Défi gagné : « Une année sans faillite »/u);
      assert.equal(await running(page).isVisible(), false);
      assert.match(await item(page, "Une année sans faillite").textContent(), /Meilleur : gagné en/u);
      const stored = await page.evaluate(() => localStorage.getItem("simcity2050.challenges"));
      assert.equal(JSON.parse(stored)["first-year"].result, "won");
      await shot(page, "challenges");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a seed challenge makes a new city from its seed", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await item(page, "Une ville neuve de 10 000 habitants").getByRole("button", { name: START }).click();
      await pollUntil(async () => running(page).isVisible(), "the running challenge");
      assert.match(await page.locator("#status").textContent(), /^Graine 2050 · /u);
      assert.match(await running(page).textContent(), /Population : 0/u);
      // another city abandons it
      await page.selectOption("#city", "kyoto");
      await pollUntil(async () => !(await running(page).isVisible()), "the abandon");
      assert.match(await result(page).textContent(), /Défi abandonné/u);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
