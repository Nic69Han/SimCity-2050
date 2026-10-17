// End-to-end: the water network on the real wasm engine. A new city (seed 42, 120 x 100), the
// «Réseau d'eau» rule turned on, a pump on the shore and a pipe next to it: the 2D layer shows
// them (read from the map canvas pixels), the funds drop by what the engine charges, the stats
// line counts them, and the page reports no error.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, newCity, readFunds, selectTool, clickTile, readToolMessage,
  engine, pollUntil, TILE_PX, START_FUNDS,
} from "./helpers.mjs";

const TIMEOUT = 120000;
const SEED = 42;
const PUMP_RGB = [0, 188, 212]; // map-layer-water.js
const PIPE_RGB = [30, 136, 229];

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

// Colour of the map canvas at the centre of tile (x, y).
async function pixelAt(page, x, y) {
  return page.evaluate(([tilePx, tx, ty]) => {
    const c = document.getElementById("map");
    return Array.from(c.getContext("2d").getImageData(tx * tilePx + tilePx / 2, ty * tilePx + tilePx / 2, 1, 1).data.slice(0, 3));
  }, [TILE_PX, x, y]);
}

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);
const tool = (page, key) => page.locator(`#palette button.tool[data-tool="${key}"]`);

describe("water network", () => {
  test("rule on, a pump on the shore and a pipe: the layer, the funds and the stats agree", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, String(SEED));
      await pollUntil(async () => (await page.locator("#status").textContent()).includes(`Graine ${SEED}`), "the new city");
      assert.equal(await readFunds(page), START_FUNDS);

      // the engine on the same settings picks the tiles and says what things cost
      const { City } = await engine();
      const shadow = City.new_sized(120, 100, SEED);
      shadow.set_water_rules(true);
      const [pipeCost, pumpCost] = shadow.water_costs();
      let pump = null;
      for (let x = 2; x < 118 && !pump; x++) {
        for (let y = 2; y < 98 && !pump; y++) {
          if (shadow.pump_preview(x, y)[0] === 1 && shadow.pipe_preview(x + 1, y)[0] === 1) pump = { x, y };
        }
      }
      assert.ok(pump, "a shore tile in the new city");

      // rule off: the tools are disabled, with their reason, and the layer is not there
      assert.equal(await page.locator("#water-rules").isChecked(), false);
      assert.equal(await tool(page, "pompe").isDisabled(), true);
      assert.match(await tool(page, "pompe").getAttribute("title"), /Activez « Réseau d'eau »/u);
      assert.equal(await page.locator("#water-view").isVisible(), false);

      await page.locator("#water-rules").check();
      assert.equal(await page.locator("#water-rules").isChecked(), true);
      assert.equal(await tool(page, "pompe").isDisabled(), false);
      assert.equal(await tool(page, "canalisation").isDisabled(), false);
      assert.equal(await page.locator("#water-view").isVisible(), true);
      const before = await pixelAt(page, pump.x, pump.y);
      assert.equal(near(before, PUMP_RGB), false, "no layer yet");

      // the pump
      await selectTool(page, "pompe");
      await clickTile(page, pump.x, pump.y);
      assert.equal(await readToolMessage(page), "");
      assert.equal(await readFunds(page), START_FUNDS - pumpCost, "the pump cost");
      await pollUntil(async () => near(await pixelAt(page, pump.x, pump.y), PUMP_RGB), "the pump to be drawn");

      // a pipe next to it, fed by the pump
      await selectTool(page, "canalisation");
      await clickTile(page, pump.x + 1, pump.y);
      assert.equal(await readFunds(page), START_FUNDS - pumpCost - pipeCost, "the pipe cost");
      await pollUntil(async () => near(await pixelAt(page, pump.x + 1, pump.y), PIPE_RGB), "the pipe to be drawn");

      // the engine agrees (same actions on the shadow city)
      shadow.place_pump(pump.x, pump.y);
      shadow.place_pipe(pump.x + 1, pump.y);
      assert.equal(await readFunds(page), shadow.funds());
      const [pumps, pipes] = shadow.water_stats();
      assert.deepEqual([pumps, pipes], [1, 2]);
      assert.match(await page.locator("#water-stats").textContent(), /^Eau : 1 pompe, 2 canalisations/u);

      // a refused placement says so and costs nothing
      const funds = await readFunds(page);
      let refused = null;
      for (let x = 60; x < 118 && !refused; x++) if (shadow.pump_preview(x, 50)[0] === 0) refused = x;
      assert.ok(refused, "a tile where no pump can go");
      await selectTool(page, "pompe");
      await clickTile(page, refused, 50);
      assert.equal(await readFunds(page), funds);
      assert.notEqual(await readToolMessage(page), "", "the page says it was refused");

      // choosing another tool hides the layer; «Voir le réseau» brings it back
      await page.keyboard.press("Escape");
      await pollUntil(async () => !near(await pixelAt(page, pump.x, pump.y), PUMP_RGB), "the layer to go");
      await page.locator("#water-view").check();
      await pollUntil(async () => near(await pixelAt(page, pump.x, pump.y), PUMP_RGB), "the layer to come back");

      // a new city starts with the rule off, whatever the checkbox said
      await newCity(page, "7");
      await pollUntil(async () => (await page.locator("#status").textContent()).includes("Graine 7"), "the new city");
      assert.equal(await page.locator("#water-rules").isChecked(), false);
      assert.equal(await tool(page, "pompe").isDisabled(), true);

      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
