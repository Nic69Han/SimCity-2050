// Sounds: the pure part (web/sound-model.js) and the hook that carries the engine's sound events
// (web/messages.js soundEventsOf). No browser: the Web Audio part is checked by web/e2e/sound.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SOUNDS, ENGINE_SOUNDS, MAX_PLAYS_PER_SECOND, WINDOW_MS, soundOf, soundForEngine, soundForToolMessage,
  soundFiles, createLimiter, preferenceOf, preferenceValue, muteLabel,
} from "../sound-model.js";
import { RESULT, resultMessage } from "../tools.js";
import { soundEventsOf, KIND } from "../messages.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url)); // web/
const RUST_SOUNDS = fileURLToPath(new URL("../../crates/micropolis-wasm/src/messages.rs", import.meta.url));
const MAX_TOTAL_BYTES = 1024 * 1024; // docs/game-design.md: at most 1 MB of sounds

// The engine's sound names, as messages.rs lists them: ("city", "Siren") -> "city/Siren".
function engineNames() {
  const source = readFileSync(RUST_SOUNDS, "utf8");
  return [...source.matchAll(/\("(\w+)", "(\w+)"\)/g)].map((m) => `${m[1]}/${m[2]}`);
}

describe("engine sounds map to a file", () => {
  test("every sound name of messages.rs is mapped, and nothing else is", () => {
    const names = engineNames();
    assert.equal(names.length, 11);
    assert.deepEqual(Object.keys(ENGINE_SOUNDS).sort(), [...names].sort());
  });

  test("a mapped name gives its file, volume and rate", () => {
    const siren = soundForEngine("city/Siren");
    assert.deepEqual(siren, { key: "siren", file: SOUNDS.siren.file, volume: SOUNDS.siren.volume, rate: 1 });
    assert.equal(soundForEngine("city/HonkHonkLow").rate, 0.8);
    assert.equal(soundForEngine("city/HonkHonkHigh").rate, 1.25);
  });

  test("an unknown or empty name is silence (null)", () => {
    assert.equal(soundForEngine(""), null);
    assert.equal(soundForEngine("city/Bulldozer"), null);
    assert.equal(soundForEngine("constructor"), null);
    assert.equal(soundOf("toString"), null);
  });
});

describe("tool messages map to a sound", () => {
  test("a refusal and a missing budget have their sound", () => {
    assert.equal(soundForToolMessage(resultMessage(RESULT.NO_MONEY)).key, "noMoney");
    assert.equal(soundForToolMessage(resultMessage(RESULT.NEED_BULLDOZE)).key, "refused");
    assert.equal(soundForToolMessage(resultMessage(RESULT.FAILED)).key, "refused");
  });

  test("success (empty line), other lines and an empty text make no sound", () => {
    assert.equal(soundForToolMessage(resultMessage(RESULT.OK)), null);
    assert.equal(soundForToolMessage(""), null);
    assert.equal(soundForToolMessage("Action impossible"), null);
    assert.equal(soundForToolMessage("Pas de relief ici"), null);
  });
});

describe("the sound files", () => {
  test("every file of the table is in web/sounds, and is an Ogg file", () => {
    for (const file of soundFiles()) {
      const path = `${ROOT}sounds/${file}`;
      assert.ok(existsSync(path), `${file} is missing`);
      assert.match(file, /\.ogg$/);
    }
  });

  test("the files used come to at most 1 MB, and the folder holds only those", () => {
    const files = soundFiles();
    const total = files.reduce((sum, f) => sum + statSync(`${ROOT}sounds/${f}`).size, 0);
    assert.ok(total <= MAX_TOTAL_BYTES, `total ${total} bytes`);
    const onDisk = readdirSync(`${ROOT}sounds`).filter((f) => f.endsWith(".ogg")).sort();
    assert.deepEqual(onDisk, [...files].sort(), "the folder holds exactly the files used");
  });

  test("the licence text names CC0", () => {
    assert.match(readFileSync(`${ROOT}sounds/LICENSE-kenney.txt`, "utf8"), /creativecommons\.org\/publicdomain\/zero\/1\.0/);
  });
});

describe("rate limit", () => {
  test("at most MAX_PLAYS_PER_SECOND starts in one window, then the window slides", () => {
    const limit = createLimiter();
    const allowed = [];
    for (let i = 0; i < 10; i++) allowed.push(limit.allow(i));
    assert.equal(allowed.filter(Boolean).length, MAX_PLAYS_PER_SECOND);
    // the start at t = 0 leaves the window at WINDOW_MS: one new start is then allowed, no more
    assert.equal(limit.allow(WINDOW_MS - 1), false);
    assert.equal(limit.allow(WINDOW_MS), true);
    assert.equal(limit.allow(WINDOW_MS), false);
  });

  test("the same times give the same answers (deterministic)", () => {
    const times = [0, 10, 20, 30, 40, 50, 60, 500, 999, 1000, 1001, 1500, 2600, 2600];
    const run = () => {
      const limit = createLimiter({ max: 3, windowMs: 1000 });
      return times.map((t) => limit.allow(t));
    };
    assert.deepEqual(run(), run());
    assert.deepEqual(run(), [
      true, true, true, false, false, false, false, false, false, true, false, true, true, true,
    ]);
  });

  test("a fast drag of 100 sounds at one time starts only the first few", () => {
    const limit = createLimiter();
    let started = 0;
    for (let i = 0; i < 100; i++) if (limit.allow(5000)) started++;
    assert.equal(started, MAX_PLAYS_PER_SECOND);
  });
});

describe("mute state", () => {
  test("muted unless the remembered choice is \"on\" (the default is muted)", () => {
    assert.equal(preferenceOf(null), false);
    assert.equal(preferenceOf("off"), false);
    assert.equal(preferenceOf("garbage"), false);
    assert.equal(preferenceOf("on"), true);
  });

  test("the choice is stored as \"on\" or \"off\" and read back", () => {
    assert.equal(preferenceOf(preferenceValue(true)), true);
    assert.equal(preferenceOf(preferenceValue(false)), false);
  });

  test("the label says the state: coupé when muted, activé when on", () => {
    assert.equal(muteLabel(false), "Son : coupé");
    assert.equal(muteLabel(true), "Son : activé");
  });
});

describe("engine sound events (messages.js soundEventsOf)", () => {
  test("only sound records are kept, with their name, x and y, in the order sent", () => {
    const names = ["city/Siren", "", "city/Monster"];
    const records = [
      { kind: KIND.MESSAGE, a: 1, b: 2, c: 3, d: 0, e: 0 },
      { kind: KIND.SOUND, a: 0, b: -1, c: -1, d: 0, e: 0 },
      { kind: KIND.WIN, a: 0, b: 0, c: 0, d: 0, e: 0 },
      { kind: KIND.SOUND, a: 1, b: 40, c: 20, d: 0, e: 0 },
      { kind: KIND.SOUND, a: 99, b: 0, c: 0, d: 0, e: 0 },
    ];
    const events = soundEventsOf(records, (i) => names[i] ?? "");
    assert.deepEqual(events, [
      { name: "city/Siren", x: -1, y: -1 },
      { name: "", x: 40, y: 20 },
      { name: "", x: 0, y: 0 },
    ]);
  });
});
