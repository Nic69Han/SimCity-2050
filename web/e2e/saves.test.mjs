// End-to-end: saved games on the real engine and a real IndexedDB in Chromium. Autosave is written
// on demand with window.__saves.flush() (a dev hook, web/test/README.md): the timer is a minute.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, readStatus, readFunds, mapDigest, selectTool, clickTile,
  shadowCity, readSample, findPreview, pollUntil, shot, setSlider,
} from "./helpers.mjs";

const TIMEOUT = 90000;
const HAIGHT_FUNDS = 1000000; // the funds of the Haight-Ashbury sample
let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

// Builds a road on the k-th tile (in scan order) where the engine says a road fits: the funds change.
async function buildRoad(page, k = 0) {
  const before = await readFunds(page);
  const shadow = await shadowCity({ cty: await readSample("haight") });
  const at = placeableTiles(shadow, "road")[k];
  assert.ok(at, "the sample has a tile where a road fits");
  await selectTool(page, "road");
  await clickTile(page, at.x, at.y);
  await pollUntil(async () => (await readFunds(page)) < before, "the road to be paid");
}

// Every tile where tool `key` fits (RESULT.OK), in scan order, as {x, y}.
function placeableTiles(shadow, key) {
  const out = [];
  for (let y = 0; y < shadow.city.height(); y++) {
    for (let x = 0; x < shadow.city.width(); x++) {
      if (shadow.preview(key, x, y)[0] === 1) out.push({ x, y });
    }
  }
  return out;
}

// The same digest as the page's mapDigest, of the engine's tiles (for the shadow engine).
function digestOf(tiles, w, h) {
  let hash = 0x811c9dc5;
  for (const t of tiles) hash = Math.imul(hash ^ t, 0x01000193) >>> 0;
  return `${w}x${h}:${hash.toString(16)}`;
}

// The IndexedDB record `id` as the page stores it (bytes as an array), or null.
async function readIdb(page, id) {
  return page.evaluate((key) => new Promise((resolve, reject) => {
    const open = indexedDB.open("micropolis", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const get = db.transaction("games", "readonly").objectStore("games").get(key);
      get.onsuccess = () => {
        const r = get.result;
        db.close();
        resolve(r ? { id: r.id, name: r.name, bytes: r.bytes instanceof Uint8Array ? Array.from(r.bytes) : null } : null);
      };
      get.onerror = () => reject(get.error);
    };
  }), id);
}

// Writes a record as it is (valid or not) into IndexedDB, for the corrupted-record tests.
async function writeIdb(page, record) {
  await page.evaluate((r) => new Promise((resolve, reject) => {
    const open = indexedDB.open("micropolis", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("games", "readwrite");
      tx.objectStore("games").put(typeof r.bytes === "string" ? r : { ...r, bytes: new Uint8Array(r.bytes) });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  }), record);
}

async function openPanel(page) {
  if ((await page.locator("#saves-panel").getAttribute("hidden")) !== null) await page.click("#saves-toggle");
}

describe("saved games", () => {
  test("(s1) autosave, reload: the banner offers the game; Reprendre restores funds and map; the shadow engine agrees", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await buildRoad(page, 0);
      const funds = await readFunds(page);
      const statusText = (await readStatus(page)).text;
      assert.equal(await page.evaluate(() => window.__saves.flush()), "saved");

      await page.reload();
      await page.waitForSelector("#resume-banner:not([hidden])", { timeout: 30000 });
      const banner = await page.locator("#resume-banner").innerText();
      assert.match(banner, /Reprendre la partie/);
      assert.match(banner, /Haight-Ashbury/);
      assert.ok(banner.includes(statusText.split(" · ")[0]), `the game date is in the banner: ${banner}`);
      assert.match(banner, /habitants/);
      assert.match(banner, /sauvegardée le/);
      await shot(page, "s1-banner");

      await page.click("#resume-banner button[data-act=resume]");
      await pollUntil(async () => (await readFunds(page)) === funds, "the saved funds");
      const rec = await readIdb(page, "auto");
      const shadow = await shadowCity({ cty: Uint8Array.from(rec.bytes) });
      assert.equal(shadow.funds(), funds, "the engine's own load of the save has the same funds");
      const w = shadow.city.width(), h = shadow.city.height();
      assert.equal(await mapDigest(page), digestOf(shadow.city.tiles(), w, h), "the map is the engine's map of the save");
      assert.equal(await page.locator("#resume-banner").getAttribute("hidden"), "");

      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(s2) Ignorer keeps the sample; the old autosave is not overwritten until the city changes", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await buildRoad(page);
      assert.equal(await page.evaluate(() => window.__saves.flush()), "saved");
      await page.reload();
      await page.waitForSelector("#resume-banner:not([hidden])", { timeout: 30000 });
      await page.click("#resume-banner button[data-act=ignore]");
      assert.equal(await readFunds(page), HAIGHT_FUNDS, "the sample's funds");
      assert.equal(await page.evaluate(() => window.__saves.flush()), "same", "nothing changed: no write");
      assert.ok((await readIdb(page, "auto")).bytes.length > 0, "the autosave is still there");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(s3) manual slot: save with a name, rename, load another state, delete with confirmation", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await openPanel(page);
      await buildRoad(page);
      const saved = await readFunds(page);
      await page.fill("#saves-name-1", "Avant la zone");
      await page.click("#saves-slot-1 button[data-act=save]");
      await pollUntil(async () => (await page.locator("#saves-slot-1 .save-name").textContent()) === "Avant la zone", "the slot name");

      await buildRoad(page, 1);
      assert.ok((await readFunds(page)) < saved);
      await page.click("#saves-slot-1 button[data-act=load]");
      await pollUntil(async () => (await readFunds(page)) === saved, "the slot's funds");
      assert.match(await page.locator("#saves-msg").textContent(), /chargée/);

      await page.fill("#saves-name-1", "Après");
      await page.click("#saves-slot-1 button[data-act=rename]");
      await pollUntil(async () => (await page.locator("#saves-slot-1 .save-name").textContent()) === "Après", "the new name");

      await page.click("#saves-slot-1 button[data-act=delete]");
      assert.equal(await page.locator("#saves-slot-1 .save-confirm").isHidden(), false, "a confirmation is asked");
      await page.click("#saves-slot-1 .save-confirm button[data-act=cancel]");
      assert.equal((await page.locator("#saves-slot-1 .save-name").textContent()), "Après", "cancel keeps the save");
      await page.click("#saves-slot-1 button[data-act=delete]");
      await page.click("#saves-slot-1 .save-confirm button[data-act=confirm]");
      await pollUntil(async () => (await page.locator("#saves-slot-1 .save-name").textContent()) === "Emplacement 1", "the slot to empty");
      assert.equal(await readIdb(page, "slot-1"), null);
      await shot(page, "s3-slots");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(s4) a corrupted record: a French message, the other slots and the page still work", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      // slot-2 holds three bytes (a valid record, not a city); slot-3 holds text (not a record)
      await page.reload();
      await writeIdb(page, { id: "slot-2", name: "Cassée", savedAt: 1, meta: { year: 1900, month: 0, funds: 1, population: 0, width: 120, height: 100 }, thumbnail: null, bytes: [1, 2, 3] });
      await writeIdb(page, { id: "slot-3", name: "Illisible", savedAt: 1, meta: {}, thumbnail: null, bytes: "text" });
      await page.reload();
      await openPanel(page);
      await pollUntil(async () => (await page.locator("#saves-slot-3").textContent()).includes("illisible"), "the unreadable slot");
      await page.click("#saves-slot-2 button[data-act=load]");
      await pollUntil(async () => (await page.locator("#saves-msg").textContent()).startsWith("Erreur : fichier invalide"), "the French error");
      assert.match(await page.locator("#saves-msg").textContent(), /fichier tronqué/);
      assert.equal(await page.locator("#saves-msg").getAttribute("class"), "is-error");
      // the page works: a zone can still be built
      await buildRoad(page);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(s5) no IndexedDB (private browsing): the panel says so, file save and open stay, the page works", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, {});
    try {
      await page.addInitScript(() => {
        Object.defineProperty(window, "indexedDB", { get: () => undefined });
      });
      await page.reload();
      await openPanel(page);
      await pollUntil(async () => (await page.locator("#saves-note").textContent()).includes("indisponible"), "the unavailable note");
      assert.equal(await page.locator("#saves-slots").isVisible(), false);
      assert.equal(await page.locator("#save").isEnabled(), true, "Enregistrer (file) stays");
      await buildRoad(page);
      await shot(page, "s5-no-storage");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(s6) preferences: speed, disasters, view mode and tool come back after a reload", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await setSlider(page, "#speed", 3);
      await page.uncheck("#disasters");
      await selectTool(page, "road");
      await page.click("#view-modes button[data-view=densite]");
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll("#palette button.tool").length > 0);
      assert.equal(await page.inputValue("#speed"), "3");
      assert.equal(await page.isChecked("#disasters"), false);
      await pollUntil(async () => (await page.getAttribute("#palette button[data-tool=road]", "aria-pressed")) === "true", "the road tool");
      await pollUntil(async () => (await page.getAttribute("#view-modes button[data-view=densite]", "aria-pressed")) === "true", "the density view");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(s7) a phone (390 px): the panel and the banner fit the width, with no horizontal scroll", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { viewport: { width: 390, height: 844 } });
    try {
      await buildRoad(page);
      assert.equal(await page.evaluate(() => window.__saves.flush()), "saved");
      await page.reload();
      await page.waitForSelector("#resume-banner:not([hidden])", { timeout: 30000 });
      await openPanel(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `no horizontal scroll (overflow ${overflow}px)`);
      await shot(page, "s7-phone");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
