// End-to-end: the guided first steps (web/tutorial.js) on the real wasm engine. The guide reads the
// city the engine holds: a residential zone placed with the tool moves it from step 1 to step 2; a new
// city opens the guide, a sample or a file starts it folded; the «Passer» choice is kept in the browser.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, newCity, selectTool, clickTile, shadowCity, findPreview,
  readFunds, readSample, shot, waitForReady, pollUntil, START_FUNDS,
} from "./helpers.mjs";

const TIMEOUT = 120000;
const SEED = 4242;
const OK = 1; // tool.rs: the placement works (the shadow engine's preview result)

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

// The text of the guide's panel ("" when it is hidden).
async function panelText(page) {
  return page.locator("#tutorial-panel").evaluate((el) => (el.hidden ? "" : el.innerText.replace(/\s+/g, " ").trim()));
}

describe("the guided first steps", () => {
  test("a new city shows step 1; a residential zone placed with the tool moves the guide to step 2", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, String(SEED));
      assert.match(await panelText(page), /Étape 1\/7 Posez une zone résidentielle/);

      const shadow = await shadowCity({ seed: SEED });
      const origin = findPreview(shadow, "residential", OK);
      assert.ok(origin, "the random city has a place for a residential zone");
      await selectTool(page, "residential");
      await clickTile(page, origin.x, origin.y);

      await pollUntil(async () => (await panelText(page)).includes("Étape 2/7"), "step 2 of the guide");
      assert.match(await panelText(page), /Étape 2\/7 Reliez-la par une route/);
      assert.ok((await readFunds(page)) < START_FUNDS, "the zone was paid for by the engine");
      await shot(page, "tutorial-step-2");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("«Passer» folds the guide; the choice is kept in the browser; «Recommencer» opens it again", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, String(SEED));
      assert.match(await panelText(page), /Étape 1\/7/, "a new city shows the guide");
      await page.locator("#tutorial-panel button", { hasText: "Passer" }).click();
      assert.equal(await panelText(page), "Premiers pas", "only the button is left");

      // after a reload, a new city still starts folded: the choice was kept
      await page.reload();
      await waitForReady(page);
      await newCity(page, String(SEED));
      assert.equal(await panelText(page), "Premiers pas", "folded for a new city after a reload");

      await page.locator("#tutorial-panel button.tutorial-open").click();
      assert.match(await panelText(page), /Étape 1\/7/, "the button opens the guide");
      await page.locator("#tutorial-panel button", { hasText: "Recommencer" }).click();
      assert.match(await panelText(page), /Étape 1\/7/);

      // «Recommencer» clears the choice: the next new city opens the guide again
      await page.reload();
      await waitForReady(page);
      await newCity(page, String(SEED));
      assert.match(await panelText(page), /Étape 1\/7/, "open again after Recommencer");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a sample or an opened file starts the guide folded; «Premiers pas» shows it", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      assert.equal(await panelText(page), "Premiers pas", "the sample city starts folded");
      await page.setInputFiles("#file", { name: "haight.cty", mimeType: "application/octet-stream", buffer: await readSample("haight") });
      await pollUntil(async () => (await page.locator("#city").inputValue()) === "local", "the file is shown");
      assert.equal(await panelText(page), "Premiers pas", "a loaded game starts folded");
      await page.locator("#tutorial-panel button.tutorial-open").click();
      // the file is a built city: the guide shows the first step it has not done yet
      assert.match(await panelText(page), /Étape [1-7]\/7/, "the player can reopen it");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});

describe("the steps on the real engine", () => {
  test("the built Haight-Ashbury city is checked: steps 1 to 5 are done, playing completes the guide", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await page.setInputFiles("#file", { name: "haight.cty", mimeType: "application/octet-stream", buffer: await readSample("haight") });
      await pollUntil(async () => (await page.locator("#city").inputValue()) === "local", "the file is shown");
      await page.locator("#tutorial-panel button.tutorial-open").click();
      // zones, roads, a power plant, a powered zone, commercial and industrial zones: all read from the tiles
      assert.match(await panelText(page), /Étape 6\/7 Lancez la simulation/);

      // the time advances once the game runs: the last check (population) is then the current one
      await page.click("#play");
      await pollUntil(async () => (await panelText(page)).includes("Bravo"), "the guide to be complete", 60000);
      await page.click("#play");
      assert.match(await panelText(page), /7\/7/);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
