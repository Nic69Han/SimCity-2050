// End-to-end: «Vue 3D» on the real wasm engine. The 3D canvas must draw (not blank), a tool
// click on a tile of the 3D view must reach the engine (the funds change as the shadow engine
// says), and «Vue 2D» must bring the flat map back. No console error at any step.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, shadowCity, readSample, readFunds, selectTool, readToolMessage,
  pollUntil, shot, readMap,
} from "./helpers.mjs";

const TIMEOUT = 120000;
// Software WebGL in headless Chromium (no GPU in CI).
const GL_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

let browser;
before(async () => {
  browser = await launchBrowser({ args: GL_ARGS });
});
after(async () => {
  await browser?.close();
});

// Count of distinct colours (quantised) in the PNG of the 3D canvas, read by the page itself.
async function colourCount(page) {
  const png = await page.locator("#map3d").screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 5) seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    return seen.size;
  }, png.toString("base64"));
}

// A tile where a residential zone can be built (the engine's preview says OK), nearest the middle
// of the map first, and visible in the 3D canvas (as {x, y, p}), or null.
async function pickVisibleTile(page, shadow) {
  const city = shadow.city;
  const w = city.width(), h = city.height();
  const candidates = [];
  for (let x = 1; x < w - 1; x++) {
    for (let y = 1; y < h - 1; y++) {
      if (shadow.preview("residential", x, y)[0] === 1) {
        candidates.push({ x, y, d: Math.abs(x - w / 2) + Math.abs(y - h / 2) });
      }
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates.slice(0, 60)) {
    const seen = await page.evaluate(([x, y]) => {
      const canvas = document.getElementById("map3d");
      const r = canvas.getBoundingClientRect();
      const p = canvas.tileScreen(x, y);
      const inside = p.x > r.left + 4 && p.x < r.right - 4 && p.y > r.top + 4 && p.y < r.bottom - 4;
      return inside ? p : null;
    }, [c.x, c.y]);
    if (seen) return { x: c.x, y: c.y, p: seen };
  }
  return null;
}

describe("the 3D view", () => {
  test("«Vue 3D» draws the city, a tool click reaches the engine, «Vue 2D» brings the map back", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      // the button is in the header, next to the play control
      const toggle = page.locator("#view3d"); // its label is «Vue 3D», then «Vue 2D» while on
      await toggle.click();
      await page.waitForFunction(() => document.getElementById("map-frame").classList.contains("is-3d"));
      await page.waitForFunction(() => document.getElementById("view3d").textContent === "Vue 2D");
      assert.equal(await page.locator("#map").isVisible(), false, "the flat map is hidden");
      assert.equal(await page.locator("#map3d").isVisible(), true, "the 3D canvas is shown");

      const colours = await colourCount(page);
      assert.ok(colours > 20, `the 3D canvas is blank: ${colours} colours`);
      await shot(page, "view3d-on");

      // a residential zone built by a click in the 3D view
      const shadow = await shadowCity({ cty: await readSample("haight") });
      const spot = await pickVisibleTile(page, shadow);
      assert.ok(spot, "a visible bare tile with room for a zone");
      const before = await readFunds(page);
      await selectTool(page, "residential");
      await page.mouse.click(spot.p.x, spot.p.y);
      shadow.down("residential", spot.x, spot.y);
      await pollUntil(async () => (await readFunds(page)) !== before, "the funds to change after the 3D click");
      assert.equal(await readFunds(page), shadow.funds(), "the engine charged what the shadow engine charges");
      assert.equal(await readToolMessage(page), "", "the placement succeeded");
      await shot(page, "view3d-built");

      await toggle.click();
      await page.waitForFunction(() => !document.getElementById("map-frame").classList.contains("is-3d"));
      assert.equal(await page.locator("#map").isVisible(), true, "the flat map is back");
      assert.equal(await page.locator("#map3d").isVisible(), false);
      assert.equal(await toggle.textContent(), "Vue 3D");
      // the flat map shows the zone on the tile that was clicked (not a neighbour of the same cost)
      const map = await readMap(page);
      assert.equal(map.at(spot.x, spot.y).label, "Zone résidentielle", `tile (${spot.x}, ${spot.y}) on the flat map`);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
