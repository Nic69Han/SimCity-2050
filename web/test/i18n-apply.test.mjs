// The page language (web/i18n.js) on a fake DOM: applyLanguage keeps the controls inside labels,
// translates attributes, sets the document's lang; the choice is read and written with a storage
// that may refuse; the toggle buttons follow their state; setup wires the language select.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  applyLanguage, t, translate, currentLanguage, normalizeLanguage, readLanguage, writeLanguage,
  toggleText, setup, STORAGE_KEY,
} from "../i18n.js";

const ELEMENT = 1;
const TEXT = 3;

const text = (value) => ({ nodeType: TEXT, nodeValue: value });

// An element with attributes, child nodes, and a querySelectorAll that understands [attribute].
function element(tag, { attrs = {}, children = [] } = {}) {
  const attributes = new Map(Object.entries(attrs));
  const node = {
    nodeType: ELEMENT,
    tagName: tag.toUpperCase(),
    childNodes: children,
    getAttribute: (n) => (attributes.has(n) ? attributes.get(n) : null),
    setAttribute: (n, v) => attributes.set(n, String(v)),
    get textContent() {
      return this.childNodes.filter((c) => c.nodeType === TEXT).map((c) => c.nodeValue).join("");
    },
    set textContent(v) {
      this.childNodes.splice(0, this.childNodes.length, text(String(v)));
    },
    querySelectorAll: (selector) => matching(node, selector),
  };
  return node;
}

function* descendants(node) {
  for (const child of node.childNodes) {
    if (child.nodeType !== ELEMENT) continue;
    yield child;
    yield* descendants(child);
  }
}

// Only "[name]" selectors are used by the module.
function matching(root, selector) {
  const name = selector.match(/^\[([^\]]+)\]$/)[1];
  return [...descendants(root)].filter((el) => el.getAttribute(name) !== null);
}

function fakeDocument(children) {
  const documentElement = element("html", { attrs: { lang: "fr" } });
  const doc = { documentElement, childNodes: [documentElement, ...children] };
  doc.querySelectorAll = (selector) => matching(doc, selector);
  documentElement.ownerDocument = doc;
  return doc;
}

afterEach(() => {
  applyLanguage(fakeDocument([]), "fr"); // the module keeps the last language: back to French
});

test("translate: the text of a key in a language; an unknown key gives the key itself", () => {
  assert.equal(translate("save", "en"), "Save");
  assert.equal(translate("save", "fr"), "Enregistrer");
  assert.equal(translate("save", "de"), "Enregistrer", "an unknown language is French");
  assert.equal(translate("no.such.key", "en"), "no.such.key");
});

test("normalizeLanguage keeps the two languages and maps anything else to French", () => {
  assert.equal(normalizeLanguage("en"), "en");
  assert.equal(normalizeLanguage("fr"), "fr");
  assert.equal(normalizeLanguage("EN"), "fr", "exact codes only");
  assert.equal(normalizeLanguage(undefined), "fr");
  assert.equal(normalizeLanguage(null), "fr");
});

test("applyLanguage sets the text of a marked element and the document's lang", () => {
  const button = element("button", { attrs: { "data-i18n": "save" }, children: [text("Enregistrer")] });
  const doc = fakeDocument([button]);
  assert.equal(applyLanguage(doc, "en"), "en");
  assert.equal(button.textContent, "Save");
  assert.equal(doc.documentElement.lang, "en");
  assert.equal(currentLanguage(), "en");
  assert.equal(t("save"), "Save", "t() follows the language applied");
  applyLanguage(doc, "fr");
  assert.equal(button.textContent, "Enregistrer");
  assert.equal(doc.documentElement.lang, "fr");
});

test("applyLanguage keeps the controls of a label and the spaces around its words", () => {
  const input = element("input", { attrs: { id: "speed" } });
  const label = element("label", { attrs: { "data-i18n": "speed" }, children: [text("Vitesse "), input] });
  applyLanguage(fakeDocument([label]), "en");
  assert.equal(label.childNodes[1], input, "the input is still there, in place");
  assert.equal(label.childNodes[0].nodeValue, "Speed ", "the trailing space is kept");
});

test("a label whose words come after its control: the leading space is kept", () => {
  const input = element("input");
  const label = element("label", { attrs: { "data-i18n": "disasters" }, children: [input, text(" Catastrophes")] });
  applyLanguage(fakeDocument([label]), "en");
  assert.equal(label.childNodes[0], input);
  assert.equal(label.childNodes[1].nodeValue, " Disasters");
});

test("applyLanguage translates aria-label, title and placeholder on their own markers", () => {
  const canvas = element("canvas", { attrs: { "data-i18n-label": "map.label" } });
  const relief = element("label", { attrs: { "data-i18n-title": "relief.title", title: "x" } });
  const seed = element("input", { attrs: { "data-i18n-placeholder": "seed.placeholder" } });
  applyLanguage(fakeDocument([canvas, relief, seed]), "en");
  assert.equal(canvas.getAttribute("aria-label"), "City map");
  assert.equal(relief.getAttribute("title").startsWith("Building on a slope"), true);
  assert.equal(seed.getAttribute("placeholder"), "random");
});

test("an element with no text gets its text; an element with no marker is left as it was", () => {
  const empty = element("option", { attrs: { "data-i18n": "size.custom" } });
  const plain = element("p", { children: [text("Gardé")] });
  applyLanguage(fakeDocument([empty, plain]), "en");
  assert.equal(empty.textContent, "Custom");
  assert.equal(plain.textContent, "Gardé");
});

test("an unknown language is applied as French", () => {
  const button = element("button", { attrs: { "data-i18n": "save" }, children: [text("x")] });
  assert.equal(applyLanguage(fakeDocument([button]), "xx"), "fr");
  assert.equal(button.textContent, "Enregistrer");
});

test("toggle texts: play shows Play while stopped and Pause while playing; 3D shows the view it switches to", () => {
  applyLanguage(fakeDocument([]), "fr");
  assert.equal(toggleText("play", false), "▶ Lecture");
  assert.equal(toggleText("play", true), "⏸ Pause");
  assert.equal(toggleText("view3d", false), "Vue 3D");
  assert.equal(toggleText("view3d", true), "Vue 2D");
  applyLanguage(fakeDocument([]), "en");
  assert.equal(toggleText("play", false), "▶ Play");
  assert.equal(toggleText("view3d", false), "3D view");
  assert.equal(toggleText("view3d", true), "2D view");
});

test("readLanguage: the stored choice; a missing, unknown or unreadable choice is French", () => {
  assert.equal(readLanguage({ getItem: (k) => (k === STORAGE_KEY ? "en" : null) }), "en");
  assert.equal(readLanguage({ getItem: () => null }), "fr");
  assert.equal(readLanguage({ getItem: () => "de" }), "fr");
  assert.equal(readLanguage(null), "fr", "no storage at all");
  const warned = [];
  const original = console.warn;
  console.warn = (...args) => warned.push(args);
  try {
    assert.equal(readLanguage({ getItem: () => { throw new Error("denied"); } }), "fr", "a throwing storage");
  } finally {
    console.warn = original;
  }
  assert.equal(warned.length, 1, "the refusal is reported once");
});

test("writeLanguage stores the normalized choice; a refusing storage reports false and does not throw", () => {
  const values = new Map();
  const storage = { setItem: (k, v) => values.set(k, v) };
  assert.equal(writeLanguage(storage, "en"), true);
  assert.equal(values.get(STORAGE_KEY), "en");
  assert.equal(writeLanguage(storage, "xx"), true);
  assert.equal(values.get(STORAGE_KEY), "fr");
  const original = console.warn;
  console.warn = () => {};
  try {
    const refusing = { setItem: () => { throw new Error("quota"); } };
    assert.equal(writeLanguage(refusing, "en"), false);
    assert.equal(writeLanguage(null, "en"), false, "no storage");
  } finally {
    console.warn = original;
  }
});

// setup() reads the document and the storage of the browser: both are stood in for here.
function withBrowser(stored, fn) {
  const saved = { document: globalThis.document, localStorage: globalThis.localStorage };
  const values = new Map(stored ? [[STORAGE_KEY, stored]] : []);
  globalThis.localStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const button = element("button", { attrs: { "data-i18n": "save" }, children: [text("Enregistrer")] });
  const doc = fakeDocument([button]);
  globalThis.document = doc;
  try {
    return fn({ doc, button, values });
  } finally {
    globalThis.document = saved.document;
    globalThis.localStorage = saved.localStorage;
  }
}

function fakeSelect(value) {
  const listeners = new Map();
  return {
    value,
    addEventListener: (type, fn) => listeners.set(type, fn),
    change(next) {
      this.value = next;
      listeners.get("change")();
    },
  };
}

test("setup applies the stored language and shows it in the select", () => {
  withBrowser("en", ({ doc, button }) => {
    const select = fakeSelect("fr");
    const playButton = element("button", { attrs: { "aria-pressed": "false" }, children: [text("x")] });
    const api = { $: (id) => ({ language: select, play: playButton })[id] ?? null, redraw() {} };
    setup(api);
    assert.equal(doc.documentElement.lang, "en");
    assert.equal(button.textContent, "Save");
    assert.equal(select.value, "en");
    assert.equal(playButton.textContent, "▶ Play", "the play button is labelled at setup");
  });
});

test("choosing a language in the select applies it, keeps it and redraws the page", () => {
  withBrowser(null, ({ doc, button, values }) => {
    const select = fakeSelect("fr");
    let redraws = 0;
    setup({ $: (id) => (id === "language" ? select : null), redraw: () => redraws++ });
    select.change("en");
    assert.equal(button.textContent, "Save");
    assert.equal(doc.documentElement.lang, "en");
    assert.equal(values.get(STORAGE_KEY), "en", "kept for the next visit");
    assert.equal(redraws, 1);
  });
});

test("without a language select, setup still applies the stored language", () => {
  withBrowser("en", ({ button }) => {
    setup({ $: () => null, redraw() {} });
    assert.equal(button.textContent, "Save");
  });
});
