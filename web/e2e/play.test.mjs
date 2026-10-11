// End-to-end: what the play controls send to the engine. The page keeps no game state, so the
// engine's state is read through the shadow engine (same bytes as the page): after the page has
// run N frames at a speed, the shadow runs the same ticks and must show the same status and stats
// lines, to the digit. A slider or checkbox that does not reach the engine changes those lines.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { ticksPerFrame } from "../playback.js";
import {
  launchBrowser, openPage, assertNoErrors, newCity, shadowCity, readSample, countFrames,
  playFrames, expectedText, setSlider, pollUntil, shot,
} from "./helpers.mjs";

const TIMEOUT = 120000;
const SEED = 4242;

let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

describe("speed and catastrophes reach the engine", () => {
  test("(m) the speed slider sets the ticks per frame: 1 frame at speed 1 is one tick, at speed 3 sixteen", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await countFrames(page);
      const shadow = await shadowCity({ cty: await readSample("haight") });
      const city = shadow.city;
      city.enable_disasters(false); // the page loads with the Catastrophes box unchecked
      // the page starts at the slider's value (2), then the test moves it: 1, then 3
      let rateAtOne = null;
      for (const speed of [1, 3]) {
        await setSlider(page, "#speed", speed);
        city.set_speed(speed);
        const seg = await playFrames(page, 120);
        assert.ok(seg.ran >= 60, `the page played ${seg.ran} frames at speed ${speed}`);
        for (let k = 0; k < seg.ran * ticksPerFrame(speed); k++) city.tick();
        const want = expectedText(city);
        assert.equal(seg.status, want.status, `status after ${seg.ran} frames at speed ${speed}`);
        assert.equal(seg.stats, want.stats, `stats after ${seg.ran} frames at speed ${speed}`);
        if (speed === 1) rateAtOne = seg.ran;
      }
      assert.ok(rateAtOne >= 60);
      await shot(page, "m-speed-3-after-play");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });

  test("(m2) the Catastrophes checkbox reaches the engine, on and off, within one city", { timeout: TIMEOUT }, async () => {
    const { page, errors, close } = await openPage(browser);
    try {
      await countFrames(page);
      // a sample with a population: catastrophes change its numbers within a few thousand ticks
      // (a new city is empty at first, so it cannot show them: see the note in the report)
      const cty = await readSample("haight");
      const shadow = await shadowCity({ cty });
      const city = shadow.city;
      city.enable_disasters(false); // the page loads with the box unchecked
      assert.equal(await page.isChecked("#disasters"), false, "catastrophes are off at start");
      await setSlider(page, "#speed", 3);
      city.set_speed(3);

      // checked: the engine runs with catastrophes
      await page.check("#disasters");
      city.enable_disasters(true);
      const on = await playFrames(page, 400);
      const alt = await shadowCity({ cty }); // the same stretch without catastrophes, for contrast
      alt.city.enable_disasters(false);
      alt.city.set_speed(3);
      for (let k = 0; k < on.ran * ticksPerFrame(3); k++) alt.city.tick();
      for (let k = 0; k < on.ran * ticksPerFrame(3); k++) city.tick();
      const wantOn = expectedText(city);
      assert.equal(on.status, wantOn.status, "status with catastrophes on");
      assert.equal(on.stats, wantOn.stats, "stats with catastrophes on");
      assert.notEqual(expectedText(alt.city).stats, wantOn.stats, "catastrophes change the city in this stretch");

      // unchecked: the engine runs without them from here on
      await page.uncheck("#disasters");
      city.enable_disasters(false);
      const off = await playFrames(page, 400);
      for (let k = 0; k < off.ran * ticksPerFrame(3); k++) city.tick();
      const wantOff = expectedText(city);
      assert.equal(off.status, wantOff.status, "status with catastrophes off");
      assert.equal(off.stats, wantOff.stats, "stats with catastrophes off");

      // Nouvelle ville keeps the box as the user set it (the engine's own flag is not readable)
      await page.check("#disasters");
      await newCity(page, "4242");
      assert.equal(await page.isChecked("#disasters"), true, "the box is still checked after Nouvelle ville");
      await shot(page, "m2-catastrophes");
      assertNoErrors(errors);
    } finally {
      await close();
    }
  });
});
