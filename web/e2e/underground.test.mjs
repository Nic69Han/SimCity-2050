// End-to-end: the underground networks in the 3D view (web/view3d-underground.js) on the real wasm
// engine, simple view (?lite=1). Water rules on, a pump on the shore and a run of pipes placed in 2D
// (the tools only work there), then «Vue 3D»: canvas.undergroundStats() (a read-only hook of the
// layer) reports them, «Sous-sol» turns the see-through mode on and off, and no console error shows.
// UNDERGROUND_SHOT=<file.png> saves a screenshot of the 3D canvas in see-through mode.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, newCity, selectTool, dragTiles, clickTile, engine, pollUntil,
} from "./helpers.mjs";

const TIMEOUT = 120000;
const SEED = 42;
const RUN = 5; // pipes after the pump
// Software WebGL in headless Chromium (no GPU in CI); same switches as view3d.test.mjs.
const GL_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

let browser;
before(async () => {
  browser = await launchBrowser({ args: GL_ARGS });
});
after(async () => {
  await browser?.close();
});

const stats = (page) => page.evaluate(() => document.getElementById("map3d").undergroundStats?.() ?? null);

describe("underground networks in 3D", () => {
  test("pipes and a pump are reported; «Sous-sol» toggles the see-through mode; no console error", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { query: "?lite=1" });
    try {
      await newCity(page, String(SEED));
      await pollUntil(async () => (await page.locator("#status").textContent()).includes(`Graine ${SEED}`), "the new city");

      // the engine on the same settings picks a pump tile and a run of pipe tiles beside it
      const { City } = await engine();
      const shadow = City.new_sized(120, 100, SEED);
      shadow.set_water_rules(true);
      let pump = null, run = [];
      for (let x = 2; x < 100 && !pump; x++) {
        for (let y = 2; y < 98 && !pump; y++) {
          if (shadow.pump_preview(x, y)[0] !== 1) continue;
          shadow.place_pump(x, y);
          const tiles = [];
          for (let k = 1; k <= RUN && shadow.pipe_preview(x + k, y)[0] === 1; k++) tiles.push({ x: x + k, y });
          if (tiles.length >= 2) { pump = { x, y }; run = tiles; } else shadow.remove_pump(x, y);
        }
      }
      assert.ok(pump, "a shore tile with a run of pipe tiles");

      await page.locator("#water-rules").check();
      await selectTool(page, "pompe");
      await clickTile(page, pump.x, pump.y);
      await selectTool(page, "canalisation");
      await dragTiles(page, run);
      await page.keyboard.press("Escape");
      assert.match(await page.locator("#water-stats").textContent(), new RegExp(`^Eau : 1 pompe, ${run.length + 1} canalisations`, "u"));

      await page.locator("#view3d").click();
      await page.waitForFunction(() => document.getElementById("map-frame").classList.contains("is-3d"));
      await page.waitForFunction(() => typeof document.getElementById("map3d").undergroundStats === "function");
      await pollUntil(async () => (await stats(page))?.pumpTiles === 1, "the pump to be reported");

      const s = await stats(page);
      assert.equal(s.pumpTiles, 1);
      assert.equal(s.pipeTiles, run.length, "the pipe tiles of the engine");
      assert.equal(s.instances.pump, 1);
      assert.equal(s.instances.pipe, run.length + 1 + run.length, "pump+pipe nodes and the segments between them");
      assert.equal(s.dropped, 0);
      assert.equal(s.instances.tunnel + s.instances.station, 0, "no metro");
      assert.equal(s.seeThrough, false);

      // idle frames do not rebuild
      await page.waitForTimeout(500);
      assert.equal((await stats(page)).rebuilds, s.rebuilds, "bytes unchanged: no rebuild");

      const toggle = page.getByRole("button", { name: "Sous-sol" });
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-pressed"), "true");
      assert.equal((await stats(page)).seeThrough, true);
      if (process.env.UNDERGROUND_SHOT) {
        await page.waitForTimeout(1500);
        const box = await page.evaluate(() => {
          const r = document.getElementById("map3d").getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        await page.screenshot({ path: process.env.UNDERGROUND_SHOT, clip: box, timeout: 100000 });
      }
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-pressed"), "false");
      assert.equal((await stats(page)).seeThrough, false);

      // «Vue 2D»: the button and the hook are gone
      await page.locator("#view3d").click();
      await page.waitForFunction(() => !document.getElementById("map-frame").classList.contains("is-3d"));
      assert.equal(await page.evaluate(() => document.getElementById("map3d").undergroundStats === undefined), true);
      assert.equal(await page.getByRole("button", { name: "Sous-sol" }).count(), 0);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
