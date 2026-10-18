// End-to-end: «Circulation simulée» (docs/game-design-v03.md) on the real wasm engine and the
// Haight-Ashbury sample. The rule is off at first; turning it on and playing puts cars on the
// roads: the panel counts them, the 2D map draws them, and the 3D view (simple, ?lite=1) holds
// one instance per car read (canvas.vehiclesStats(), a read-only hook of web/view3d-vehicles.js).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, countFrames, playFrames, pollUntil, mapDigest, shot,
} from "./helpers.mjs";

const TIMEOUT = 180000;
// Software WebGL in headless Chromium (no GPU in CI); same switches as view3d.test.mjs.
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

let browser;
before(async () => {
  browser = await launchBrowser({ args: GL_ARGS });
});
after(async () => {
  await browser?.close();
});

/** The panel's stats as { label: number }. */
async function panelStats(page) {
  const rows = await page.$$eval("#agent-stats li", (lis) =>
    lis.map((li) => [li.children[0].textContent, li.children[1].textContent]));
  return Object.fromEntries(rows.map(([k, v]) => [k, Number(v.replace(/\D/g, ""))]));
}

describe("simulated traffic", () => {
  test("the rule is off at first; on, cars drive and the panel, the map and the 3D view show them", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { query: "?lite=1" });
    try {
      await countFrames(page);
      assert.equal(await page.isVisible("#agents-panel"), true);
      assert.equal(await page.textContent("#agents-panel h2"), "Circulation simulée");
      assert.equal(await page.isChecked("#agents-rules"), false);
      assert.equal(await page.isVisible("#agent-stats"), false, "no stats with the rule off");

      await page.check("#agents-rules");
      const before = await mapDigest(page);
      await playFrames(page, 240);
      await pollUntil(async () => (await panelStats(page))["Voitures en route"] > 0, "cars on the road");
      const stats = await panelStats(page);
      assert.ok(stats["Habitants motorisés"] > 0, JSON.stringify(stats));
      assert.notEqual(await mapDigest(page), before, "the map shows the cars");
      await shot(page, "agents-2d");

      await page.locator("#view3d").click();
      await page.waitForFunction(() => typeof document.getElementById("map3d").vehiclesStats === "function");
      await page.click("#play");
      const read = () => page.evaluate(() => document.getElementById("map3d").vehiclesStats());
      await pollUntil(async () => (await read()).drawn > 0, "cars in the 3D view", 60000);
      const s = await read();
      assert.equal(s.drawn + s.dropped, s.vehicles);
      await page.click("#play");
      await shot(page, "agents-3d");

      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
