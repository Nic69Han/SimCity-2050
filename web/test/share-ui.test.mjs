// Tests of the share panel (web/share-ui.js) with a fake page: the button builds the link from the save's bytes and copies
// it (clipboard, else the read-only field), every refusal is a French message in the status line, and a «#ville=» address
// opens that city at startup (bad links and engine refusals leave the city unchanged).
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as ui from "../share-ui.js";
import { encode, decode, parseHash, ERROR_TEXTS, MAX_SHARE_BYTES, HASH_PREFIX } from "../share-model.js";

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.value = "";
    this._text = "";
    this.onclick = null;
    this.selected = false;
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  replaceChildren(...nodes) {
    this._text = "";
    this.children = nodes;
  }
  focus() {}
  select() {
    this.selected = true;
  }
  find(pred, out = []) {
    if (pred(this)) out.push(this);
    for (const c of this.children) c.find(pred, out);
    return out;
  }
}

const BYTES = Uint8Array.from({ length: 4000 }, (_, i) => (i * 7) % 13);
const saved = {};
let location;
let replaced;

// A page whose city has save_city; replaceCity records the bytes and answers `replaceResult`.
function setupPage({ ready = true, city = { save_city: () => BYTES }, replaceResult = null } = {}) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  const panel = new Node("section");
  const api = {
    city: () => city,
    $: (id) => (id === "share-panel" ? panel : null),
    isReady: () => ready,
    replaceCity(bytes) {
      replaced.push(bytes);
      return replaceResult;
    },
  };
  ui.setup(api);
  ui.update(api);
  return { api, panel };
}

const button = (panel) => panel.find((n) => n.tagName === "button")[0];
const field = (panel) => panel.find((n) => n.tagName === "input")[0];
const status = (panel) => panel.find((n) => n.attributes.role === "status")[0].textContent;
// The streams finish in later macrotasks: wait a fixed short while (negative checks) or until a condition (positive ones).
const tick = () => new Promise((r) => setTimeout(r, 40));
async function waitFor(check) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}
const click = (panel) => button(panel).onclick(); // the handler returns its promise

beforeEach(() => {
  replaced = [];
  location = { origin: "https://ex.org", pathname: "/", search: "", hash: "" };
  for (const k of ["location", "history", "navigator"]) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  Object.defineProperty(globalThis, "location", { value: location, configurable: true, writable: true });
  Object.defineProperty(globalThis, "history", {
    value: { replaceState: (_s, _t, url) => { location.hash = ""; location.replaced = url; } }, configurable: true, writable: true,
  });
});

afterEach(() => {
  for (const k of ["location", "history", "navigator"]) {
    if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
    else delete globalThis[k];
  }
});

function setClipboard(writeText) {
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: writeText ? { writeText } : undefined }, configurable: true, writable: true });
}

describe("the panel", () => {
  test("hidden until the page is ready; then a title, the «Partager la ville» button, a hidden field, a status line", () => {
    const early = setupPage({ ready: false });
    assert.equal(early.panel.hidden, true);
    const { panel } = setupPage();
    assert.equal(panel.hidden, false);
    assert.equal(panel.find((n) => n.tagName === "h2")[0].textContent, "Partager");
    assert.equal(button(panel).textContent, "Partager la ville");
    assert.equal(field(panel).hidden, true);
    assert.equal(field(panel).attributes.readonly, "");
    assert.equal(field(panel).attributes["aria-label"], "Lien de la ville");
  });
});

describe("sharing", () => {
  test("builds the link from the save's bytes and copies it", async () => {
    let copied = null;
    setClipboard(async (text) => { copied = text; });
    const { panel } = setupPage();
    await click(panel);
    assert.match(copied, /^https:\/\/ex\.org\/#ville=[A-Za-z0-9_-]+$/u);
    assert.deepEqual(await decode(parseHash(copied.slice(copied.indexOf("#")))), BYTES);
    assert.equal(status(panel), ui.COPIED_TEXT);
    assert.equal(field(panel).hidden, true);
  });

  test("without a clipboard, the link is shown selected in the read-only field", async () => {
    setClipboard(null);
    const { panel } = setupPage();
    await click(panel);
    assert.match(field(panel).value, /^https:\/\/ex\.org\/#ville=/u);
    assert.equal(field(panel).hidden, false);
    assert.equal(field(panel).selected, true);
    assert.equal(status(panel), ui.MANUAL_TEXT);
  });

  test("a clipboard that refuses falls back to the field", async () => {
    setClipboard(async () => { throw new Error("denied"); });
    const { panel } = setupPage();
    await click(panel);
    assert.equal(field(panel).hidden, false);
  });

  test("a city too big for a link is refused with the French message", async () => {
    setClipboard(null);
    let seed = 7;
    const noise = Uint8Array.from({ length: MAX_SHARE_BYTES * 2 }, () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24);
    const { panel } = setupPage({ city: { save_city: () => noise } });
    await click(panel);
    assert.equal(status(panel), ERROR_TEXTS["too-big"]);
    assert.equal(field(panel).hidden, true);
  });

  test("a browser without CompressionStream is refused cleanly", async () => {
    setClipboard(null);
    const original = Object.getOwnPropertyDescriptor(globalThis, "CompressionStream");
    Object.defineProperty(globalThis, "CompressionStream", { value: undefined, configurable: true, writable: true });
    try {
      const { panel } = setupPage();
      await click(panel);
      assert.equal(status(panel), ERROR_TEXTS.unsupported);
    } finally {
      Object.defineProperty(globalThis, "CompressionStream", original);
    }
  });

  test("a city that cannot be saved is refused", async () => {
    const { panel } = setupPage({ city: { is_saveable: () => false, save_cty: () => BYTES } });
    await click(panel);
    assert.equal(status(panel), ui.NOT_SAVEABLE_TEXT);
  });

  test("the share link keeps the page's search part", async () => {
    location.search = "?mock=1";
    const link = await ui.makeLink({ save_city: () => BYTES });
    assert.match(link, /^https:\/\/ex\.org\/\?mock=1#ville=/u);
  });
});

describe("opening a link at startup", () => {
  test("a good hash loads the city once the page's own city is in, then clears the hash", async () => {
    location.hash = HASH_PREFIX + (await encode(BYTES));
    const { api } = setupPage();
    assert.deepEqual(replaced, [], "not in the same turn as the page's own load");
    await waitFor(() => replaced.length > 0);
    assert.equal(replaced.length, 1);
    assert.deepEqual(replaced[0], BYTES);
    assert.equal(location.hash, "");
    ui.update(api);
    await tick();
    assert.equal(replaced.length, 1, "only once");
  });

  test("the status line says the city is open", async () => {
    location.hash = HASH_PREFIX + (await encode(BYTES));
    const { panel } = setupPage();
    await waitFor(() => replaced.length > 0);
    await tick();
    assert.equal(status(panel), ui.OPENED_TEXT);
  });

  test("no hash, or another hash: nothing is loaded", async () => {
    for (const hash of ["", "#autre=1"]) {
      location.hash = hash;
      setupPage();
      await tick();
    }
    assert.deepEqual(replaced, []);
  });

  test("a bad hash gives a French message and the city stays", async () => {
    for (const [hash, code] of [["#ville=", "bad-link"], ["#ville=%%%", "bad-link"], ["#ville=AAAAAAAA", "corrupt"]]) {
      replaced = [];
      location.hash = hash;
      const { panel } = setupPage();
      await tick();
      assert.deepEqual(replaced, [], hash);
      assert.ok(status(panel).startsWith(ERROR_TEXTS[code]), `${hash}: ${status(panel)}`);
      assert.ok(status(panel).includes(ui.OPEN_FAILED_TEXT));
    }
  });

  test("the engine refusing the bytes gives a message and keeps the hash", async () => {
    location.hash = HASH_PREFIX + (await encode(BYTES));
    const { panel } = setupPage({ replaceResult: new Error("cty_bad_size: x") });
    await tick();
    assert.equal(status(panel), ui.OPEN_FAILED_TEXT);
    assert.notEqual(location.hash, "");
  });

  test("without CompressionStream a shared link says so", async () => {
    location.hash = HASH_PREFIX + (await encode(BYTES));
    const original = Object.getOwnPropertyDescriptor(globalThis, "CompressionStream");
    Object.defineProperty(globalThis, "CompressionStream", { value: undefined, configurable: true, writable: true });
    try {
      const { panel } = setupPage();
      await tick();
      assert.ok(status(panel).startsWith(ERROR_TEXTS.unsupported));
      assert.deepEqual(replaced, []);
    } finally {
      Object.defineProperty(globalThis, "CompressionStream", original);
    }
  });
});
