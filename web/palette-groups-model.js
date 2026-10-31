// Palette groups (docs/game-design-v14.md, "Palette compacte"): the pure state of the collapsible
// groups of the tool palette. A group is open unless it is stored as closed; the group of the selected
// tool is always open, and its title does not close it. palette-groups.js applies this to the DOM.

export const STORAGE_KEY = "simcity.palette.groups";
export const MAX_GROUPS = 16; // the palette has 9 groups today; more ids are ignored
export const MAX_STORED_CHARS = 512; // a longer stored value is not ours: it counts as nothing stored

// The state of the groups: { [groupId]: boolean }, true = open. A missing id is open.

// The state read from the stored text: the known ids with a boolean value, nothing else. Unreadable
// text (not JSON, not an object, too long) gives an empty state.
export function parseStored(text, ids) {
  if (typeof text !== "string" || text.length > MAX_STORED_CHARS) return {};
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {}; // a value that is not JSON is the same as nothing stored
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const state = {};
  for (const id of ids.slice(0, MAX_GROUPS)) {
    if (typeof data[id] === "boolean") state[id] = data[id];
  }
  return state;
}

// The text stored for a state: a JSON object of the known ids only.
export function serialise(state, ids) {
  const out = {};
  for (const id of ids.slice(0, MAX_GROUPS)) {
    if (typeof state[id] === "boolean") out[id] = state[id];
  }
  return JSON.stringify(out);
}

// Open unless stored as closed.
export function isOpen(state, id) {
  return state[id] !== false;
}

// The state with group `id` open (the same object when it already is).
export function reveal(state, id) {
  return state[id] === true ? state : { ...state, [id]: true };
}

// The state after a click on the title of group `id`. The group of the selected tool (`selected`)
// stays open: the click does nothing for it.
export function toggle(state, id, selected) {
  if (id === selected) return state;
  return { ...state, [id]: !isOpen(state, id) };
}

// The id of the group that holds the selected tool, given groups = [{ id, selected }] (selected: its
// button is the pressed one); null when none does.
export function findSelected(groups) {
  const hit = groups.find((g) => g.selected === true);
  return hit ? hit.id : null;
}
