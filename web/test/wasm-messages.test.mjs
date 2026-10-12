// Contract test of the REAL compiled wasm adapter for the messages: City.take_messages() through
// the page's decoder (web/messages.js), on an engine that really sends a message. Run it with
// scripts/test-wasm.sh, which builds the package into a temporary directory and sets WASM_PKG_DIR
// to it. Without WASM_PKG_DIR the suite is skipped.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { messageText } from "../messages-text.js";
import { decodeRecords, itemsOf, KIND, RECORD_LEN } from "../messages.js";

const PKG_DIR = process.env.WASM_PKG_DIR;
const SKIP = PKG_DIR ? false : "WASM_PKG_DIR not set: run scripts/test-wasm.sh";

const TOOL_RESIDENTIAL = 0;
const HAIGHT = fileURLToPath(new URL("../../assets/cities/haight.cty", import.meta.url));

describe("wasm messages", { skip: SKIP }, () => {
  let City;
  before(() => {
    if (SKIP) return;
    ({ City } = createRequire(import.meta.url)(join(PKG_DIR, "micropolis_wasm.js")));
  });

  test("zones without power send NEED_ELECTRICITY, read through the page's decoder", () => {
    const city = new City(1); // an empty city, as the page starts a new one
    city.enable_disasters(false);
    city.set_speed(3);
    // Zones are placed by clicks (a big tool is placed at the click only).
    for (let x = 20; x < 60; x += 3) {
      for (let y = 40; y < 60; y += 3) city.tool_down(TOOL_RESIDENTIAL, x, y);
    }
    city.take_messages();
    const flat = [];
    for (let t = 0; t < 1500; t++) {
      city.tick();
      flat.push(...city.take_messages());
    }
    assert.equal(flat.length % RECORD_LEN, 0, "the drain is a whole number of records");
    const items = itemsOf(decodeRecords(flat), "jan 1900");
    const electricity = items.find((i) => i.number === 6);
    assert.ok(electricity, `NEED_ELECTRICITY was sent: ${items.map((i) => i.number)}`);
    assert.equal(electricity.text, messageText(6));
    assert.equal(electricity.text, "Construisez une centrale électrique.");
    assert.equal(electricity.x, null, "the engine gives no place for this message");
  });

  test("a drain empties the queue; a disastrous run sends records of known kinds only", () => {
    const city = new City(1);
    city.load_cty(readFileSync(HAIGHT));
    city.enable_disasters(true);
    city.set_speed(3);
    city.take_messages();
    const flat = [];
    for (let t = 0; t < 3000; t++) {
      city.tick();
      flat.push(...city.take_messages());
    }
    assert.deepEqual(Array.from(city.take_messages()), [], "a second drain is empty");
    const recs = decodeRecords(flat);
    assert.ok(recs.some((r) => r.kind === KIND.MESSAGE), "a 3000-tick run with disasters sends messages");
    for (const r of recs) {
      assert.ok([KIND.MESSAGE, KIND.SOUND, KIND.WIN, KIND.LOSE, KIND.QUAKE, KIND.GOTO].includes(r.kind), `kind ${r.kind}`);
    }
  });

  test("sound names are looked up by index", () => {
    assert.equal(typeof City.sound_name, "function");
    assert.match(City.sound_name(0), /^[a-z]+\/[A-Za-z-]+$/);
    assert.equal(City.sound_name(-1), "");
  });
});
