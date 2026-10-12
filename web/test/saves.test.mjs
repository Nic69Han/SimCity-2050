// Saves logic: the autosave schedule (fake clock), the digest skip, the quota error path,
// names and metadata text, thumbnail size, engine detection for save and load, preferences.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  AUTOSAVE_MS, digestBytes, gameDate, defaultName, cleanName, formatSavedAt, formatMeta, resumeText,
  thumbnailSize, buildRecord, createAutosaver, sanitizePrefs, createPrefs, canSaveBytes, saveBytes,
  loadBytes, metaOf, NAME_MAX, SLOT_IDS,
} from "../saves.js";
import { StorageError } from "../storage.js";

// A fake clock: timers fire when advance() passes their due time.
function fakeClock() {
  let now = 0;
  const timers = new Map();
  let next = 1;
  return {
    now: () => now,
    schedule(fn, ms) {
      const id = next++;
      timers.set(id, { fn, due: now + ms, ms });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    count: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due);
        if (due.length === 0) break;
        const [id, t] = due[0];
        now = t.due;
        t.due += t.ms;
        timers.set(id, t);
        t.fn();
        await new Promise((r) => setImmediate(r));
      }
      now = end;
      await new Promise((r) => setImmediate(r));
    },
  };
}

// A city stub: its bytes change when `change()` is called.
function fakeCity() {
  let counter = 0;
  return {
    change() {
      counter++;
    },
    snapshot() {
      return { bytes: Uint8Array.from([counter & 255, (counter >> 8) & 255, 7]) };
    },
  };
}

function harness({ fail = null, interval = AUTOSAVE_MS } = {}) {
  const clock = fakeClock();
  const city = fakeCity();
  const writes = [];
  const statuses = [];
  let calls = 0;
  const auto = createAutosaver({
    snapshot: () => city.snapshot(),
    write: async (bytes, reason) => {
      const err = fail?.(calls++);
      if (err) throw err;
      writes.push({ bytes, reason, at: clock.now() });
    },
    schedule: (fn, ms) => clock.schedule(fn, ms),
    cancel: (id) => clock.cancel(id),
    interval,
    onStatus: (s) => statuses.push(s),
    now: () => clock.now(),
  });
  return { clock, city, writes, statuses, auto };
}

describe("autosave schedule (fake clock)", () => {
  test("nothing is written while not armed (the startup question is open)", async () => {
    const h = harness();
    h.auto.start();
    h.city.change();
    await h.clock.advance(3 * AUTOSAVE_MS);
    assert.equal(h.writes.length, 0);
  });

  test("armed: a write every minute while the city changes, none when it does not", async () => {
    const h = harness();
    h.auto.arm(true);
    h.auto.start();
    h.city.change();
    await h.clock.advance(AUTOSAVE_MS);
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].at, AUTOSAVE_MS, "the first write is at the first minute");
    await h.clock.advance(AUTOSAVE_MS);
    assert.equal(h.writes.length, 1, "nothing changed: no write");
    h.city.change();
    await h.clock.advance(AUTOSAVE_MS);
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes[1].reason, "timer");
  });

  test("the timer is the minute by default", () => {
    assert.equal(AUTOSAVE_MS, 60000);
  });

  test("stop cancels the timer", async () => {
    const h = harness();
    h.auto.arm(true);
    h.auto.start();
    h.auto.stop();
    assert.equal(h.clock.count(), 0);
    h.city.change();
    await h.clock.advance(2 * AUTOSAVE_MS);
    assert.equal(h.writes.length, 0);
  });

  test("a flush (page hidden, pagehide, a loaded city) writes at once, with its reason", async () => {
    const h = harness();
    h.auto.arm(true);
    h.city.change();
    assert.equal(await h.auto.flush("hidden"), "saved");
    assert.equal(h.writes[0].reason, "hidden");
  });
});

describe("digest skip", () => {
  test("equal bytes give equal digests; a change gives another", () => {
    assert.equal(digestBytes(Uint8Array.of(1, 2, 3)), digestBytes(Uint8Array.of(1, 2, 3)));
    assert.notEqual(digestBytes(Uint8Array.of(1, 2, 3)), digestBytes(Uint8Array.of(1, 2, 4)));
    assert.notEqual(digestBytes(Uint8Array.of(1, 2)), digestBytes(Uint8Array.of(1, 2, 0)), "the length counts");
  });

  test("a flush with the same bytes as the last write does not write", async () => {
    const h = harness();
    h.auto.arm(true);
    h.city.change();
    assert.equal(await h.auto.flush(), "saved");
    assert.equal(await h.auto.flush(), "same");
    assert.equal(h.writes.length, 1);
  });

  test("markSaved (a resumed save) makes the same city not write", async () => {
    const h = harness();
    h.auto.arm(true);
    h.auto.markSaved(h.city.snapshot().bytes);
    assert.equal(await h.auto.flush(), "same");
    h.city.change();
    assert.equal(await h.auto.flush(), "saved");
  });

  test("syncBaseline takes the city as saved, without writing", async () => {
    const h = harness();
    h.auto.arm(true);
    assert.equal(h.auto.syncBaseline(), true);
    assert.equal(await h.auto.flush(), "same");
    assert.equal(h.writes.length, 0);
  });

  test("no city (snapshot null) is skipped; an unarmed autosaver is idle", async () => {
    const h = harness();
    h.auto.arm(true);
    const empty = createAutosaver({ snapshot: () => null, write: async () => {} });
    empty.arm(true);
    assert.equal(await empty.flush(), "skipped");
    const off = createAutosaver({ snapshot: () => ({ bytes: Uint8Array.of(1) }), write: async () => {} });
    assert.equal(await off.flush(), "idle");
  });
});

describe("quota and blocked errors", () => {
  test("a quota error is reported, not thrown, and the next flush retries", async () => {
    const quota = new StorageError("quota", "full");
    const h = harness({ fail: (n) => (n === 0 ? quota : null) });
    h.auto.arm(true);
    h.city.change();
    assert.equal(await h.auto.flush("timer"), "error");
    assert.equal(h.statuses.at(-1).state, "error");
    assert.equal(h.statuses.at(-1).error.code, "quota");
    assert.equal(h.writes.length, 0);
    assert.equal(await h.auto.flush("timer"), "saved", "the same city is written when space is back");
  });

  test("flushes never overlap: a flush waits for the write before it", async () => {
    const order = [];
    const auto = createAutosaver({
      snapshot: () => ({ bytes: Uint8Array.of(order.length) }),
      write: async (bytes) => {
        order.push("start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("end");
      },
    });
    auto.arm(true);
    const a = auto.flush("a");
    const b = auto.flush("b");
    await Promise.all([a, b]);
    assert.deepEqual(order, ["start", "end", "start", "end"]);
  });
});

describe("names and metadata text", () => {
  const meta = { year: 1900, month: 0, funds: 20000, population: 1234, width: 120, height: 100 };

  test("the game date is the status line's", () => {
    assert.equal(gameDate(meta), "jan 1900");
    assert.equal(defaultName(meta), "Ville jan 1900");
  });

  test("a typed name is trimmed, collapsed and cut; an empty one gets the default", () => {
    assert.equal(cleanName("  Ma   ville  ", meta), "Ma ville");
    assert.equal(cleanName("   ", meta), "Ville jan 1900");
    assert.equal(cleanName("x".repeat(100), meta).length, NAME_MAX);
  });

  test("the meta line: date, funds, population, size", () => {
    const text = formatMeta(meta);
    assert.match(text, /^jan 1900 · 20\s000 \$ · 1\s234 habitants · 120 × 100$/u);
  });

  test("the saved date is in French, with a fixed zone for the test", () => {
    const text = formatSavedAt(Date.UTC(2026, 9, 12, 14, 3), "UTC");
    assert.match(text, /12 oct\. 2026/);
    assert.match(text, /14:03/);
  });

  test("the banner line names the city, game date, population and saved date", () => {
    const rec = buildRecord({ id: "auto", name: "Kyoto", bytes: Uint8Array.of(1), meta, savedAt: Date.UTC(2026, 9, 12, 14, 3) });
    const text = resumeText(rec, "UTC");
    assert.match(text, /^Kyoto · jan 1900 · 1\s234 habitants · sauvegardée le 12 oct\. 2026/u);
  });

  test("the thumbnail is 120 pixels wide, same proportions", () => {
    assert.deepEqual(thumbnailSize(1440, 1200), { width: 120, height: 100 });
    assert.deepEqual(thumbnailSize(0, 0), { width: 120, height: 120 });
  });

  test("the slots are one autosave and three manual", () => {
    assert.deepEqual([...SLOT_IDS], ["slot-1", "slot-2", "slot-3"]);
  });
});

describe("engine detection (save_city / load_city, else save_cty / load_cty)", () => {
  test("a city with save_city saves any size through it", () => {
    const city = { save_city: () => "new", save_cty: () => "old", is_saveable: () => false, width: () => 200, height: () => 150 };
    assert.equal(canSaveBytes(city), true);
    assert.equal(saveBytes(city), "new");
  });

  test("an old engine saves through save_cty at 120 x 100 only", () => {
    const old = { save_cty: () => "cty", is_saveable: () => true };
    assert.equal(canSaveBytes(old), true);
    assert.equal(saveBytes(old), "cty");
    assert.equal(canSaveBytes({ is_saveable: () => false }), false);
  });

  test("loading calls load_city when the engine has it, else load_cty", () => {
    const calls = [];
    loadBytes({ load_city: (b) => calls.push(["city", b]), load_cty: () => calls.push(["cty"]) }, "b");
    loadBytes({ load_cty: (b) => calls.push(["cty", b]) }, "c");
    assert.deepEqual(calls, [["city", "b"], ["cty", "c"]]);
  });

  test("metaOf reads the engine's numbers", () => {
    const city = { year: () => 1901, month: () => 2, funds: () => 5, population: () => 7, width: () => 120, height: () => 100 };
    assert.deepEqual(metaOf(city), { year: 1901, month: 2, funds: 5, population: 7, width: 120, height: 100 });
  });
});

describe("page preferences", () => {
  function memoryStore(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
      _data: data,
    };
  }

  test("a write is kept and read back", () => {
    const store = memoryStore();
    const prefs = createPrefs(store, "k");
    assert.equal(prefs.write({ speed: 3, disasters: false }), true);
    assert.deepEqual(createPrefs(store, "k").read(), { speed: 3, disasters: false });
    prefs.write({ tool: "road" });
    assert.deepEqual(prefs.read(), { speed: 3, disasters: false, tool: "road" });
  });

  test("a corrupt stored value reads as no preferences", () => {
    assert.deepEqual(createPrefs(memoryStore({ k: "{not json" }), "k").read(), {});
    assert.deepEqual(createPrefs(memoryStore({ k: "42" }), "k").read(), {});
  });

  test("a blocked or missing store: reads are empty and writes say no, without throwing", () => {
    const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
    assert.deepEqual(createPrefs(throwing, "k").read(), {});
    assert.equal(createPrefs(throwing, "k").write({ speed: 1 }), false);
    assert.deepEqual(createPrefs(null, "k").read(), {});
  });

  test("only known values are restored", () => {
    const raw = { speed: 7, disasters: "yes", view: "nope", tool: "road" };
    assert.deepEqual(sanitizePrefs(raw, { views: ["normal"], tools: ["road"] }), { tool: "road" });
    assert.deepEqual(sanitizePrefs({ speed: 1, disasters: false, view: "normal" }, { views: ["normal"] }),
      { speed: 1, disasters: false, view: "normal" });
    assert.deepEqual(sanitizePrefs(null), {});
  });
});

describe("the page's digest and the bytes stay the engine's", () => {
  test("the autosave writes the bytes it was given, untouched", async () => {
    const seen = [];
    const auto = createAutosaver({ snapshot: () => ({ bytes: Uint8Array.of(9, 8) }), write: async (b) => seen.push(b) });
    auto.arm(true);
    await auto.flush();
    assert.deepEqual(Array.from(seen[0]), [9, 8]);
  });
});
