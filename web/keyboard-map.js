// Page feature: the 2D map is played with the keyboard (docs/game-design-v1.md, "Accessibilité").
// keyboard-map-model.js moves the cursor and writes the announcement; this module is the thin DOM layer:
//   - the map canvas takes the focus (tabindex 0) and says what the keys do (aria-label);
//   - the arrows move a cursor, drawn as an outline on the overlay canvas (the one tools.js draws its
//     hover outline on; tools.js clears it at every redraw, and update() draws the cursor after that);
//   - Entrée applies the selected tool at the cursor by the pointer path of a click (input.js
//     attachPointer: pointerdown then pointerup on the map), so tools.js needs no change;
//   - a polite live region (role=status) announces the tile under the cursor.
// Nothing is drawn or announced while the map has no focus or the 3D view is shown.
// Feature hooks: setup(api) once, update(api) after every redraw (main.js).
import { TILE_PX } from "./tools.js";
import { formatZoneStatus } from "./query.js";
import { tileAt } from "./input.js";
import { initialCursor, clampCursor, move, keyBelongsToMap, describeTile, APPLY_KEY } from "./keyboard-map-model.js";

const CANVAS_LABEL = "Carte de la ville. Flèches : déplacer le curseur (Maj : par bonds), Entrée : appliquer l'outil.";
const CURSOR_COLOUR = "#ffd23f";
const CURSOR_LINE_PX = 2;
/** pointerId of the presses the keyboard makes: no real pointer has it, so the capture call fails softly. */
const SYNTHETIC_POINTER = -1;

let canvas = null; // the map canvas
let overlay = null; // the overlay canvas (tools.js hover outline)
let frame = null; // #map-frame, which holds the live region
let live = null; // the live region
let cursor = null; // { x, y } tile, once the map has a city

const inThreeD = () => frame.classList.contains("is-3d");
const focused = () => document.activeElement === canvas;

// The lines of the query tool for a tile (the same text as a click on the query tool).
function linesAt(api, x, y) {
  const city = api.city();
  return typeof city.query === "function" ? formatZoneStatus(city.query(x, y)) : [];
}

function announce(api, tile) {
  live.textContent = describeTile(tile.x, tile.y, linesAt(api, tile.x, tile.y));
}

function mapSize(api) {
  const city = api.city();
  return { w: city.width(), h: city.height() };
}

// Draws the cursor on the overlay, at its tile, when the map has the focus (outline of one tile).
function paintCursor() {
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  if (!focused() || inThreeD() || cursor === null) return;
  const g = overlay.getContext("2d");
  g.strokeStyle = CURSOR_COLOUR;
  g.lineWidth = CURSOR_LINE_PX;
  const inset = CURSOR_LINE_PX / 2;
  g.strokeRect(cursor.x * TILE_PX + inset, cursor.y * TILE_PX + inset, TILE_PX - CURSOR_LINE_PX, TILE_PX - CURSOR_LINE_PX);
}

// Applies the selected tool at a tile, as a click on it does: a press and a release on the canvas,
// at the centre of the tile (input.js tileAt takes the tile from the displayed size).
function pressAt(tile, w, h) {
  const r = canvas.getBoundingClientRect();
  const init = {
    bubbles: true, button: 0, isPrimary: true, pointerId: SYNTHETIC_POINTER,
    clientX: r.left + ((tile.x + 0.5) / w) * r.width,
    clientY: r.top + ((tile.y + 0.5) / h) * r.height,
  };
  canvas.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
  canvas.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
}

function onKey(api, ev) {
  if (!keyBelongsToMap(ev) || !api.isReady() || inThreeD()) return;
  ev.preventDefault(); // the arrows scroll nothing, Entrée clicks nothing
  const { w, h } = mapSize(api);
  cursor = cursor === null ? initialCursor(w, h) : clampCursor(cursor, w, h);
  if (ev.key === APPLY_KEY) {
    pressAt(cursor, w, h); // the click path redraws the page
  } else {
    cursor = move(cursor, ev.key, w, h, ev.shiftKey);
    api.redraw();
  }
  announce(api, cursor);
}

// A press of the mouse moves the cursor to the tile pressed, so the keys continue from there.
function onPointerDown(api, ev) {
  if (!api.isReady() || inThreeD()) return;
  const { w, h } = mapSize(api);
  const tile = tileAt(ev.clientX, ev.clientY, canvas.getBoundingClientRect(), w, h);
  if (tile) cursor = tile;
}

export function setup(api) {
  canvas = api.$("map");
  overlay = api.$("overlay");
  frame = api.$("map-frame");
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", CANVAS_LABEL);
  live = document.createElement("div");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
  frame.append(live);
  canvas.addEventListener("keydown", (ev) => onKey(api, ev));
  canvas.addEventListener("pointerdown", (ev) => onPointerDown(api, ev));
  // the cursor shows only while the map has the focus: a redraw on focus and on blur paints or clears it
  canvas.addEventListener("focus", () => api.redraw());
  canvas.addEventListener("blur", () => api.redraw());
}

// After every redraw (tools.js has just cleared the overlay): keeps the cursor inside the map and draws it.
export function update(api) {
  if (!api.isReady() || canvas === null) return;
  const { w, h } = mapSize(api);
  cursor = cursor === null ? initialCursor(w, h) : clampCursor(cursor, w, h);
  paintCursor();
}
