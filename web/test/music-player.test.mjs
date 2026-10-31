// Tests of the music player (web/music.js) with a fake AudioContext: nothing is created before a gesture,
// the first gesture that turns the music on creates the context, the notes are scheduled ahead of the audio
// clock by a bounded timer, and turning off stops and closes everything. The page's toggle and volume
// slider are tested on a fake DOM (setup with a remembered choice, a missing Web Audio, a broken storage).
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createPlayer, setup, PUMP_MS } from "../music.js";
import { STORAGE_KEY, START_LEAD_SECONDS, LOOKAHEAD_SECONDS, CHORD_SECONDS, DEFAULT_VOLUME } from "../music-model.js";

// A fake AudioContext: the parts the player uses. Every oscillator's start is recorded.
function fakeContextClass(log) {
  return class FakeContext {
    constructor() {
      this.currentTime = 0;
      this.state = "running";
      this.destination = { name: "destination" };
      this.closed = false;
      log.contexts.push(this);
    }
    createGain() {
      const gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} };
      return { gain, connect() { return this; } };
    }
    createOscillator() {
      const osc = {
        frequency: { value: 0 }, connect() { return this; },
        start(t) { log.starts.push(t); }, stop(t) { log.stops.push(t); },
      };
      return osc;
    }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
  };
}

function newLog() {
  return { contexts: [], starts: [], stops: [] };
}

// A player with fake timers: schedule() keeps the callback, cancel() forgets it.
function playerWith(log, options = {}) {
  const timers = { fn: null, handle: 0, scheduled: [], cancelled: [] };
  const Ctor = fakeContextClass(log);
  const player = createPlayer({
    makeContext: () => new Ctor(),
    schedule: (fn, ms) => {
      timers.fn = fn;
      timers.scheduled.push(ms);
      timers.handle += 1;
      return timers.handle;
    },
    cancel: (h) => { timers.cancelled.push(h); timers.fn = null; },
    ...options,
  });
  return { player, timers };
}

describe("the player", () => {
  test("nothing is created until start()", () => {
    const log = newLog();
    const { player, timers } = playerWith(log);
    assert.equal(log.contexts.length, 0);
    assert.equal(timers.scheduled.length, 0);
    assert.equal(player.running, false);
  });

  test("start() creates one context, a timer at PUMP_MS, and schedules the first chord", () => {
    const log = newLog();
    const { player, timers } = playerWith(log);
    player.start();
    assert.equal(log.contexts.length, 1);
    assert.deepEqual(timers.scheduled, [PUMP_MS]);
    assert.equal(player.running, true);
    // the first chord starts at the origin (now + START_LEAD_SECONDS): three notes
    assert.deepEqual(log.starts, [START_LEAD_SECONDS, START_LEAD_SECONDS, START_LEAD_SECONDS]);
  });

  test("a second start() while playing does nothing", () => {
    const log = newLog();
    const { player, timers } = playerWith(log);
    player.start();
    player.start();
    assert.equal(log.contexts.length, 1);
    assert.equal(timers.scheduled.length, 1);
  });

  test("each timer tick schedules the chords inside the lookahead, and no more", () => {
    const log = newLog();
    const { player, timers } = playerWith(log);
    player.start();
    const before = log.starts.length;
    timers.fn(); // clock still at 0: the next chord (8.2 s) is beyond the lookahead
    assert.equal(log.starts.length, before);
    // the second chord (at START_LEAD + CHORD seconds) is now inside the lookahead
    log.contexts[0].currentTime = CHORD_SECONDS - LOOKAHEAD_SECONDS + START_LEAD_SECONDS + 0.1;
    timers.fn();
    assert.equal(log.starts.length, before + 3);
    const chord2 = START_LEAD_SECONDS + CHORD_SECONDS;
    assert.equal(log.starts[before], chord2);
  });

  test("stop() cancels the timer, closes the context and stops the timer's later ticks", () => {
    const log = newLog();
    const { player, timers } = playerWith(log);
    player.start();
    const tick = timers.fn;
    player.stop();
    assert.equal(player.running, false);
    assert.equal(log.contexts[0].closed, true);
    assert.deepEqual(timers.cancelled, [1]);
    const count = log.starts.length;
    tick?.(); // a late tick after stop schedules nothing
    assert.equal(log.starts.length, count);
  });

  test("stop() when not playing does nothing", () => {
    const log = newLog();
    const { player, timers } = playerWith(log);
    player.stop();
    assert.equal(timers.cancelled.length, 0);
    assert.equal(log.contexts.length, 0);
  });

  test("turning on again after a stop creates a new context", () => {
    const log = newLog();
    const { player } = playerWith(log);
    player.start();
    player.stop();
    player.start();
    assert.equal(log.contexts.length, 2);
    assert.equal(log.contexts[1].closed, false);
  });

  test("the volume is kept before start, and applied to the master gain while playing", () => {
    const log = newLog();
    const masters = [];
    const { player } = playerWith(log, {
      volume: 0.6,
      makeContext: () => {
        const ctx = new (fakeContextClass(log))();
        const gain = ctx.createGain();
        masters.push(gain);
        ctx.createGain = () => gain;
        return ctx;
      },
    });
    player.start();
    assert.equal(masters[0].gain.value, 0.6);
    player.setVolume(0.2);
    assert.equal(masters[0].gain.value, 0.2);
    player.setVolume(7);
    assert.equal(masters[0].gain.value, 1, "clamped");
  });
});

// ---- the page's toggle, on a fake DOM -------------------------------------------------------------------

function fakeElement(tag) {
  const listeners = new Map();
  return {
    tag, id: "", type: "", value: "", min: "", max: "", step: "", textContent: "", hidden: false,
    attrs: {}, style: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    fire(type, event = {}) { for (const fn of listeners.get(type) ?? []) fn(event); },
  };
}

// The globals of the page that music.js reads: document, window (AudioContext), localStorage.
function installPage({ webAudio = true, storage = null, storageThrows = false } = {}) {
  const docListeners = new Map();
  const log = newLog();
  const sound = fakeElement("div");
  const doc = {
    createElement: (tag) => fakeElement(tag),
    addEventListener(type, fn) { docListeners.set(type, [...(docListeners.get(type) ?? []), fn]); },
    fire(type) { for (const fn of docListeners.get(type) ?? []) fn({}); },
  };
  const values = new Map(storage === null ? [] : [[STORAGE_KEY, storage]]);
  const local = {
    getItem(k) { if (storageThrows) throw new Error("blocked"); return values.get(k) ?? null; },
    setItem(k, v) { if (storageThrows) throw new Error("blocked"); values.set(k, v); },
  };
  globalThis.document = doc;
  globalThis.localStorage = local;
  globalThis.window = webAudio ? { AudioContext: fakeContextClass(log) } : {};
  const api = { $: (id) => (id === "sound-controls" ? sound : null) };
  return { api, sound, log, values, doc };
}

afterEach(() => {
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.window;
});

describe("the page's music control", () => {
  test("a remembered «on» creates nothing at setup: the first press or key creates the context", () => {
    const page = installPage({ storage: JSON.stringify({ on: true, volume: 0.5 }) });
    setup(page.api);
    assert.equal(page.log.contexts.length, 0, "nothing before a gesture");
    page.doc.fire("pointerdown");
    assert.equal(page.log.contexts.length, 1);
    // the toggle now says on, and the context is stopped by the press of the toggle
    const [button] = page.sound.children;
    assert.equal(button.textContent, "Musique : activée");
    button.fire("click");
    assert.equal(page.log.contexts[0].closed, true);
    assert.equal(button.textContent, "Musique : coupée");
  });

  test("off by default: a press creates nothing, the click on the toggle turns it on", () => {
    const page = installPage();
    setup(page.api);
    const [button, slider] = page.sound.children;
    assert.equal(button.textContent, "Musique : coupée");
    assert.equal(button.attrs["aria-pressed"], "false");
    page.doc.fire("pointerdown");
    page.doc.fire("keydown");
    assert.equal(page.log.contexts.length, 0, "a press alone does not turn the music on");
    button.fire("click");
    assert.equal(page.log.contexts.length, 1);
    assert.equal(button.attrs["aria-pressed"], "true");
    button.fire("click");
    assert.equal(page.log.contexts[0].closed, true, "turned off: the context is closed");
  });

  test("the volume slider sets the volume, remembered per viewer", () => {
    const page = installPage();
    setup(page.api);
    const [, slider] = page.sound.children;
    assert.equal(slider.value, String(Math.round(DEFAULT_VOLUME * 100)));
    assert.equal(slider.attrs["aria-label"], "Volume de la musique");
    slider.value = "45";
    slider.fire("input");
    assert.deepEqual(JSON.parse(page.values.get(STORAGE_KEY)), { on: false, volume: 0.45 });
  });

  test("without Web Audio there is no music control and nothing is written", () => {
    const page = installPage({ webAudio: false });
    setup(page.api);
    assert.equal(page.sound.children.length, 0);
    assert.equal(page.values.size, 0);
  });

  test("a storage that throws leaves the music off, and the page still works", () => {
    const page = installPage({ storageThrows: true });
    setup(page.api);
    const [button] = page.sound.children;
    assert.equal(button.textContent, "Musique : coupée");
    button.fire("click");
    assert.equal(page.log.contexts.length, 1, "the toggle still turns the music on");
    button.fire("click");
  });
});
