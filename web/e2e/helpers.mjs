// Shared helpers for the end-to-end tests of the page (web/) on the real wasm engine.
//
// Three things live here:
//   - the browser: Playwright launch, a page with console/page error collection;
//   - reading the page: the status line (date, funds, seed), the tool message, the query
//     panel, and the map, read from the canvas pixels (the page keeps no state we can see);
//   - a "shadow" engine: the same wasm package (web/pkg) loaded in Node, from the same
//     bytes as the page. It gives the exact cost of a tool at a tile (tool_preview), which
//     the page draws as the hover label. The label is painted on a canvas, so the DOM
//     cannot read it; the shadow reads the same engine method instead. The page's funds
//     are checked against the shadow's after every action.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PALETTE } from "../palette.js";
import { TILE_PX } from "../tools.js";
import { formatStatus, formatStats } from "../status.js";

export { TILE_PX };

const GLOBAL_PLAYWRIGHT = "/opt/node22/lib/node_modules/playwright/index.mjs";
// Chromium already installed on this machine (Playwright 1.56.1 build 1194). Unset in CI,
// where `npx playwright install chromium` provides the browser Playwright expects.
const LOCAL_CHROMIUM = "/opt/pw-browsers/chromium";

// URL of the served web/ directory (set by scripts/e2e.sh), with a trailing slash.
export function baseUrl() {
  const url = process.env.E2E_BASE_URL;
  if (!url) throw new Error("E2E_BASE_URL is not set: run scripts/e2e.sh");
  return url.endsWith("/") ? url : `${url}/`;
}

// Directory for screenshots of key states (not committed). Unset: no screenshots.
const SHOTS_DIR = process.env.E2E_SHOTS_DIR || null;

export const MONTHS = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
export const START_FUNDS = 20000;

export async function loadPlaywright() {
  if (existsSync(GLOBAL_PLAYWRIGHT)) return import(GLOBAL_PLAYWRIGHT);
  return import("playwright");
}

export async function launchBrowser() {
  const { chromium } = await loadPlaywright();
  const executablePath = process.env.E2E_CHROMIUM || (existsSync(LOCAL_CHROMIUM) ? LOCAL_CHROMIUM : undefined);
  return chromium.launch({ headless: true, executablePath });
}

// A new browser context and page on the app, with every console error, page error and
// failed HTTP response collected in `errors`. Call assertNoErrors(errors) at the end of a test.
export async function openPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    locale: "fr-FR",
    ...options,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
  // The page first draws an empty city, then fetches the sample; wait for the sample.
  const sample = page.waitForResponse((r) => r.url().endsWith("/cities/haight.cty"));
  await page.goto(baseUrl());
  await sample;
  await waitForReady(page);
  return {
    page,
    errors,
    close: () => context.close(),
  };
}

// The page is ready when the palette is built and the Haight-Ashbury sample is drawn: its
// status line shows the sample's funds (1 000 000 $), not the empty city drawn before it.
export async function waitForReady(page) {
  await page.waitForFunction(() => {
    const status = document.getElementById("status")?.textContent ?? "";
    // the grouping separator of fr-FR is a narrow no-break space: compare without spaces
    return document.querySelectorAll("#palette button.tool").length > 0 &&
      status.replace(/\s/g, "").includes("1000000$");
  });
}

export function assertNoErrors(errors) {
  if (errors.length) throw new Error(`page reported errors:\n${errors.join("\n")}`);
}

// Parses the status line: "Graine 4242 · jan 1900 · 20 000 $" (the seed part is optional).
export function parseStatus(text) {
  const m = /^(?:Graine (-?\d+) · )?(\S+) (\d{4}) · (-?[\d\s]+) \$$/u.exec(text.trim());
  if (!m) throw new Error(`unexpected status line: "${text}"`);
  return {
    seed: m[1] === undefined ? null : Number(m[1]),
    month: m[2],
    monthIndex: MONTHS.indexOf(m[2]),
    year: Number(m[3]),
    funds: Number(m[4].replace(/\s/g, "")),
    text,
  };
}

export async function readStatus(page) {
  return parseStatus(await page.locator("#status").textContent());
}

export async function readFunds(page) {
  return (await readStatus(page)).funds;
}

// Text of the aria-live tool message ("" for success).
export async function readToolMessage(page) {
  return (await page.locator("#tool-msg").textContent()).trim();
}

export async function readQueryPanel(page) {
  return page.locator("#query-panel").evaluate((el) => (el.hidden ? null : el.innerText.trim()));
}

// Canvas geometry in client (viewport) coordinates. Scrolls the map into view first, so the
// returned rectangle is the one the mouse must use.
export async function geometry(page) {
  await page.locator("#map").scrollIntoViewIfNeeded();
  return page.evaluate((tilePx) => {
    const c = document.getElementById("map");
    const r = c.getBoundingClientRect();
    return { w: c.width / tilePx, h: c.height / tilePx, left: r.left, top: r.top, width: r.width, height: r.height };
  }, TILE_PX);
}

// Viewport position of the centre of tile (x, y).
export async function tileXY(page, x, y) {
  const g = await geometry(page);
  return { x: g.left + ((x + 0.5) * g.width) / g.w, y: g.top + ((y + 0.5) * g.height) / g.h };
}

export async function clickTile(page, x, y) {
  const p = await tileXY(page, x, y);
  await page.mouse.click(p.x, p.y);
}

// Press on the first tile, move through the others (one pointermove per tile), release.
export async function dragTiles(page, tiles) {
  const first = await tileXY(page, tiles[0].x, tiles[0].y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const t of tiles.slice(1)) {
    const p = await tileXY(page, t.x, t.y);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
}

export async function selectTool(page, key) {
  await page.locator(`#palette button.tool[data-tool="${key}"]`).click();
}

// Tool buttons: [{ key, label, cost text, pressed }] in palette order.
export async function readPalette(page) {
  return page.$$eval("#palette button.tool", (buttons) =>
    buttons.map((b) => ({
      key: b.dataset.tool,
      label: b.querySelector(".tool-name")?.textContent ?? "",
      cost: b.querySelector(".tool-cost")?.textContent ?? "",
      pressed: b.getAttribute("aria-pressed") === "true",
    })));
}

// The map as the page draws it: one colour per tile, sampled at the tile centre of the
// canvas backing store (exact: the canvas is not resampled). Tiles are indexed by x and y.
export async function readMap(page) {
  const { w, h, hexes } = await page.evaluate((tilePx) => {
    const c = document.getElementById("map");
    const { data } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    const w = c.width / tilePx;
    const h = c.height / tilePx;
    const hexes = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((y * tilePx + 3) * c.width + (x * tilePx + 3)) * 4;
        hexes[y * w + x] = ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]).toString(16).padStart(6, "0");
      }
    }
    return { w, h, hexes };
  }, TILE_PX);
  return {
    w,
    h,
    at(x, y) {
      const hex = `#${hexes[y * w + x]}`;
      const entry = PALETTE.find((e) => e.color.toLowerCase() === hex);
      return { hex, label: entry ? entry.label : "couleur inconnue" };
    },
  };
}

export const DIRT_LABEL = "Terrain nu";
export const WATER_LABEL = "Eau";
export const ROAD_LABEL = "Route";

// Colour of a tile kind in the palette (hex, lowercase), from its label.
export function colorOf(label) {
  const e = PALETTE.find((p) => p.label === label);
  if (!e) throw new Error(`no palette entry labelled ${label}`);
  return e.color.toLowerCase();
}

// Shadow engine ----------------------------------------------------------------------------

let glue = null;

// The wasm package as Node loads it (wasm-bindgen --target web, initSync with the bytes).
export async function engine() {
  if (glue) return glue;
  const pkg = new URL("../pkg/micropolis_wasm.js", import.meta.url);
  const wasm = new URL("../pkg/micropolis_wasm_bg.wasm", import.meta.url);
  if (!existsSync(wasm)) throw new Error("web/pkg is missing: run scripts/build-web.sh (or scripts/e2e.sh)");
  glue = await import(pkg.href);
  glue.initSync({ module: await readFile(wasm) });
  return glue;
}

// A City on the same bytes as the page: a sample .cty (bytes) or a random city (seed).
export async function shadowCity({ cty = null, seed = null } = {}) {
  const { City } = await engine();
  const city = new City(1);
  if (cty) city.load_cty(cty);
  if (seed !== null) city.new_random_city(seed);
  return new Shadow(city);
}

export async function readSample(name) {
  return readFile(new URL(`../cities/${name}.cty`, import.meta.url));
}

export class Shadow {
  constructor(city) {
    this.city = city;
    this.tools = [];
    for (let i = 0; i < city.tool_count(); i++) {
      const [id, cost, size] = city.tool_info(i);
      this.tools.push({ id, key: city.tool_key(i), cost, size });
    }
  }

  tool(key) {
    const t = this.tools.find((x) => x.key === key);
    if (!t) throw new Error(`no tool ${key}`);
    return t;
  }

  // [result, cost] of tool `key` at (x, y): what the hover label shows.
  preview(key, x, y) {
    return Array.from(this.city.tool_preview(this.tool(key).id, x, y));
  }

  footprint(key, x, y) {
    return Array.from(this.city.tool_footprint(this.tool(key).id, x, y));
  }

  funds() {
    return this.city.funds();
  }

  // Applies the same action the page does, so the funds can be compared after it.
  down(key, x, y) {
    return this.city.tool_down(this.tool(key).id, x, y);
  }

  drag(key, x0, y0, x1, y1) {
    this.city.tool_drag(this.tool(key).id, x0, y0, x1, y1);
  }
}

// Screenshots -------------------------------------------------------------------------------

export async function shot(page, name) {
  if (!SHOTS_DIR) return;
  const { mkdir } = await import("node:fs/promises");
  await mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png`, fullPage: true });
}

// Page actions shared by the tests ---------------------------------------------------------

// "Nouvelle ville" with the given seed text. The page draws the new city synchronously.
export async function newCity(page, seedText) {
  await page.fill("#seed", seedText);
  await page.click("#newcity-btn");
}

// The hover outline drawn on the overlay at tile (x, y), read from the overlay pixels at the
// tile centre: "ok" (green, the placement would work), "bad" (red) or "none" (nothing drawn).
// The page paints the outline with a translucent fill, so the verdict is by channel.
export async function outlineAt(page, x, y) {
  const [r, g, b, a] = await page.evaluate(
    ([tilePx, tx, ty]) => {
      const o = document.getElementById("overlay");
      const d = o.getContext("2d").getImageData(tx * tilePx + 3, ty * tilePx + 3, 1, 1).data;
      return Array.from(d);
    },
    [TILE_PX, x, y],
  );
  if (a === 0) return "none";
  if (g > r && g > b) return "ok";
  if (r > g && r > b) return "bad";
  return "none";
}

// Moves the pointer over tile (x, y) without pressing, so the hover outline is drawn there.
export async function hoverTile(page, x, y) {
  const p = await tileXY(page, x, y);
  await page.mouse.move(p.x, p.y);
}

// Map pixels as a canvas data URL (identical maps give identical strings).
export async function mapDataUrl(page) {
  return page.evaluate(() => document.getElementById("map").toDataURL("image/png"));
}

// Waits until the status line differs from `before` (the page redraws after each change).
export async function waitStatusChange(page, before, timeout = 10000) {
  await page.waitForFunction((prev) => document.getElementById("status").textContent !== prev, before, { timeout });
}

// First run of at least `length` tiles in a row, all with the label, as [{x, y}] (or null).
export function findRun(map, label, length) {
  for (let y = 0; y < map.h; y++) {
    let run = [];
    for (let x = 0; x < map.w; x++) {
      if (map.at(x, y).label === label) {
        run.push({ x, y });
        if (run.length === length) return run;
      } else {
        run = [];
      }
    }
  }
  return null;
}

// Top-left corner (x, y) of the first `size` x `size` block whose tiles all have the label.
export function findBlock(map, label, size) {
  for (let y = 0; y + size <= map.h; y++) {
    for (let x = 0; x + size <= map.w; x++) {
      let ok = true;
      for (let dy = 0; dy < size && ok; dy++) {
        for (let dx = 0; dx < size; dx++) {
          if (map.at(x + dx, y + dy).label !== label) {
            ok = false;
            break;
          }
        }
      }
      if (ok) return { x, y };
    }
  }
  return null;
}

// First tile with the label, as {x, y}, or null.
export function findTile(map, label) {
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.at(x, y).label === label) return { x, y };
    }
  }
  return null;
}

// Polls `check` (an async function) every 100 ms until it returns true; throws on timeout.
export async function pollUntil(check, what, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Playback -----------------------------------------------------------------------------------

// Counts the animation frames the page runs (not the ones it requests): window.__frames.
// Idempotent; call it after the page has loaded.
export async function countFrames(page) {
  await page.evaluate(() => {
    if (window.__frames !== undefined) return;
    window.__frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      cb(t);
      window.__frames++;
    });
  });
}

// Plays for `frames` frames (about one second at 60 Hz per 60), then pauses. Returns what the
// page showed at the pause: the frames it ran in this stretch, and its status and stats lines.
// No frame runs after the pause, so the three values describe the same moment.
export async function playFrames(page, frames) {
  const from = await page.evaluate(() => window.__frames);
  await page.click("#play");
  await pollUntil(
    async () => (await page.evaluate(() => window.__frames)) - from >= frames,
    `${frames} frames of play`,
    60000,
  );
  await page.click("#play");
  return page.evaluate((start) => ({
    ran: window.__frames - start,
    status: document.getElementById("status").textContent,
    stats: document.getElementById("stats").textContent,
  }), from);
}

// The text the page shows for the shadow engine's state: what it must show after the same
// ticks. `seed` is the seed the page shows ("Graine ...") for a city made by Nouvelle ville.
export function expectedText(city, seed = null) {
  const demand = Array.from(city.demand());
  return {
    status: formatStatus({ seed, month: city.month(), year: city.year(), funds: city.funds() }),
    stats: formatStats({ population: city.population(), score: city.score(), demand }),
  };
}

// Sets the value of a range or number input and fires its "input" event, as a user would.
export async function setSlider(page, selector, value) {
  await page.$eval(selector, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, String(value));
}

// Finds the first tile where the shadow engine's tool preview returns `code`, scanning the
// whole map, as {x, y} (or null).
export function findPreview(shadow, key, code) {
  const w = shadow.city.width();
  const h = shadow.city.height();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (shadow.preview(key, x, y)[0] === code) return { x, y };
    }
  }
  return null;
}
