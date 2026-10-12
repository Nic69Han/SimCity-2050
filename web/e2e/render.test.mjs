// End-to-end: the map as a picture. Tile art (not flat colours), a road drawn by the tool, the
// moving objects on their own layer, the map views (heat layers) and their keyboard, and a paused
// map that does not move.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, readMap, selectTool, clickTile, findBlock, shot,
  pollUntil, playFrames, countFrames, mapDataUrl, DIRT_LABEL, ROAD_LABEL, TILE_PX,
} from "./helpers.mjs";

const TIMEOUT = 120000;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

// RGBA pixels of the tile (x, y) of the map canvas, as a string (equal tiles give equal strings).
async function tileDigest(page, x, y) {
  return page.evaluate(
    ([px, tx, ty]) => {
      const c = document.getElementById("map");
      const d = c.getContext("2d").getImageData(tx * px, ty * px, px, px).data;
      return Array.from(d).join(",");
    },
    [TILE_PX, x, y],
  );
}

// Distinct opaque colours on the map canvas (all pixels).
async function distinctColours(page) {
  return page.evaluate(() => {
    const c = document.getElementById("map");
    const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return seen.size;
  });
}

// The canvas of the moving objects: the canvases of the map frame that are neither the map, the
// tool overlay nor a hidden layer.
async function spriteLayer(page) {
  return page.evaluate(() => {
    const frame = document.getElementById("map-frame");
    const c = Array.from(frame.querySelectorAll("canvas")).find((k) => k.id !== "map" && k.id !== "overlay" && !k.hidden);
    if (!c) return null;
    const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return { painted, pointerEvents: getComputedStyle(c).pointerEvents, ariaHidden: c.getAttribute("aria-hidden") };
  });
}

// Pixels of the view (heat) layer, as a string, or null while it is hidden.
async function viewLayer(page) {
  return page.evaluate(() => {
    const frame = document.getElementById("map-frame");
    const c = Array.from(frame.querySelectorAll("canvas")).find((k) => k.id !== "map" && k.id !== "overlay" && k.hidden !== undefined && k.getAttribute("aria-hidden") === "true" && !frame.querySelector("#map").isSameNode(k));
    if (!c || c.hidden) return null;
    const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    let h = 0;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]) painted++;
      h = (h * 31 + data[i] + data[i + 3] * 7) >>> 0;
    }
    return { hash: h, painted };
  });
}

describe("the map as tile art", () => {
  test("(r1) the map is drawn with tile art: many colours, not one colour per tile kind", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const colours = await distinctColours(page);
      assert.ok(colours >= 60, `${colours} distinct colours on the Haight-Ashbury map (a flat map has about 20)`);
      await shot(page, "r1-haight");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(r2) a road drawn with the tool looks different from the dirt it replaces, and from other dirt", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const map = await readMap(page);
      const dirt = findBlock(map, DIRT_LABEL, 1);
      const before = await tileDigest(page, dirt.x, dirt.y);
      // another dirt tile, to compare dirt with dirt (the variants differ only a little)
      let other = null;
      for (let x = 0; x < map.w && !other; x++) {
        for (let y = 0; y < map.h && !other; y++) {
          if ((x !== dirt.x || y !== dirt.y) && map.at(x, y).label === DIRT_LABEL) other = { x, y };
        }
      }
      await selectTool(page, "road");
      await clickTile(page, dirt.x, dirt.y);
      await pollUntil(async () => (await readMap(page)).at(dirt.x, dirt.y).label === ROAD_LABEL, "the road to be drawn");
      const after = await tileDigest(page, dirt.x, dirt.y);
      assert.notEqual(after, before, "the road tile is drawn differently from the dirt");
      // asphalt is a dark grey (the red, green and blue within a few levels of each other)
      const asphalt = await page.evaluate(([px, tx, ty]) => {
        const d = document.getElementById("map").getContext("2d").getImageData(tx * px, ty * px, px, px).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          if (max < 130 && max - min < 16) n++;
        }
        return n;
      }, [TILE_PX, dirt.x, dirt.y]);
      assert.ok(asphalt >= 12, `the road shows grey asphalt (${asphalt} pixels of ${TILE_PX * TILE_PX})`);
      if (other) assert.notEqual(await tileDigest(page, other.x, other.y), after, "and differs from other dirt");
      await shot(page, "r2-road");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(r3) a paused map does not change; while playing, the map moves (shimmer and the moving objects)", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const paused1 = await mapDataUrl(page);
      await page.waitForTimeout(700);
      assert.equal(await mapDataUrl(page), paused1, "nothing is drawn while paused");
      await page.click("#play");
      await pollUntil(async () => (await mapDataUrl(page)) !== paused1, "the map to change while playing", 20000);
      await page.click("#play");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});

describe("moving objects", () => {
  test("(r4) Kyoto's trains are drawn on a transparent layer that takes no pointer events", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await page.selectOption("#city", "kyoto");
      await pollUntil(async () => (await spriteLayer(page)) !== null, "the sprite layer");
      await countFrames(page);
      await playFrames(page, 60);
      const layer = await spriteLayer(page);
      assert.ok(layer.painted > 0, "the moving objects are painted on the layer");
      assert.equal(layer.pointerEvents, "none", "the layer takes no pointer events");
      assert.equal(layer.ariaHidden, "true");
      await shot(page, "r4-kyoto-sprites");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});

describe("map views", () => {
  test("(r5) each view draws its heat layer, the normal view draws none, and the legend names the view", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      assert.equal(await page.locator("#view-modes").isVisible(), true, "the view selector is shown");
      assert.equal(await viewLayer(page), null, "the normal view draws no heat layer");
      const seen = new Map();
      for (const id of ["densite", "valeur", "criminalite", "pollution", "trafic", "reseau", "pompiers", "police"]) {
        await page.click(`#view-modes button[data-view="${id}"]`);
        await pollUntil(async () => (await viewLayer(page)) !== null, `the ${id} layer`);
        const layer = await viewLayer(page);
        assert.ok(layer.painted > 0, `${id} paints some tiles`);
        assert.equal(await page.getAttribute(`#view-modes button[data-view="${id}"]`, "aria-pressed"), "true");
        seen.set(id, layer.hash);
        assert.ok((await page.textContent("#view-legend")).length > 0, `${id} has a legend`);
      }
      assert.ok(new Set(seen.values()).size >= 4, "the views differ from one another");
      await page.click('#view-modes button[data-view="normal"]');
      await pollUntil(async () => (await viewLayer(page)) === null, "the heat layer to go");
      await shot(page, "r5-normal-after-views");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(r6) the view selector works from the keyboard (Tab to a view, Enter selects it)", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      const button = page.locator('#view-modes button[data-view="pollution"]');
      await button.focus();
      await page.keyboard.press("Enter");
      await pollUntil(async () => (await viewLayer(page)) !== null, "the pollution layer by keyboard");
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      await page.keyboard.press("Tab");
      const next = await page.evaluate(() => document.activeElement?.dataset?.view ?? document.activeElement?.id);
      assert.ok(next, "focus moves on from the view button");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
