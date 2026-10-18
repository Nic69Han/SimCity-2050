// End-to-end: the advisors know the extended rules on the real wasm engine. «Réseau d'eau» turned on in
// a new city (seed 42, 120 x 100) and zones built without any pipe: the Urbanisme advice mentions the zones
// without water and suggests a pump; turning the rule off removes the remark. No console error.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, newCity, selectTool, clickTile, engine, pollUntil,
} from "./helpers.mjs";

const SEED = 42;
const ZONES = 5;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

const planning = (page) =>
  page.evaluate(() => {
    const li = document.querySelector('#advisors-panel li.adv[data-advisor="planning"]');
    return li ? { severity: li.querySelector(".adv-sev").textContent, text: li.textContent } : null;
  });

describe("advisors and the water rule", () => {
  test("zones without water: Urbanisme says so and suggests a pump; the rule off silences it", { timeout: 120000 }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, String(SEED));
      await pollUntil(async () => (await page.locator("#status").textContent()).includes(`Graine ${SEED}`), "the new city");
      await page.locator("#water-rules").check();

      // residential zones on land: the same engine, same seed, picks the tiles (they must be placeable)
      const { City } = await engine();
      const shadow = City.new_sized(120, 100, SEED);
      const res = [...Array(shadow.tool_count()).keys()].map((i) => shadow.tool_info(i)).find((t, i) => shadow.tool_key(i) === "residential");
      const spots = [];
      for (let y = 4; y < 96 && spots.length < ZONES; y += 4) {
        for (let x = 4; x < 116 && spots.length < ZONES; x += 4) {
          if (shadow.tool_preview(res[0], x, y)[0] === 1 && shadow.tool_down(res[0], x, y) === 1) spots.push({ x, y });
        }
      }
      assert.equal(spots.length, ZONES, "room for the zones");

      await selectTool(page, "residential");
      for (const s of spots) await clickTile(page, s.x, s.y);

      await pollUntil(async () => /sans eau|pas d'eau/.test((await planning(page))?.text ?? ""),
        "the Urbanisme advice to mention the zones without water", 30000);
      const advice = await planning(page);
      assert.match(advice.text, /zones? n'(a|ont) pas d'eau/);
      assert.match(advice.text, /pompe/);

      await page.locator("#water-rules").uncheck();
      await pollUntil(async () => !/pas d'eau/.test((await planning(page))?.text ?? ""),
        "the water remark to go with the rule", 30000);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
