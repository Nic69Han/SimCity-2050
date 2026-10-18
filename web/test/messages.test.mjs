// Tests of the news ticker (web/messages.js) and of the French texts (web/messages-text.js).
// No browser: the panel is driven through a small fake document and a fake engine with a
// queue of take_messages() drains. The numbers of the engine are the ones of message.rs.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MESSAGE_TEXT, messageText } from "../messages-text.js";
import {
  KIND, MAX_ITEMS, FLASH_MS, RECORD_LEN, dateText, decodeRecords, messageItem, itemsOf,
  createTicker, flashBox, setup, update, flashAt,
} from "../messages.js";

const MESSAGE_RS = readFileSync(
  fileURLToPath(new URL("../../crates/micropolis-core/src/message.rs", import.meta.url)),
  "utf8",
);

/** `pub const MESSAGE_*: i16 = N;` of message.rs, as a Map name -> number. */
function engineConstants() {
  const found = new Map();
  for (const m of MESSAGE_RS.matchAll(/pub const (MESSAGE_[A-Z_]+): i16 = (-?\d+);/g)) {
    found.set(m[1], Number(m[2]));
  }
  return found;
}

// ---- fake document: just enough of the DOM for messages.js --------------------------------

function makeNode(tag, doc) {
  const listeners = {};
  return {
    tagName: tag,
    ownerDocument: doc,
    children: [],
    parent: null,
    isConnected: false,
    className: "",
    textContent: "",
    hidden: false,
    style: {},
    attributes: {},
    id: "",
    type: "",
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    click() {
      for (const fn of listeners.click ?? []) fn({ type: "click" });
    },
    append(...nodes) {
      for (const n of nodes) {
        n.parent?.children.splice(n.parent.children.indexOf(n), 1);
        n.parent = this;
        n.isConnected = true;
        this.children.push(n);
      }
    },
    replaceChildren(...nodes) {
      for (const c of this.children) {
        c.parent = null;
        c.isConnected = false;
      }
      this.children = [];
      this.append(...nodes);
    },
    scrollIntoView(options) {
      this.scrolledWith = options;
    },
  };
}

function fakeDocument() {
  const doc = {
    createElement: (tag) => makeNode(tag, doc),
    head: null,
    getElementById: (id) => doc.head.children.find((c) => c.id === id) ?? null,
  };
  doc.head = makeNode("head", doc);
  doc.head.isConnected = true;
  return doc;
}

/** A panel and a map frame in a fresh document. */
function page({ panelHidden = true } = {}) {
  const doc = fakeDocument();
  const panel = makeNode("section", doc);
  panel.hidden = panelHidden;
  const frame = makeNode("div", doc);
  frame.isConnected = true;
  return { doc, panel, frame };
}

/** A fake engine: a city of w x h tiles whose take_messages() gives the queued drains. */
function fakeCity({ w = 120, h = 100, month = 0, year = 1900, withMessages = true } = {}) {
  const drains = [];
  const city = {
    width: () => w,
    height: () => h,
    month: () => month,
    year: () => year,
    queue(flat) {
      drains.push(Int32Array.from(flat));
    },
  };
  if (withMessages) city.take_messages = () => drains.shift() ?? new Int32Array(0);
  return city;
}

function apiFor(city, { panel, frame }) {
  const elements = { "messages-panel": panel, "map-frame": frame };
  return { city: () => city, $: (id) => elements[id] ?? null, redraw() {}, isReady: () => true };
}

/** A message record [kind, a, b, c, d, e] of take_messages, as the adapter writes it. */
const message = (number, x = -1, y = -1, picture = 0, important = 0) =>
  [KIND.MESSAGE, number, x, y, picture, important];

/** The ticker rows of the panel: each row's text, flag and button. */
function rows(panel) {
  const list = panel.children.find((c) => c.className === "msg-list");
  return list.children.map((li) => ({
    li,
    date: li.children.find((c) => c.className === "msg-date")?.textContent,
    text: li.children.find((c) => c.className === "msg-text")?.textContent,
    important: li.className.includes("msg-important"),
    button: li.children.find((c) => c.className === "msg-locate") ?? null,
  }));
}

// ---- French texts ----------------------------------------------------------------------------

describe("messages-text.js", () => {
  test("every MESSAGE_* constant of message.rs has its own French sentence", () => {
    const constants = engineConstants();
    assert.ok(constants.size >= 57, `message.rs declares ${constants.size} constants`);
    const last = constants.get("MESSAGE_LAST");
    assert.equal(last, 57);
    const numbers = [...constants.entries()].filter(([name]) => name !== "MESSAGE_LAST").map(([, n]) => n);
    // the original messages are 1..=MESSAGE_LAST, each once; the extended rules' messages come after
    assert.deepEqual(
      numbers.filter((n) => n <= last).sort((a, b) => a - b),
      Array.from({ length: last }, (_, i) => i + 1),
      "the original constants are 1..=MESSAGE_LAST, each once",
    );
    const extended = numbers.filter((n) => n > last).sort((a, b) => a - b);
    assert.deepEqual(extended, Array.from({ length: extended.length }, (_, i) => last + 1 + i), "then the extended ones, each once");
    for (const n of numbers) {
      const text = MESSAGE_TEXT[n];
      assert.equal(typeof text, "string", `no French text for message ${n}`);
      assert.ok(text.trim().length > 10, `text of message ${n} is a sentence: ${text}`);
    }
    assert.deepEqual(Object.keys(MESSAGE_TEXT).map(Number).sort((a, b) => a - b), numbers.sort((a, b) => a - b));
  });

  test("the sentences are French (accents and capitals, no English leftovers)", () => {
    assert.equal(messageText(6), "Construisez une centrale électrique.");
    assert.equal(messageText(20), "Incendie signalé !");
    for (const [n, text] of Object.entries(MESSAGE_TEXT)) {
      assert.ok(/^[A-ZÀÂÉÈÊÎÔÙÛÇŒ]/.test(text), `message ${n} starts with a capital: ${text}`);
      assert.doesNotMatch(text, /\b(the|is|has|reported|Power|Plant)\b/, `message ${n}: ${text}`);
    }
  });

  test("unknown numbers degrade to a generic sentence that names the number", () => {
    for (const n of [0, 900, -1, 999, 1.5, undefined, null, "x"]) {
      const text = messageText(n);
      assert.equal(typeof text, "string");
      assert.ok(text.length > 0);
      assert.match(text, /Message du moteur/);
    }
    assert.equal(messageText(900), "Message du moteur n° 900.");
  });
});

// ---- records and items ------------------------------------------------------------------------

describe("decodeRecords and items", () => {
  test("records are fixed-size: a truncated last record is ignored, an empty drain gives none", () => {
    assert.equal(RECORD_LEN, 6);
    const flat = [...message(6), ...message(15, 10, 12, 1, 1), 2, 3, 4];
    const recs = decodeRecords(Int32Array.from(flat));
    assert.equal(recs.length, 2);
    assert.deepEqual(recs[1], { kind: 1, a: 15, b: 10, c: 12, d: 1, e: 1 });
    assert.deepEqual(decodeRecords(new Int32Array(0)), []);
    assert.deepEqual(decodeRecords(undefined), []);
  });

  test("a message with coordinates -1 has no place; with a place, the place is kept", () => {
    const none = messageItem({ kind: 1, a: 6, b: -1, c: -1, d: 0, e: 0 }, "jan 1900");
    assert.equal(none.x, null);
    assert.equal(none.y, null);
    assert.equal(none.important, false);
    assert.equal(none.picture, false);
    assert.equal(none.text, "Construisez une centrale électrique.");
    const place = messageItem({ kind: 1, a: 20, b: 33, c: 7, d: 1, e: 1 }, "déc 1901");
    assert.deepEqual([place.x, place.y], [33, 7]);
    assert.equal(place.picture, true);
    assert.equal(place.important, true);
    assert.equal(place.date, "déc 1901");
  });

  test("only message records make ticker items; sounds, win, lose and goto are not messages", () => {
    const recs = decodeRecords(Int32Array.from([
      ...message(6), 2, 0, 5, 5, 0, 0, 3, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 5, 9, 0, 0, 0, 0, 6, 0, 1, 2, 0, 0,
    ]));
    assert.deepEqual(itemsOf(recs, "jan 1900").map((i) => i.number), [6]);
  });

  test("dates read as the status line writes them", () => {
    assert.equal(dateText(0, 1900), "jan 1900");
    assert.equal(dateText(11, 2000), "déc 2000");
    assert.equal(dateText(12, 2000), "? 2000");
  });
});

// ---- ticker ------------------------------------------------------------------------------------

describe("the ticker", () => {
  const item = (n) => messageItem({ kind: 1, a: 6, b: -1, c: -1, d: 0, e: 0 }, `j${n}`);

  test("the newest item comes first and add returns the new items in the order they came", () => {
    const t = createTicker();
    const fresh = [item(1), item(2), item(3)];
    assert.equal(t.add(fresh), fresh);
    assert.deepEqual(t.items().map((i) => i.date), ["j3", "j2", "j1"]);
    t.add([item(4)]);
    assert.deepEqual(t.items().map((i) => i.date), ["j4", "j3", "j2", "j1"]);
    assert.deepEqual(t.add([]), []);
    assert.equal(t.items().length, 4);
  });

  test("the ticker keeps the last MAX_ITEMS messages (30 by default)", () => {
    assert.equal(MAX_ITEMS, 30);
    const t = createTicker();
    for (let n = 1; n <= 35; n++) t.add([item(n)]);
    const kept = t.items();
    assert.equal(kept.length, 30);
    assert.equal(kept[0].date, "j35");
    assert.equal(kept[29].date, "j6");
  });

  test("the cap is a parameter", () => {
    const t = createTicker(2);
    t.add([item(1), item(2), item(3)]);
    assert.deepEqual(t.items().map((i) => i.date), ["j3", "j2"]);
  });

  test("items() is a copy: changing it does not change the ticker", () => {
    const t = createTicker();
    t.add([item(1)]);
    t.items().pop();
    assert.equal(t.items().length, 1);
  });
});

describe("location highlight", () => {
  test("a 3-tile square centred on the tile, in percent of the map frame", () => {
    const box = flashBox(60, 50, 120, 100);
    assert.equal(box.left, `${(59 / 120) * 100}%`);
    assert.equal(box.top, `${(49 / 100) * 100}%`);
    assert.equal(box.width, `${(3 / 120) * 100}%`);
    assert.equal(box.height, `${(3 / 100) * 100}%`);
  });

  test("clipped at the map edges", () => {
    const corner = flashBox(0, 0, 120, 100);
    assert.equal(corner.left, "0%");
    assert.equal(corner.width, `${(2 / 120) * 100}%`);
    const far = flashBox(119, 99, 120, 100);
    assert.equal(far.width, `${(2 / 120) * 100}%`);
    assert.equal(far.height, `${(2 / 100) * 100}%`);
  });
});

// ---- panel with a fake engine -----------------------------------------------------------------

describe("panel", () => {
  test("without take_messages the panel stays hidden and nothing is built", () => {
    const p = page();
    const city = fakeCity({ withMessages: false });
    setup(apiFor(city, p));
    assert.equal(p.panel.hidden, true);
    assert.equal(p.panel.children.length, 0);
    update(apiFor(city, p)); // no error without a feature
    assert.equal(p.panel.children.length, 0);
  });

  test("with take_messages the panel shows its heading and the empty note", () => {
    const p = page();
    const city = fakeCity();
    setup(apiFor(city, p));
    assert.equal(p.panel.hidden, false);
    const heading = p.panel.children.find((c) => c.tagName === "h2");
    assert.equal(heading.textContent, "Journal de la ville");
    const empty = p.panel.children.find((c) => c.className === "msg-empty");
    assert.equal(empty.hidden, false);
    const list = p.panel.children.find((c) => c.className === "msg-list");
    assert.equal(list.hidden, true);
    assert.ok(p.doc.getElementById("messages-style"), "the stylesheet of the feature is added once");
  });

  test("a drain shows the French texts, newest first, with the date and the flags", () => {
    const p = page();
    const city = fakeCity({ month: 3, year: 1904 });
    setup(apiFor(city, p));
    city.queue([...message(6), ...message(15, 10, 12, 1, 1)]);
    update(apiFor(city, p));
    const got = rows(p.panel);
    assert.deepEqual(got.map((r) => r.text), [messageText(15), messageText(6)]);
    assert.equal(got[0].date, "avr 1904");
    assert.equal(got[0].important, true);
    assert.equal(got[1].important, false);
    assert.ok(got[0].li.children.some((c) => c.className === "msg-flag" && c.textContent === "Important"));
    assert.equal(got[1].button, null, "no place, no locate button");
    assert.ok(got[0].button, "a place gets the locate button");
    assert.match(got[0].button.attributes["aria-label"], /\(10, 12\)/);
  });

  test("the announcement line carries the new messages only, polite", () => {
    const p = page();
    const city = fakeCity();
    setup(apiFor(city, p));
    city.queue([...message(6)]);
    update(apiFor(city, p));
    const announce = p.panel.children.find((c) => c.className === "msg-announce");
    assert.equal(announce.attributes["aria-live"], "polite");
    assert.equal(announce.textContent, `jan 1900 : ${messageText(6)}`);
    update(apiFor(city, p)); // an empty drain changes nothing
    assert.equal(announce.textContent, `jan 1900 : ${messageText(6)}`);
  });

  test("an empty drain does not rebuild the list", () => {
    const p = page();
    const city = fakeCity();
    setup(apiFor(city, p));
    city.queue([...message(6)]);
    update(apiFor(city, p));
    const list = p.panel.children.find((c) => c.className === "msg-list");
    const before = list.children[0];
    update(apiFor(city, p));
    assert.equal(list.children[0], before);
  });

  test("the list keeps 30 rows over many drains", () => {
    const p = page();
    const city = fakeCity();
    setup(apiFor(city, p));
    for (let n = 1; n <= 40; n++) {
      city.queue([...message((n % 57) + 1)]);
      update(apiFor(city, p));
    }
    assert.equal(rows(p.panel).length, 30);
  });

  test("the locate button flashes the tile on the map frame, then hides it", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const p = page({ panelHidden: false });
      const city = fakeCity();
      setup(apiFor(city, p));
      city.queue([...message(15, 60, 50, 0, 1)]);
      update(apiFor(city, p));
      rows(p.panel)[0].button.click();
      const flash = p.frame.children.find((c) => c.className === "msg-flash");
      assert.ok(flash, "the highlight is inside the map frame");
      assert.equal(flash.hidden, false);
      assert.equal(flash.style.left, flashBox(60, 50, 120, 100).left);
      assert.equal(flash.style.width, flashBox(60, 50, 120, 100).width);
      assert.deepEqual(p.frame.scrolledWith, { block: "nearest" });
      mock.timers.tick(FLASH_MS - 1);
      assert.equal(flash.hidden, false);
      mock.timers.tick(1);
      assert.equal(flash.hidden, true);
    } finally {
      mock.timers.reset();
    }
  });

  test("flashAt ignores a place that is not on the map", () => {
    const p = page({ panelHidden: false });
    const city = fakeCity();
    setup(apiFor(city, p));
    flashAt(apiFor(city, p), -1, -1);
    assert.equal(p.frame.children.find((c) => c.className === "msg-flash").hidden, true);
  });
});
