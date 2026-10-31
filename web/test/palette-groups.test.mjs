// Tests for the palette groups on the DOM (web/palette-groups.js) with a small fake DOM: title buttons
// with aria-expanded, rows hidden when closed, the selected group opening and staying open, storage
// read and written under the named key, and a palette that works when storage is missing or refused.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { foldPaletteGroups } from "../palette-groups.js";
import { STORAGE_KEY } from "../palette-groups-model.js";

function fakeDocument() {
  return {
    createElement(tag) {
      const listeners = new Map();
      const attrs = new Map();
      const node = {
        tagName: tag.toUpperCase(), className: "", id: "", hidden: false, children: [], parent: null,
        _text: undefined, ownerDocument: null,
        get classList() {
          return { contains: (c) => node.className.split(" ").includes(c) };
        },
        get textContent() {
          if (node._text !== undefined) return node._text;
          return node.children.map((c) => c.textContent).join("");
        },
        set textContent(v) {
          node._text = String(v);
          node.children = [];
        },
        append(...nodes) {
          for (const n of nodes) {
            if (typeof n === "string") { node._text = (node._text ?? "") + n; continue; }
            n.parent = node;
            node.children.push(n);
          }
        },
        replaceChildren(...nodes) {
          for (const c of node.children) c.parent = null;
          node.children = [];
          node._text = undefined;
          node.append(...nodes);
        },
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
        addEventListener(type, fn) { listeners.set(type, fn); },
        click() { listeners.get("click")?.(); },
      };
      node.ownerDocument = doc;
      return node;
    },
  };
}
const doc = fakeDocument();

// A palette: one fieldset per group (legend = title, a .tool-row of buttons with data-tool keys).
function palette(groups) {
  const container = doc.createElement("nav");
  for (const [label, keys] of groups) {
    const fieldset = doc.createElement("fieldset");
    fieldset.className = "tool-group";
    const legend = doc.createElement("legend");
    legend.textContent = label;
    const row = doc.createElement("div");
    row.className = "tool-row";
    for (const key of keys) {
      const b = doc.createElement("button");
      b.className = "tool";
      b.setAttribute("aria-pressed", "false");
      b.textContent = key;
      row.append(b);
    }
    fieldset.append(legend, row);
    container.append(fieldset);
  }
  return container;
}

const GROUPS = [["Réseaux", ["road", "rail"]], ["Zones", ["residential"]], ["Terrain", ["water"]]];

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

// The shape of group i: its title button, its row, and the buttons of the row.
const titleOf = (c, i) => c.children[i].children[0].children[0];
const rowOf = (c, i) => c.children[i].children[1];

// Marks the button of `key` as pressed, like tools.js select() does.
function press(c, key) {
  for (const f of c.children) {
    for (const b of f.children[1].children) b.setAttribute("aria-pressed", String(b.textContent === key));
  }
}

describe("the title buttons", () => {
  test("each group's legend becomes a button controlling its row, open at start", () => {
    const c = palette(GROUPS);
    foldPaletteGroups(c, memoryStorage());
    const t = titleOf(c, 0);
    assert.equal(t.tagName, "BUTTON");
    assert.equal(t.textContent.includes("Réseaux"), true);
    assert.equal(t.getAttribute("aria-expanded"), "true");
    assert.equal(t.getAttribute("aria-controls"), rowOf(c, 0).id);
    assert.equal(rowOf(c, 0).hidden, false);
  });

  test("a click closes the group (aria-expanded false, row hidden), a second click opens it", () => {
    const c = palette(GROUPS);
    foldPaletteGroups(c, memoryStorage());
    titleOf(c, 1).click();
    assert.equal(titleOf(c, 1).getAttribute("aria-expanded"), "false");
    assert.equal(rowOf(c, 1).hidden, true);
    titleOf(c, 1).click();
    assert.equal(titleOf(c, 1).getAttribute("aria-expanded"), "true");
    assert.equal(rowOf(c, 1).hidden, false);
  });

  test("other groups are not touched by a click", () => {
    const c = palette(GROUPS);
    foldPaletteGroups(c, memoryStorage());
    titleOf(c, 0).click();
    assert.equal(rowOf(c, 1).hidden, false);
    assert.equal(rowOf(c, 2).hidden, false);
  });

  test("a fieldset that is not a palette group is skipped", () => {
    const c = palette([]);
    const bare = doc.createElement("fieldset");
    bare.className = "tool-group";
    c.append(bare);
    assert.doesNotThrow(() => foldPaletteGroups(c, memoryStorage()));
  });
});

describe("storage", () => {
  test("a click stores the state under the named key", () => {
    const storage = memoryStorage();
    const c = palette(GROUPS);
    foldPaletteGroups(c, storage);
    titleOf(c, 0).click();
    assert.deepEqual(JSON.parse(storage.data.get(STORAGE_KEY)), { Réseaux: false });
  });

  test("a stored closed group is closed at start, the others open", () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ Zones: false }) });
    const c = palette(GROUPS);
    foldPaletteGroups(c, storage);
    assert.equal(rowOf(c, 1).hidden, true);
    assert.equal(rowOf(c, 0).hidden, false);
    assert.equal(rowOf(c, 2).hidden, false);
  });

  test("unreadable stored text is ignored: every group open", () => {
    const c = palette(GROUPS);
    foldPaletteGroups(c, memoryStorage({ [STORAGE_KEY]: "{oops" }));
    for (let i = 0; i < GROUPS.length; i++) assert.equal(rowOf(c, i).hidden, false);
  });

  test("the page works without storage (null): groups still toggle", () => {
    const c = palette(GROUPS);
    foldPaletteGroups(c, null);
    titleOf(c, 2).click();
    assert.equal(rowOf(c, 2).hidden, true);
  });

  test("a storage that throws on read and write does not break the palette", () => {
    const broken = {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("quota"); },
    };
    const c = palette(GROUPS);
    assert.doesNotThrow(() => foldPaletteGroups(c, broken));
    titleOf(c, 0).click();
    assert.equal(rowOf(c, 0).hidden, true);
  });

  test("no storage argument and no global localStorage (node): works", () => {
    const c = palette(GROUPS);
    assert.doesNotThrow(() => foldPaletteGroups(c));
    titleOf(c, 0).click();
    assert.equal(rowOf(c, 0).hidden, true);
  });
});

describe("the selected tool's group", () => {
  test("selecting a tool in a closed group opens it, and stores that", () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ Zones: false }) });
    const c = palette(GROUPS);
    const folds = foldPaletteGroups(c, storage);
    press(c, "residential");
    folds.sync();
    assert.equal(rowOf(c, 1).hidden, false);
    assert.equal(titleOf(c, 1).getAttribute("aria-expanded"), "true");
    assert.deepEqual(JSON.parse(storage.data.get(STORAGE_KEY)), { Zones: true });
  });

  test("the selected group's title does not close it, and is marked disabled", () => {
    const c = palette(GROUPS);
    const folds = foldPaletteGroups(c, memoryStorage());
    press(c, "water");
    folds.sync();
    assert.equal(titleOf(c, 2).getAttribute("aria-disabled"), "true");
    titleOf(c, 2).click();
    assert.equal(rowOf(c, 2).hidden, false);
    assert.equal(titleOf(c, 2).getAttribute("aria-expanded"), "true");
  });

  test("when the selection moves on, the old group can be closed again", () => {
    const c = palette(GROUPS);
    const folds = foldPaletteGroups(c, memoryStorage());
    press(c, "water");
    folds.sync();
    press(c, "road");
    folds.sync();
    assert.equal(titleOf(c, 2).getAttribute("aria-disabled"), "false");
    titleOf(c, 2).click();
    assert.equal(rowOf(c, 2).hidden, true);
  });

  test("with no tool selected, sync changes nothing", () => {
    const c = palette(GROUPS);
    const folds = foldPaletteGroups(c, memoryStorage());
    folds.sync();
    for (let i = 0; i < GROUPS.length; i++) assert.equal(rowOf(c, i).hidden, false);
  });
});
