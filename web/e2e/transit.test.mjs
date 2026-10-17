// End-to-end: the metro (docs/game-design-v02.md) on the REAL wasm engine. The «Métro» rule is
// turned on from the page, two stations and a tunnel between them are placed with the mouse, the
// stats line says one line, the funds drop by what the engine charges (checked against a shadow
// engine fed the same actions), the map shows the network, and a new city starts with the rule off.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  launchBrowser, openPage, assertNoErrors, readFunds, readToolMessage, selectTool, clickTile, dragTiles,
  readMap, WATER_LABEL, shadowCity, readSample, pollUntil, newCity, tileXY, TILE_PX,
} from "./helpers.mjs";

const TIMEOUT = 120000;
let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

const button = (page, key) => page.locator(`#palette button.tool[data-tool="${key}"]`);
const statsText = (page) => page.locator("#transit-stats").textContent();

// The RGBA of the centre of tile (x, y) on the 2D map canvas.
const pixelAt = (page, x, y) => page.evaluate(([px, tx, ty]) => {
  const d = document.getElementById("map").getContext("2d")
    .getImageData(tx * px + px / 2, ty * px + px / 2, 1, 1).data;
  return Array.from(d).join(",");
}, [TILE_PX, x, y]);

// First row run of `length` tiles that are not water, as [{x, y}] (or null).
function landRun(map, length) {
  for (let y = 0; y < map.h; y++) {
    let run = [];
    for (let x = 0; x < map.w; x++) {
      run = map.at(x, y).label === WATER_LABEL ? [] : [...run, { x, y }];
      if (run.length === length) return run;
    }
  }
  return null;
}

describe("the metro on the real wasm engine", () => {
  test("rule, tools, one working line, funds, layer, new city", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { query: "?lite=1" });
    try {
      // the rule is off: the checkbox is there with its help, the metro tools are blocked
      const box = page.locator("#transit");
      assert.equal(await page.locator("#transit-label").isVisible(), true);
      assert.match(await page.locator("#transit-label").getAttribute("title"), /trafic baisse/u);
      assert.equal(await box.isChecked(), false);
      assert.equal(await button(page, "metro_tunnel").isDisabled(), true);
      assert.match(await button(page, "metro_tunnel").getAttribute("title"), /Activez « Métro »/u);
      assert.equal(await page.locator("#transit-stats").isVisible(), false);

      await box.check();
      assert.equal(await box.isChecked(), true);
      assert.equal(await button(page, "metro_tunnel").isDisabled(), false);
      assert.equal(await button(page, "metro_station").isDisabled(), false);
      assert.match(await statsText(page), /^Métro : 0 station, 0 tunnel, 0 ligne en service/u);

      // a run of 7 tiles that are not water (the metro is underground, any land will do): station,
      // 5 tunnels, station
      const map = await readMap(page);
      const run = landRun(map, 7);
      assert.ok(run, "7 land tiles in a row on the sample city");
      const [a, ...rest] = run;
      const b = run[6];
      const shadow = await shadowCity({ cty: await readSample("haight") });
      shadow.city.set_transit_rules(true);
      const funds0 = await readFunds(page);
      assert.equal(funds0, shadow.funds());

      const before = await pixelAt(page, run[3].x, run[3].y);
      await selectTool(page, "metro_station");
      await clickTile(page, a.x, a.y);
      await clickTile(page, b.x, b.y);
      shadow.city.place_station(a.x, a.y);
      shadow.city.place_station(b.x, b.y);
      assert.equal(await readToolMessage(page), "");
      assert.match(await statsText(page), /2 stations, 0 tunnel, 0 ligne en service/u, "two stations, no line yet");

      await selectTool(page, "metro_tunnel");
      await dragTiles(page, rest.slice(0, 5)); // the 5 tiles between the stations
      for (const t of rest.slice(0, 5)) shadow.city.place_tunnel(t.x, t.y);
      await pollUntil(async () => /1 ligne en service/u.test(await statsText(page)), "one working line");
      assert.match(await statsText(page), /^Métro : 2 stations, 5 tunnels, 1 ligne en service, \d+ tuiles? desservies?$/u);

      // the funds dropped by what the engine charged
      assert.equal(await readFunds(page), shadow.funds());
      assert.ok(funds0 - shadow.funds() > 0);
      assert.equal(shadow.funds(), funds0 - 2 * 500 - 5 * 50, "2 stations and 5 tunnel tiles");
      const stats = Array.from(shadow.city.transit_stats());
      assert.deepEqual(stats.slice(0, 3), [2, 5, 1]);
      assert.match(await statsText(page), new RegExp(`${stats[3]} tuiles desservies`, "u"));

      // the network is drawn while a metro tool is chosen, and not once the tool is dropped
      const drawn = await pixelAt(page, run[3].x, run[3].y);
      assert.notEqual(drawn, before, "the tunnel is painted over the tile");
      await page.keyboard.press("Escape");
      await pollUntil(async () => (await pixelAt(page, run[3].x, run[3].y)) === before, "the network to be hidden");
      // «Plan du métro» shows it again without a tool
      await page.locator("#transit-plan").check();
      await pollUntil(async () => (await pixelAt(page, run[3].x, run[3].y)) === drawn, "the plan to be shown");
      await page.locator("#transit-plan").uncheck();

      // a new city starts with the rule off and the checkbox shows the engine's flag
      await newCity(page, "42");
      await pollUntil(async () => !(await box.isChecked()), "the checkbox to follow the new city");
      assert.equal(await button(page, "metro_tunnel").isDisabled(), true, "blocked again");
      assert.equal(await page.locator("#transit-stats").isVisible(), false);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("a metro tool dropped when the rule is turned off", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser, { query: "?lite=1" });
    try {
      await page.locator("#transit").check();
      await selectTool(page, "metro_station");
      assert.equal(await button(page, "metro_station").getAttribute("aria-pressed"), "true");
      await page.locator("#transit").uncheck();
      await pollUntil(async () => (await button(page, "metro_station").getAttribute("aria-pressed")) === "false", "the tool to be dropped");
      assert.equal(await button(page, "metro_station").isDisabled(), true);
      // refused by the reason, without charging
      const funds = await readFunds(page);
      await button(page, "metro_station").click({ force: true });
      assert.equal(await readFunds(page), funds);
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
