// Page feature: the language of the fixed interface texts (docs/game-design-v1.md, workstream mobile).
// The select «Langue» of the header switches the texts marked in index.html (data-i18n: the text,
// data-i18n-label: aria-label, data-i18n-title: title, data-i18n-placeholder: placeholder) between
// French (web/i18n-fr.js, the default) and English (web/i18n-en.js). The generated texts (messages,
// tool names, status lines) stay French: that limit is written in CONTRIBUTING.md. The choice is
// kept in localStorage (per viewer, never shared); a browser that refuses storage keeps the page's
// language for this visit only.
import { FR } from "./i18n-fr.js";
import { EN } from "./i18n-en.js";

export const LANGUAGES = Object.freeze(["fr", "en"]);
export const DEFAULT_LANGUAGE = "fr";
export const STORAGE_KEY = "simcity.lang";

const DICTIONARIES = Object.freeze({ fr: FR, en: EN });
// data-i18n-* attribute -> the attribute that receives the translation
const ATTRIBUTE_TARGETS = Object.freeze({
  "data-i18n-label": "aria-label",
  "data-i18n-title": "title",
  "data-i18n-placeholder": "placeholder",
});
// The buttons whose text main.js sets (play, 3D view): their key follows the aria-pressed state.
const TOGGLE_KEYS = Object.freeze({
  play: ["play.play", "play.pause"],
  view3d: ["view3d.off", "view3d.on"],
});
const TEXT_NODE = 3;

let current = DEFAULT_LANGUAGE; // the language of the last applyLanguage()

export function normalizeLanguage(value) {
  return LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

// The text of a key in a language; a key missing from the language is taken from French.
export function translate(key, lang = current) {
  const dict = DICTIONARIES[normalizeLanguage(lang)];
  return dict[key] ?? FR[key] ?? key;
}

// The text of a key in the language of the page.
export function t(key) {
  return translate(key, current);
}

// The stored choice, or the default. A storage that throws (or is missing) gives the default.
export function readLanguage(storage) {
  try {
    return normalizeLanguage(storage?.getItem(STORAGE_KEY));
  } catch (e) {
    console.warn("langue : choix non lu, français par défaut", e);
    return DEFAULT_LANGUAGE;
  }
}

// Keeps the choice. Returns false when the storage refused it (the choice then lasts this visit).
export function writeLanguage(storage, lang) {
  try {
    storage.setItem(STORAGE_KEY, normalizeLanguage(lang));
    return true;
  } catch (e) {
    console.warn("langue : choix non enregistré", e);
    return false;
  }
}

// Replaces the words of an element and keeps everything else in it (a checkbox or a file input in
// a label): the first text node with words gets the text, the spaces around it are kept.
function setText(el, text) {
  const node = [...el.childNodes].find((n) => n.nodeType === TEXT_NODE && n.nodeValue.trim() !== "");
  if (!node) {
    el.textContent = text;
    return;
  }
  const lead = node.nodeValue.match(/^\s*/)[0];
  const trail = node.nodeValue.match(/\s*$/)[0];
  node.nodeValue = lead + text + trail;
}

// Translates every marked element under `root` into `lang`, and sets the document's lang attribute.
// Returns the language applied.
export function applyLanguage(root, lang) {
  current = normalizeLanguage(lang);
  const doc = root.ownerDocument ?? root;
  if (doc.documentElement) doc.documentElement.lang = current;
  for (const el of root.querySelectorAll("[data-i18n]")) {
    setText(el, translate(el.getAttribute("data-i18n"), current));
  }
  for (const [marker, target] of Object.entries(ATTRIBUTE_TARGETS)) {
    for (const el of root.querySelectorAll(`[${marker}]`)) {
      el.setAttribute(target, translate(el.getAttribute(marker), current));
    }
  }
  return current;
}

// The text a toggle button shows for its state: "play" shows Play while stopped and Pause while
// playing; "view3d" shows the view it switches to (3D while the 2D map is shown, and back).
export function toggleText(name, pressed) {
  const [off, on] = TOGGLE_KEYS[name];
  return t(pressed ? on : off);
}

// Writes the toggle buttons' text when it differs from the state's text (so an observer that
// reacts to its own change stops at once).
function relabelToggles(api) {
  for (const name of Object.keys(TOGGLE_KEYS)) {
    const button = api.$(name);
    if (!button) continue;
    const text = toggleText(name, button.getAttribute("aria-pressed") === "true");
    if (button.textContent !== text) button.textContent = text;
  }
}

function watchToggles(api) {
  if (typeof MutationObserver !== "function") return;
  const observer = new MutationObserver(() => relabelToggles(api));
  const options = { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed"] };
  for (const name of Object.keys(TOGGLE_KEYS)) {
    const button = api.$(name);
    if (button) observer.observe(button, options);
  }
}

// The choice kept in storage, when storage can be reached at all.
function storageOrNull() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function setup(api) {
  const storage = storageOrNull();
  const lang = readLanguage(storage);
  applyLanguage(document, lang);
  relabelToggles(api);
  watchToggles(api);
  const select = api.$("language");
  if (!select) return;
  select.value = lang;
  select.addEventListener("change", () => {
    const next = normalizeLanguage(select.value);
    writeLanguage(storage, next);
    applyLanguage(document, next);
    relabelToggles(api);
    api.redraw(); // the page's own texts (the panel headings) follow the language at the next redraw
  });
}
