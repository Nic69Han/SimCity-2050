// End-to-end: the final 3D rendering (docs/game-design-v14.md) on the real wasm engine. The simple 3D
// view of the sample city mounts the night layer (windows and street lamps placed, dark in daytime), the
// full view the adaptive quality layer («Qualité automatique» on); the tool palette folds a group and opens
// it again, and the group of the chosen tool stays open.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, openPage, assertNoErrors, selectTool, pollUntil, shot } from "./helpers.mjs";

const TIMEOUT = 120000;
// Software WebGL in headless Chromium (no GPU in CI); same switches as view3d.test.mjs.
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

let browser;
before(async () => {
  browser = await launchBrowser({ args: GL_ARGS });
});
after(async () => {
  await browser?.close();
});

const stats = (page, name) => page.evaluate((n) => document.getElementById("map3d")[n]?.() ?? null, name);

describe("final 3D rendering", () => {
  test("night and quality layers are mounted, the palette folds and reopens", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { query: "?lite=1" });
    try {
      // the palette: the group of the chosen tool stays open, another group folds and opens again
      const titles = page.locator(".tool-group-title");
      const first = titles.first();
      const firstRow = await first.getAttribute("aria-controls");
      await selectTool(page, await page.locator(`#${firstRow} button.tool`).first().getAttribute("data-tool"));
      // its title is disabled (aria-disabled): the group of the chosen tool cannot be folded
      assert.equal(await first.getAttribute("aria-disabled"), "true");
      assert.equal(await first.getAttribute("aria-expanded"), "true", "the selected tool's group stays open");
      const other = titles.nth(1);
      const otherRow = await other.getAttribute("aria-controls");
      await other.click();
      await pollUntil(async () => (await other.getAttribute("aria-expanded")) === "false", "the other group folded");
      assert.equal(await page.locator(`#${otherRow}`).isHidden(), true);
      await other.click();
      await pollUntil(async () => (await other.getAttribute("aria-expanded")) === "true", "the other group open again");
      await page.keyboard.press("Escape");

      await page.locator("#view3d").click();
      await page.waitForFunction(() => typeof document.getElementById("map3d").nightStats === "function");
      await pollUntil(async () => ((await stats(page, "nightStats"))?.windows ?? 0) > 0, "windows placed");
      const night = await stats(page, "nightStats");
      assert.ok(night.lamps > 0, "street lamps placed");
      assert.equal(night.intensity, 0, "no daylight cycle in the simple view: lights off");
      assert.equal(await stats(page, "perfStats"), null, "the simple view keeps its resolution");
      await shot(page, "render-final");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("the full view adapts its resolution («Qualité automatique» on)", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await page.locator("#view3d").click();
      await page.waitForFunction(() => typeof document.getElementById("map3d").perfStats === "function", null, { timeout: 60000 });
      const perf = await stats(page, "perfStats");
      assert.equal(perf.auto, true);
      assert.ok(perf.pixelRatio > 0);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
