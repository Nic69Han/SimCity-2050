// End-to-end: building tools on the real wasm engine, in a real browser.
// Costs are read from the engine (the shadow City, same bytes as the page); the page's
// funds must match it exactly after each action. Tiles are read from the canvas.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { RESULT, resultMessage } from "../tools.js";
import {
  launchBrowser, openPage, assertNoErrors, newCity, readStatus, readMap, readToolMessage,
  selectTool, hoverTile, outlineAt, clickTile, dragTiles, findRun, findBlock, findTile,
  shadowCity, mapDataUrl, readQueryPanel, shot, DIRT_LABEL, WATER_LABEL, ROAD_LABEL,
  tileXY,
} from "./helpers.mjs";

const SEED = "4242"; // a random city with plenty of dry land and water (same map every run)
const ZONE_LABEL = "Zone résidentielle";
const TIMEOUT = 60000;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

// The 3x3 footprint of a size-3 tool placed at (x, y), from the engine, as [x, y] pairs.
function footprintTiles(shadow, key, x, y) {
  const [x0, y0, w, h] = shadow.footprint(key, x, y);
  const out = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push({ x: x0 + i, y: y0 + j });
  return out;
}

describe("building tools on the real engine", () => {
  test("(b) route drag on dry land: funds change by the sum of the hover costs", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, SEED);
      const shadow = await shadowCity({ seed: Number(SEED) });
      await selectTool(page, "road");
      const map = await readMap(page);
      const run = findRun(map, DIRT_LABEL, 5);
      assert.ok(run, "the random city has no 5 dry tiles in a row");

      // Before the drag: hover each tile, check its outline is green and read its engine cost.
      const before = await readStatus(page);
      let expected = 0;
      for (const t of run) {
        await hoverTile(page, t.x, t.y);
        assert.equal(await outlineAt(page, t.x, t.y), "ok", `outline at ${t.x},${t.y}`);
        const [result, cost] = shadow.preview("road", t.x, t.y);
        assert.equal(result, RESULT.OK);
        expected += cost;
      }
      assert.ok(expected > 0, "a road costs money");
      await shot(page, "b-before-drag");

      await dragTiles(page, run);

      const after = await readStatus(page);
      assert.equal(before.funds - after.funds, expected, "funds change = sum of the previewed costs");
      assert.equal(await readToolMessage(page), "", "a successful drag shows no message");

      // The same stroke on the shadow engine must give the same funds (the page is in sync).
      shadow.down("road", run[0].x, run[0].y);
      for (let i = 1; i < run.length; i++) shadow.drag("road", run[i - 1].x, run[i - 1].y, run[i].x, run[i].y);
      assert.equal(after.funds, shadow.funds());

      const mapAfter = await readMap(page);
      for (const t of run) assert.equal(mapAfter.at(t.x, t.y).label, ROAD_LABEL, `tile ${t.x},${t.y} is a road`);
      await shot(page, "b-after-drag");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(c) residential zone on cleared ground succeeds and charges the engine cost", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, SEED);
      const shadow = await shadowCity({ seed: Number(SEED) });
      const map = await readMap(page);
      // A centre tile whose 3x3 footprint, as the engine reports it, is all dry land.
      let spot = null;
      for (let y = 0; y < map.h && !spot; y++) {
        for (let x = 0; x < map.w && !spot; x++) {
          if (map.at(x, y).label !== DIRT_LABEL) continue;
          const tiles = footprintTiles(shadow, "residential", x, y);
          if (tiles.every((t) => t.x >= 0 && t.y >= 0 && t.x < map.w && t.y < map.h &&
            map.at(t.x, t.y).label === DIRT_LABEL)) spot = { x, y, tiles };
        }
      }
      assert.ok(spot, "no free 3x3 spot of dry land");

      await selectTool(page, "residential");
      await hoverTile(page, spot.x, spot.y);
      assert.equal(await outlineAt(page, spot.x, spot.y), "ok", "green outline on free ground");
      const [result, cost] = shadow.preview("residential", spot.x, spot.y);
      assert.equal(result, RESULT.OK);
      assert.ok(cost > 0);

      const before = await readStatus(page);
      await clickTile(page, spot.x, spot.y);
      const after = await readStatus(page);
      assert.equal(before.funds - after.funds, cost, "funds drop by the zone cost");
      assert.equal(await readToolMessage(page), "", "success: no message");
      shadow.down("residential", spot.x, spot.y);
      assert.equal(after.funds, shadow.funds());

      const mapAfter = await readMap(page);
      assert.equal(mapAfter.at(spot.x, spot.y).label, ZONE_LABEL, "the centre tile is now a residential zone");
      await shot(page, "c-residential-built");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(d) a placement on water fails: message shown, funds unchanged", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, SEED);
      const shadow = await shadowCity({ seed: Number(SEED) });
      const map = await readMap(page);
      // First water tile where the engine refuses a residential zone.
      let target = null;
      for (let y = 0; y < map.h && !target; y++) {
        for (let x = 0; x < map.w && !target; x++) {
          if (map.at(x, y).label !== WATER_LABEL) continue;
          const [result] = shadow.preview("residential", x, y);
          if (result !== RESULT.OK) target = { x, y, result };
        }
      }
      assert.ok(target, "no water tile where a zone is refused");

      await selectTool(page, "residential");
      await hoverTile(page, target.x, target.y);
      assert.equal(await outlineAt(page, target.x, target.y), "bad", "red outline on water");

      const before = await readStatus(page);
      const mapBefore = await mapDataUrl(page);
      await clickTile(page, target.x, target.y);
      assert.equal(await readToolMessage(page), resultMessage(target.result), "the French failure message");
      assert.equal(await mapDataUrl(page), mapBefore, "nothing was built");
      const after = await readStatus(page);
      assert.equal(after.funds, before.funds, "funds unchanged");
      assert.equal(after.funds, shadow.funds());
      await shot(page, "d-water-refused");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(e) query tool on a zone shows French zone status", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      // The Haight-Ashbury sample is full of zones.
      const map = await readMap(page);
      const zone = findTile(map, ZONE_LABEL);
      assert.ok(zone, "the sample city has a residential zone");

      const funds = (await readStatus(page)).funds;
      await selectTool(page, "query");
      await clickTile(page, zone.x, zone.y);
      const lines = (await readQueryPanel(page)).split("\n");
      assert.equal(lines[0], ZONE_LABEL, "title line names the zone");
      const fieldLines = lines.slice(1);
      assert.ok(fieldLines.length >= 1, "at least one status line");
      const pattern = /^(Densité|Valeur du terrain|Criminalité|Pollution|Croissance) : [a-zéèêûô ]+$/u;
      for (const line of fieldLines) assert.match(line, pattern);
      assert.ok(!lines.join("\n").includes("inconnu"), "every value has a French label");
      assert.equal((await readStatus(page)).funds, funds, "the query costs nothing");
      await shot(page, "e-query-zone");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});

describe("touch", () => {
  test("(i) a tap with touch input places a road tile", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { hasTouch: true });
    try {
      await newCity(page, SEED);
      const shadow = await shadowCity({ seed: Number(SEED) });
      await page.locator('#palette button.tool[data-tool="road"]').tap();
      const map = await readMap(page);
      const tile = findBlock(map, DIRT_LABEL, 1);
      assert.ok(tile, "a dry tile");
      const p = await tileXY(page, tile.x, tile.y);
      const before = await readStatus(page);
      await page.touchscreen.tap(p.x, p.y);
      const after = await readStatus(page);
      const [result, cost] = shadow.preview("road", tile.x, tile.y);
      assert.equal(result, RESULT.OK);
      assert.equal(before.funds - after.funds, cost, "the tap is charged the road cost");
      shadow.down("road", tile.x, tile.y);
      assert.equal(after.funds, shadow.funds());
      assert.equal((await readMap(page)).at(tile.x, tile.y).label, ROAD_LABEL, "a road is built");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
