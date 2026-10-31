// The two dictionaries of the page (web/i18n-fr.js, web/i18n-en.js) hold the same keys, and they are
// exactly the keys that index.html and the toggle buttons use (no key missing, no key unused).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FR } from "../i18n-fr.js";
import { EN } from "../i18n-en.js";
import { LANGUAGES, DEFAULT_LANGUAGE } from "../i18n.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const TOGGLE_KEYS = ["play.play", "play.pause", "view3d.on", "view3d.off"];

// The keys named by data-i18n, data-i18n-label, data-i18n-title and data-i18n-placeholder in index.html.
function markedKeys(source) {
  const keys = new Set();
  for (const m of source.matchAll(/\sdata-i18n(?:-(?:label|title|placeholder))?="([^"]+)"/g)) keys.add(m[1]);
  return keys;
}

test("the two dictionaries have the same keys, each with a non-empty text", () => {
  assert.deepEqual(Object.keys(FR).sort(), Object.keys(EN).sort());
  for (const dict of [FR, EN]) {
    for (const [key, text] of Object.entries(dict)) {
      assert.equal(typeof text, "string", key);
      assert.ok(text.trim().length > 0, `${key} has no text`);
    }
  }
});

test("the languages are French (the default) and English", () => {
  assert.deepEqual([...LANGUAGES], ["fr", "en"]);
  assert.equal(DEFAULT_LANGUAGE, "fr");
});

test("every key marked in index.html and every toggle key exists in both languages", () => {
  for (const key of [...markedKeys(html), ...TOGGLE_KEYS]) {
    assert.ok(Object.hasOwn(FR, key), `missing in French: ${key}`);
    assert.ok(Object.hasOwn(EN, key), `missing in English: ${key}`);
  }
});

test("every dictionary key is used: by index.html or by a toggle button", () => {
  const used = new Set([...markedKeys(html), ...TOGGLE_KEYS]);
  for (const key of Object.keys(FR)) assert.ok(used.has(key), `unused key: ${key}`);
});

test("index.html has the language selector with French and English options", () => {
  assert.match(html, /<select id="language">/);
  assert.match(html, /<option value="fr">Français<\/option>/);
  assert.match(html, /<option value="en">English<\/option>/);
  assert.match(html, /<html lang="fr">/);
});

test("the English texts are not the French ones (no text left untranslated by mistake)", () => {
  const same = Object.keys(FR).filter((k) => FR[k] === EN[k] && !/^[\s\d×().…:-]*$/.test(FR[k]));
  // "Chargement…" and words that are the same in both languages are allowed here; the list stays short.
  assert.ok(same.length <= 2, `same text in both languages: ${same.join(", ")}`);
});
