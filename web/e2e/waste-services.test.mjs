// End-to-end: the waste (docs/game-design-v08.md) and the public services (docs/game-design-v09.md) on
// the real wasm engine. A new city, the «Bâtiments étendus» switch, then each rule: a landfill placed with
// the palette shows its room in the «Déchets» panel and the waste view can be shown; a school placed with
// the palette is counted and the education coverage can be chosen for the map.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, newCity, selectTool, clickTile, engine, pollUntil, shot,
} from "./helpers.mjs";

const TIMEOUT = 180000;
const SEED = 4244;
const LANDFILL = 20, SCHOOL = 30;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

const text = (page, id) => page.locator(id).textContent();

// A site the engine accepts for `genre`, on a shadow city with the same seed, the waste and services
// rules on, and the buildings already placed by the test.
async function siteFor(genre, placed = []) {
  const { City } = await engine();
  const shadow = City.new_sized(120, 100, SEED);
  shadow.set_structure_rules(true);
  shadow.set_waste_rules(true);
  shadow.set_service_rules(true);
  for (const [g, at] of placed) shadow.place_structure(g, at.x, at.y);
  for (let x = 4; x < 110; x++) {
    for (let y = 4; y < 90; y++) {
      if (shadow.structure_preview(genre, x, y)[0] === 1) return { x, y };
    }
  }
  return null;
}

async function place(page, genre, site) {
  await selectTool(page, `structure_${genre}`);
  await clickTile(page, site.x, site.y);
  await page.keyboard.press("Escape");
}

describe("waste and public services", () => {
  test("a landfill gives landfill room and a school is counted", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await newCity(page, String(SEED));
      await pollUntil(async () => (await text(page, "#status")).includes(`Graine ${SEED}`), "the new city");
      await page.locator("#structures-rules").check();
      await pollUntil(async () => /^Activés : aucun bâtiment/u.test(await text(page, "#structures-state")), "buildings on");

      // waste: the switch, a landfill, its room in the panel, the waste view
      const dump = await siteFor(LANDFILL);
      assert.ok(dump, "bare land for a 3x3 landfill");
      assert.equal(await page.isVisible("#waste-panel"), true);
      await page.locator("#waste-rules").check();
      await place(page, LANDFILL, dump);
      await pollUntil(async () => /^Activés : 1 bâtiment/u.test(await text(page, "#structures-state")), "the landfill");
      await pollUntil(async () => /Capacité des décharges restante : 20\s?000/u.test(await text(page, "#waste-stats")), "the landfill room");
      await page.locator("#waste-view").check();
      assert.equal(await page.isChecked("#waste-view"), true);
      await shot(page, "waste-landfill");

      // services: the switch, a school next to nothing else, the education coverage on the map
      const at = await siteFor(SCHOOL, [[LANDFILL, dump]]);
      assert.ok(at, "bare land for the school");
      assert.equal(await page.isVisible("#services-panel"), true);
      await page.locator("#services-rules").check();
      await pollUntil(async () => /Niveau d'éducation \(EQ\)/u.test(await text(page, "#services-stats")), "the services on");
      await place(page, SCHOOL, at);
      await pollUntil(async () => /^Activés : 2 bâtiments/u.test(await text(page, "#structures-state")), "the school");
      await page.locator("#services-view").selectOption("education");
      assert.equal(await page.locator("#services-view").inputValue(), "education");
      await shot(page, "services-school");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
