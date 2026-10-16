// End-to-end: the relief rules and the terraforming tools (roadmap step 1). The main suite runs on
// the mock engine (?mock=1: web/test/mock-engine.mjs, same seed as the page's first city), so it
// needs no wasm terraform. The second suite runs on the real wasm engine and is skipped, with the
// reason, while that build has no terraform().
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MockCity } from "../test/mock-engine.mjs";
import {
  launchBrowser, baseUrl, assertNoErrors, readFunds, readToolMessage, selectTool, pollUntil,
  engine, shadowCity, readSample,
} from "./helpers.mjs";

const TIMEOUT = 120000;
// Software WebGL in headless Chromium (no GPU in CI), as in view3d.test.mjs.
const GL_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const DIRT = 0, WATER = 2;
const MSG_REFUSED = "Impossible de construire ici";

let browser;
before(async () => {
  browser = await launchBrowser({ args: GL_ARGS });
});
after(async () => {
  await browser?.close();
});

// The page on the mock engine (no sample is fetched): ready once the palette is built and the
// status line shows the city, not the loading text.
async function openMock(b) {
  const context = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
  await page.goto(`${baseUrl()}?mock=1&lite=1`);
  await page.waitForFunction(() => {
    const status = document.getElementById("status")?.textContent ?? "";
    return document.querySelectorAll("#palette button.tool").length > 0 && !status.includes("Chargement");
  });
  return { page, errors, close: () => context.close() };
}

const reliefButton = (page, key) => page.locator(`#palette button.tool[data-tool="${key}"]`);

// Switches to the 3D view (the button toggles; the mock's city is drawn in it).
async function show3d(page) {
  await page.locator("#view3d").click();
  await page.waitForFunction(() => document.getElementById("map-frame").classList.contains("is-3d"));
}

// Client position of tile (x, y) in the 3D canvas, or null when it is not inside the canvas.
async function screenOf(page, x, y) {
  return page.evaluate(([tx, ty]) => {
    const canvas = document.getElementById("map3d");
    const r = canvas.getBoundingClientRect();
    const q = canvas.tileScreen(tx, ty);
    const inside = q.x > r.left + 4 && q.x < r.right - 4 && q.y > r.top + 4 && q.y < r.bottom - 4;
    return inside ? q : null;
  }, [x, y]);
}

// A tile of `city` (a shadow engine) that is visible in the 3D canvas and passes `ok(x, y)`.
async function visibleTile(page, city, ok) {
  const w = city.width(), h = city.height();
  const cells = [];
  for (let x = 1; x < w - 1; x++) for (let y = 1; y < h - 1; y++) if (ok(x, y)) cells.push({ x, y, d: Math.abs(x - w / 2) + Math.abs(y - h / 2) });
  cells.sort((a, b) => a.d - b.d);
  for (const c of cells.slice(0, 200)) {
    const p = await page.evaluate(([x, y]) => {
      const canvas = document.getElementById("map3d");
      const r = canvas.getBoundingClientRect();
      const q = canvas.tileScreen(x, y);
      const inside = q.x > r.left + 4 && q.x < r.right - 4 && q.y > r.top + 4 && q.y < r.bottom - 4;
      return inside ? q : null;
    }, [c.x, c.y]);
    if (p) return { x: c.x, y: c.y, p };
  }
  return null;
}

// Hash of the 3D canvas as the page draws it (a PNG screenshot).
async function canvasHash(page) {
  return createHash("sha1").update(await page.locator("#map3d").screenshot()).digest("hex");
}

describe("relief rules on the mock engine (?mock=1)", () => {
  test("the checkbox, the disabled buttons with their reasons, and the 3D terraforming", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openMock(browser);
    try {
      const box = page.locator("#relief");
      assert.equal(await page.locator("#relief-label").isVisible(), true, "the checkbox is shown");
      assert.match(await page.locator("#relief-label").getAttribute("title"), /pente coûte du terrassement/u);
      assert.equal(await box.isChecked(), false, "rules off by default");
      assert.equal(await reliefButton(page, "relever").isDisabled(), true);
      assert.match(await reliefButton(page, "relever").getAttribute("title"), /Activez « Règles de relief »/u);

      // rules on, still in 2D: the buttons stay disabled and say why
      await box.check();
      assert.equal(await reliefButton(page, "abaisser").isDisabled(), true);
      assert.match(await reliefButton(page, "abaisser").getAttribute("title"), /vue 3D/u);
      await page.evaluate(() => document.activeElement?.blur()); // a focused checkbox takes no shortcut
      await page.keyboard.press("u");
      assert.match(await readToolMessage(page), /vue 3D/u, "the shortcut says why it does nothing");
      assert.equal(await reliefButton(page, "relever").getAttribute("aria-pressed"), "false", "not selected");

      // 3D: the buttons are on; the engine (the same mock, same seed) gives the costs
      await show3d(page);
      assert.equal(await reliefButton(page, "relever").isDisabled(), false);
      const shadow = new MockCity(1);
      shadow.set_relief_rules(true);
      const dirt = (x, y) => shadow.tiles()[x * shadow.height() + y] === DIRT;
      const spot = await visibleTile(page, shadow, (x, y) => dirt(x, y) && shadow.terraform_preview(x, y, 1)[0] === 1);
      assert.ok(spot, "a visible dirt tile that can be raised");

      // water first, before any tile in front of it is raised: the refusal, nothing charged
      // a lake tile of the seed-1 city that the camera sees: the hills in front of the other lake
      // tiles hide them, and a click there lands on the hill
      assert.equal(shadow.tiles()[4 * shadow.height() + 3], WATER, "(4, 3) is lake");
      const water = { x: 4, y: 3, p: await screenOf(page, 4, 3) };
      assert.ok(water.p, "(4, 3) is on the 3D canvas");
      const funds3 = await readFunds(page);
      await selectTool(page, "relever");
      await page.mouse.click(water.p.x, water.p.y);
      await pollUntil(async () => (await readToolMessage(page)) === MSG_REFUSED, "the refusal message");
      assert.equal(await readFunds(page), funds3, "nothing charged for a refused step");

      await selectTool(page, "relever");
      await page.mouse.move(spot.p.x, spot.p.y); // the hover outline is in both shots
      const shotBefore = await canvasHash(page);
      const funds = await readFunds(page);
      await page.mouse.click(spot.p.x, spot.p.y);
      shadow.terraform(spot.x, spot.y, 1);
      await pollUntil(async () => (await readFunds(page)) !== funds, "the funds to change after a raise");
      assert.equal(await readFunds(page), shadow.funds(), "the engine charged what the shadow engine charges");
      assert.equal(await readToolMessage(page), "", "a raise that worked says nothing");
      await pollUntil(async () => (await canvasHash(page)) !== shotBefore, "the 3D canvas to show the raised tile");

      // lowering it again, with the other tool
      await selectTool(page, "abaisser");
      const funds2 = await readFunds(page);
      await page.mouse.click(spot.p.x, spot.p.y);
      shadow.terraform(spot.x, spot.y, -1);
      await pollUntil(async () => (await readFunds(page)) !== funds2, "the funds to change after a lower");
      assert.equal(await readFunds(page), shadow.funds());

      // back to 2D: the buttons are disabled again, a selected one is dropped
      await page.locator("#view3d").click();
      await page.waitForFunction(() => !document.getElementById("map-frame").classList.contains("is-3d"));
      assert.equal(await reliefButton(page, "relever").isDisabled(), true);
      assert.equal(await reliefButton(page, "relever").getAttribute("aria-pressed"), "false", "dropped in 2D");

      // rules off: back to the reason of the checkbox
      await box.uncheck();
      assert.equal(await box.isChecked(), false);
      assert.match(await reliefButton(page, "relever").getAttribute("title"), /Activez/u);
      assert.equal(await reliefButton(page, "relever").isDisabled(), true);

      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a new city and a loaded file show the engine's flag (off), not the checkbox", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openMock(browser);
    try {
      await page.locator("#relief").check();
      assert.equal(await page.locator("#relief").isChecked(), true);

      await page.locator("#seed").fill("42");
      await page.locator("#newcity-btn").click();
      await pollUntil(async () => (await page.locator("#status").textContent()).includes("Graine 42"), "the new city");
      assert.equal(await page.locator("#relief").isChecked(), false, "a new city starts with the rules off");
      assert.equal(await reliefButton(page, "relever").isDisabled(), true);

      await page.locator("#relief").check();
      await page.setInputFiles("#file", { name: "ville.cty", mimeType: "application/octet-stream", buffer: Buffer.from([0, 0, 0, 0]) });
      await pollUntil(async () => !(await page.locator("#relief").isChecked()), "the checkbox to show the loaded city's flag");
      assert.equal(await reliefButton(page, "abaisser").isDisabled(), true);

      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});

// The real wasm build: the relief suite runs only when its terraform() exists.
const realSkip = await (async () => {
  try {
    const { City } = await engine();
    return typeof new City(1).terraform === "function"
      ? false
      : "the real wasm build has no terraform() yet: the relief e2e on the real engine is skipped (the mock suite ran)";
  } catch (e) {
    return `the wasm package is not built (${e.message}): the relief e2e on the real engine is skipped`;
  }
})();

describe("relief rules on the real wasm engine", { skip: realSkip }, () => {
  test("the real city: raise a tile in 3D, the funds match the engine", { timeout: TIMEOUT }, async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
    const sample = page.waitForResponse((r) => r.url().endsWith("/cities/haight.cty"));
    await page.goto(`${baseUrl()}?lite=1`); // the relief tools do not need the scenery
    await sample;
    await pollUntil(async () => (await readFunds(page)) === 1000000, "the sample city");
    try {
      await page.locator("#relief").check();
      await show3d(page);
      const shadow = await shadowCity({ cty: await readSample("haight") });
      shadow.city.set_relief_rules(true);
      const city = shadow.city;
      const spot = await visibleTile(page, city,
        (x, y) => city.tiles()[x * city.height() + y] === DIRT && city.terraform_preview(x, y, 1)[0] === 1);
      assert.ok(spot, "a visible dirt tile that can be raised");
      await selectTool(page, "relever");
      const funds = await readFunds(page);
      await page.mouse.click(spot.p.x, spot.p.y);
      city.terraform(spot.x, spot.y, 1);
      await pollUntil(async () => (await readFunds(page)) !== funds, "the funds to change");
      assert.equal(await readFunds(page), city.funds(), "the engine charged what the shadow engine charges");
      assertNoErrors(errors);
    } finally {
      await context.close();
    }
  });
});
