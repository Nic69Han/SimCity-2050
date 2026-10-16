// End-to-end: the camera of the 3D view (web/view3d-camera.js) on the real wasm engine. The buttons
// and the keys turn the view by quarter turns, zoom through the levels and recentre on the map; the
// camera is read through canvas.cameraState() (a read-only hook of the layer, documented there). A
// phone (390 px, touch) keeps the strip in the corner of the 3D canvas, and no console error shows.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { launchBrowser, openPage, assertNoErrors } from "./helpers.mjs";

const TIMEOUT = 120000;
// Software WebGL in headless Chromium (no GPU in CI); same switches as view3d.test.mjs.
const GL_ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const QUARTER = Math.PI / 2;
const TWO_PI = Math.PI * 2;

const BUTTON = Object.freeze({
  left: "Tourner la vue vers la gauche",
  right: "Tourner la vue vers la droite",
  home: "Recentrer sur toute la carte",
  zoomIn: "Zoom avant",
  zoomOut: "Zoom arrière",
});

let browser;
before(async () => {
  browser = await launchBrowser({ args: GL_ARGS });
});
after(async () => {
  await browser?.close();
});

// The camera as the layer reports it.
const readCamera = (page) => page.evaluate(() => document.getElementById("map3d").cameraState());

// Angle difference reduced to (-π, π].
function angleGap(a, b) {
  const d = ((a - b) % TWO_PI + TWO_PI) % TWO_PI;
  return d > Math.PI ? d - TWO_PI : d;
}

const isQuarterMultiple = (a) => Math.abs(a / QUARTER - Math.round(a / QUARTER)) < 1e-6;

// A right-button drag over the 3D canvas pans the orbit target (OrbitControls: right button pans).
async function panView(page) {
  const box = await page.locator("#map3d").boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + 90, y + 40, { steps: 8 });
  await page.mouse.up({ button: "right" });
}

describe("the camera of the 3D view", () => {
  test("buttons and keys turn, zoom and recentre the view; no console error", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { query: "?lite=1" }); // the camera does not need the scenery
    try {
      await page.locator("#view3d").click();
      await page.waitForFunction(() => document.getElementById("map-frame").classList.contains("is-3d"));
      await page.waitForFunction(() => typeof document.getElementById("map3d").cameraState === "function");
      assert.equal(await page.locator("#view3d-controls").isVisible(), true, "the camera strip is shown");

      const start = await readCamera(page);
      assert.ok(start.map && start.map.w > 0, "the map size is known");
      const home = start.distance;

      // ↻ then ↺: quarter turns, to the quarter multiples
      await page.getByRole("button", { name: BUTTON.right }).click();
      const r1 = await readCamera(page);
      assert.ok(isQuarterMultiple(r1.azimuth), `a quarter multiple after ↻: ${r1.azimuth}`);
      assert.ok(Math.abs(angleGap(r1.azimuth, start.azimuth)) > 0.01, "the view turned");
      assert.ok(Math.abs(r1.distance - start.distance) < 1e-6, "a turn keeps the distance");

      await page.keyboard.press(".");
      const r2 = await readCamera(page);
      assert.ok(Math.abs(angleGap(r2.azimuth, r1.azimuth) - QUARTER) < 1e-6, "the key . turns a quarter more");

      await page.keyboard.press(",");
      await page.keyboard.press(",");
      const r3 = await readCamera(page);
      assert.ok(Math.abs(angleGap(r3.azimuth, r1.azimuth) + QUARTER) < 1e-6, "the key , turns back a quarter, twice");

      // zoom: in, then out, through the levels (the opening level is one of them)
      await page.getByRole("button", { name: BUTTON.zoomIn }).click();
      const z1 = await readCamera(page);
      assert.ok(z1.distance < home - 1e-6, `zoom in brings the camera closer: ${z1.distance} < ${home}`);
      await page.keyboard.press("=");
      const z2 = await readCamera(page);
      assert.ok(z2.distance < z1.distance - 1e-6, "the key = zooms in one more level");
      await page.keyboard.press("-");
      await page.getByRole("button", { name: BUTTON.zoomOut }).click();
      const z3 = await readCamera(page);
      assert.ok(Math.abs(z3.distance - home) < 1e-6, "zoom out twice is back to the opening level");

      // pan away from the middle of the map, then recentre with the key Début (Home)
      await panView(page);
      const panned = await readCamera(page);
      const mid = { x: panned.map.w / 2, z: panned.map.h / 2 };
      assert.ok(
        Math.abs(panned.target.x - mid.x) > 0.5 || Math.abs(panned.target.z - mid.z) > 0.5,
        "the pan moved the target away from the middle",
      );
      await page.keyboard.press("Home");
      const h1 = await readCamera(page);
      assert.ok(Math.abs(h1.target.x - mid.x) < 1e-6 && Math.abs(h1.target.z - mid.z) < 1e-6, "Home recentres the target");
      assert.ok(Math.abs(h1.distance - home) < 1e-6, "Home goes back to the opening zoom");

      // the button ⌂ recentres too
      await panView(page);
      await page.getByRole("button", { name: BUTTON.home }).click();
      const h2 = await readCamera(page);
      assert.ok(Math.abs(h2.target.x - mid.x) < 1e-6 && Math.abs(h2.target.z - mid.z) < 1e-6, "⌂ recentres the target");

      // a key typed in a field is not a camera key: the range input takes the focus
      await page.locator("#speed").focus();
      const before = await readCamera(page);
      await page.keyboard.press(".");
      const typed = await readCamera(page);
      assert.equal(typed.azimuth, before.azimuth, "the key . in a field does not turn the view");
      await page.locator("#view3d").focus();

      // «Vue 2D»: the strip is hidden again and the camera hook is gone
      await page.locator("#view3d").click();
      await page.waitForFunction(() => !document.getElementById("map-frame").classList.contains("is-3d"));
      assert.equal(await page.locator("#view3d-controls").isHidden(), true, "the strip is hidden in 2D");
      assert.equal(
        await page.evaluate(() => document.getElementById("map3d").cameraState === undefined),
        true,
        "the camera hook is removed at dispose",
      );
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a phone (390 px, touch): the strip stays in the corner of the 3D canvas and a tap turns the view", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { query: "?lite=1", viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
      await page.locator("#view3d").tap();
      await page.waitForFunction(() => document.getElementById("map-frame").classList.contains("is-3d"));
      await page.waitForFunction(() => typeof document.getElementById("map3d").cameraState === "function");

      const strip = await page.locator("#view3d-controls").boundingBox();
      const canvas = await page.locator("#map3d").boundingBox();
      assert.ok(strip && canvas, "the strip and the 3D canvas are on the page");
      assert.ok(strip.x >= canvas.x && strip.x + strip.width <= canvas.x + canvas.width, "the strip is inside the canvas, across");
      assert.ok(strip.y >= canvas.y && strip.y + strip.height <= canvas.y + canvas.height, "the strip is inside the canvas, down");
      assert.ok(strip.x + strip.width <= 390, "the strip is on the screen");
      assert.ok(strip.width <= 0.4 * canvas.width, `the strip covers less than 40% of the map width: ${strip.width} of ${canvas.width}`);
      assert.ok(strip.height <= 0.5 * canvas.height, `the strip covers less than half of the map height: ${strip.height} of ${canvas.height}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, `no horizontal page scroll in the 3D view: ${overflow}px`);

      const before = await readCamera(page);
      await page.getByRole("button", { name: BUTTON.right }).tap();
      const after = await readCamera(page);
      assert.ok(Math.abs(angleGap(after.azimuth, before.azimuth)) > 0.01, "a tap turns the view");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
