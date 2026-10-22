// End-to-end: rewards and special deals (docs/game-design-v12.md) on the real wasm engine. The sample city
// (Haight, big enough for the mayor's house), the «Bâtiments étendus» and «Récompenses et accords» switches:
// the mayor's house is listed as unlocked, placed with the palette where the engine accepts it, then listed
// as placed.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, selectTool, clickTile, pollUntil, shot, shadowCity, readSample,
} from "./helpers.mjs";

const TIMEOUT = 120000;
const MAYOR_HOUSE = 50;
const FOOTPRINT = [[0, 0], [1, 0], [0, 1], [1, 1]]; // the 2x2 house from its top-left tile

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

const rewardsText = (page) => page.locator("#rewards-list").textContent();

describe("rewards and special deals", () => {
  test("the mayor's house is unlocked on the sample city, placed, then listed as placed", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      // the sample city has no bare land: the engine on the same city picks a site the bulldozer clears for
      // the 2x2 house (preview -1, "to clear"), clears it as the page will, and checks the house fits there
      const shadow = await shadowCity({ cty: await readSample("haight") });
      const { city } = shadow;
      city.set_structure_rules(true);
      city.set_reward_rules(true);
      let site = null;
      for (let x = 2; x < city.width() - 2 && !site; x++) {
        for (let y = 2; y < city.height() - 2 && !site; y++) {
          if (city.structure_preview(MAYOR_HOUSE, x, y)[0] !== -1) continue;
          for (const [dx, dy] of FOOTPRINT) shadow.down("bulldozer", x + dx, y + dy);
          if (city.structure_preview(MAYOR_HOUSE, x, y)[0] === 1) site = { x, y };
        }
      }
      assert.ok(site, "land the bulldozer clears for the mayor's house");

      await page.locator("#structures-rules").check();
      assert.equal(await page.isVisible("#rewards-panel"), true);
      await page.locator("#rewards-rules").check();
      await pollUntil(async () => /Résidence du maire \(Débloquée/u.test(await rewardsText(page)), "the reward unlocked");

      await selectTool(page, "bulldozer");
      for (const [dx, dy] of FOOTPRINT) await clickTile(page, site.x + dx, site.y + dy);
      await selectTool(page, `structure_${MAYOR_HOUSE}`);
      await clickTile(page, site.x, site.y);
      await page.keyboard.press("Escape");
      await pollUntil(async () => /Résidence du maire \(Posée/u.test(await rewardsText(page)), "the reward placed");
      await shot(page, "rewards");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
