// Palette groups on the DOM (docs/game-design-v14.md, "Palette compacte"). Each group of the palette
// (a fieldset whose legend is the group's title and whose .tool-row holds its buttons) gets a title
// button (aria-expanded) that shows or hides its row. The state and its rules are in
// palette-groups-model.js; here they are applied and remembered in localStorage. Every storage access
// is guarded: without storage the groups still open and close, for the visit only.
import * as model from "./palette-groups-model.js";

// The page's storage, or null when the browser refuses it (blocked site data, private window).
function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // reading the property can throw: the groups then work without storage
  }
}

function readText(storage) {
  try {
    return storage?.getItem(model.STORAGE_KEY) ?? null;
  } catch {
    return null; // refused: nothing is stored, every group is open
  }
}

function writeText(storage, text) {
  try {
    storage?.setItem(model.STORAGE_KEY, text);
  } catch {
    // refused (quota, private window): the state lasts for this visit only
  }
}

const childWith = (node, test) => [...node.children].find(test) ?? null;

// Turns the legend of one group into its title button. Returns { id, row, title }, or null when the
// fieldset is not a palette group (no legend or no row).
function wrapGroup(fieldset, index, onToggle) {
  const legend = childWith(fieldset, (c) => c.tagName === "LEGEND");
  const row = childWith(fieldset, (c) => c.classList.contains("tool-row"));
  if (!legend || !row) return null;
  const id = legend.textContent.trim();
  const doc = fieldset.ownerDocument;
  const title = doc.createElement("button");
  title.type = "button";
  title.className = "tool-group-title";
  title.textContent = id;
  const caret = doc.createElement("span");
  caret.className = "tool-group-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "▾";
  title.append(caret);
  row.id = `palette-group-${index}`;
  title.setAttribute("aria-controls", row.id);
  title.addEventListener("click", () => onToggle(id));
  legend.replaceChildren(title);
  return { id, row, title };
}

// Makes the palette's groups collapsible inside `container` (the palette element, already built).
// Returns { sync() }: call it after the palette shows its selection (aria-pressed on the buttons), so
// the group of the selected tool opens and stays open.
export function foldPaletteGroups(container, storage = defaultStorage()) {
  let state = {};
  const onToggle = (id) => commit(model.toggle(state, id, selectedId()));
  const records = [...container.children]
    .filter((c) => c.classList.contains("tool-group"))
    .slice(0, model.MAX_GROUPS)
    .map((f, i) => wrapGroup(f, i, onToggle))
    .filter((r) => r !== null);
  const ids = records.map((r) => r.id);
  state = model.parseStored(readText(storage), ids);

  // The id of the group whose row holds the pressed button (aria-pressed="true"), or null.
  function selectedId() {
    const groups = records.map((r) => ({
      id: r.id,
      selected: childWith(r.row, (b) => b.getAttribute("aria-pressed") === "true") !== null,
    }));
    return model.findSelected(groups);
  }

  function show() {
    const selected = selectedId();
    for (const r of records) {
      const open = model.isOpen(state, r.id);
      r.title.setAttribute("aria-expanded", String(open));
      r.title.setAttribute("aria-disabled", String(r.id === selected));
      r.row.hidden = !open;
    }
  }

  function commit(next) {
    if (next === state) return show();
    state = next;
    writeText(storage, model.serialise(state, ids));
    show();
  }

  function sync() {
    const selected = selectedId();
    if (selected !== null && !model.isOpen(state, selected)) commit(model.reveal(state, selected));
    else show();
  }

  sync();
  return { sync };
}
