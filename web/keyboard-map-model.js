// Keyboard map, the pure part (docs/game-design-v1.md, "Accessibilité"): the tile cursor of the 2D map,
// its moves with the arrow keys, which keys belong to the map, and the French text announced for a
// tile. No DOM: keyboard-map.js draws the cursor and announces what this module returns.
//
// The cursor is { x, y }, a tile of a map of w x h tiles (x in 0..w-1, y in 0..h-1). It never leaves the map.

/** Tiles moved by one arrow key pressed with Maj (Shift). */
export const CURSOR_JUMP = 8;
/** The key that applies the selected tool at the cursor, as a click does. */
export const APPLY_KEY = "Enter";

const ARROW_STEPS = Object.freeze({
  ArrowLeft: Object.freeze([-1, 0]),
  ArrowRight: Object.freeze([1, 0]),
  ArrowUp: Object.freeze([0, -1]),
  ArrowDown: Object.freeze([0, 1]),
});

/** Keys that belong to the map when it has the focus: the four arrows and Entrée. */
export const MAP_KEYS = Object.freeze([...Object.keys(ARROW_STEPS), APPLY_KEY]);

/** Field elements: a key typed there is never a map key. */
const FIELD_TAGS = Object.freeze(["INPUT", "SELECT", "TEXTAREA"]);

// A map size must be a positive whole number of tiles: anything else is an error, not a clamp.
function checkSize(w, h) {
  if (!Number.isInteger(w) || w < 1 || !Number.isInteger(h) || h < 1) {
    throw new RangeError(`keyboard map: the map size must be whole and >= 1, got ${w} x ${h}`);
  }
}

const clampTo = (v, max) => Math.min(max - 1, Math.max(0, v));

/** The cursor at the middle of a w x h map: where the keyboard starts. */
export function initialCursor(w, h) {
  checkSize(w, h);
  return { x: Math.floor(w / 2), y: Math.floor(h / 2) };
}

/** The cursor moved inside the map (a cursor left outside by a smaller map comes back to the edge). */
export function clampCursor(state, w, h) {
  checkSize(w, h);
  if (!Number.isInteger(state?.x) || !Number.isInteger(state?.y)) {
    throw new RangeError(`keyboard map: the cursor must be whole tiles, got ${JSON.stringify(state)}`);
  }
  return { x: clampTo(state.x, w), y: clampTo(state.y, h) };
}

/**
 * The cursor after `key` (an arrow key of KeyboardEvent.key). With `jump` (Maj held) the step is
 * CURSOR_JUMP tiles. Any other key leaves the cursor where it is. Always a new object, inside the map.
 */
export function move(state, key, w, h, jump = false) {
  const at = clampCursor(state, w, h);
  const step = ARROW_STEPS[key];
  if (step === undefined) return at;
  const n = jump ? CURSOR_JUMP : 1;
  return clampCursor({ x: at.x + step[0] * n, y: at.y + step[1] * n }, w, h);
}

/**
 * Whether a key event belongs to the map. `event` is { key, ctrlKey, metaKey, altKey, target }, with
 * target { tagName, isContentEditable }. A key typed in a field, or with Ctrl, Cmd or Alt, is not the map's.
 */
export function keyBelongsToMap(event) {
  if (!MAP_KEYS.includes(event?.key)) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target ?? {};
  if (target.isContentEditable === true) return false;
  return !FIELD_TAGS.includes(String(target.tagName ?? "").toUpperCase());
}

/**
 * The French text announced for a tile: «Tuile 12, 40 : route» (x, y, then the lines of the query tool,
 * tile.query lines of formatZoneStatus: category first, then the fields). `lines` may be empty.
 */
export function describeTile(x, y, lines = []) {
  const head = `Tuile ${x}, ${y}`;
  if (lines.length === 0) return `${head} : rien à signaler`;
  const [category, ...fields] = lines;
  const first = category.charAt(0).toLowerCase() + category.slice(1);
  return [`${head} : ${first}`, ...fields].join(", ");
}
