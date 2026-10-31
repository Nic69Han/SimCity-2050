// Page feature: touch on the 2D map and the panels under it (docs/game-design-v1.md, workstream mobile).
// touch-model.js decides what a touch does; this module wires it to the map frame. Only touch
// pointers are seen here: the mouse and the pen keep their behaviour (input.js).
//   * one finger with a tool selected: the stroke of input.js, as with the mouse;
//   * one finger with no tool: drags the map (it can only move once the map is zoomed);
//   * two fingers: pinch to zoom about their midpoint. During a pinch the moves are stopped
//     before they reach input.js, so no stroke follows the fingers; a press that landed on the
//     map before the second finger keeps its effect (a tool placed on the first touch).
// The zoom is a CSS transform of the flat canvases (#map, #overlay) inside the clipped frame;
// the 3D view has its own camera and receives none of it.
// Panels: on a narrow screen each panel under the map shows its heading only; a button in the
// heading opens it (css/mobile.css). The headings are made here, once per panel.
import {
  createGesture, pointerDown, pointerMove, pointerUp, applyGesture, clampView, VIEW_START,
} from "./touch-model.js";

let state = null; // { frame, palette, gesture, view } once setup() has run

const isTouch = (ev) => ev.pointerType === "touch";

// The point of an event in frame pixels (inside the frame's border).
function localPoint(ev) {
  const frame = state.frame;
  const r = frame.getBoundingClientRect();
  return { x: ev.clientX - r.left - frame.clientLeft, y: ev.clientY - r.top - frame.clientTop };
}

function frameSize() {
  return { w: state.frame.clientWidth, h: state.frame.clientHeight };
}

// A tool is selected when one of the palette's buttons is marked active (tools.js).
function toolSelected() {
  return state.palette?.querySelector(".tool.active") != null;
}

// Writes the view as CSS custom properties; `is-zoomed` tells the stylesheet to move the canvases.
function setView(next) {
  const { frame } = state;
  state.view = next;
  frame.style.setProperty("--view-x", `${next.x}px`);
  frame.style.setProperty("--view-y", `${next.y}px`);
  frame.style.setProperty("--view-s", String(next.scale));
  frame.classList.toggle("is-zoomed", next.scale > 1);
}

function onDown(ev) {
  if (!isTouch(ev) || state.frame.classList.contains("is-3d")) return;
  const p = localPoint(ev);
  pointerDown(state.gesture, ev.pointerId, p.x, p.y);
}

function onMove(ev) {
  if (!isTouch(ev) || !state.gesture.points.has(ev.pointerId)) return;
  const p = localPoint(ev);
  const action = pointerMove(state.gesture, ev.pointerId, p.x, p.y);
  if (state.gesture.points.size > 1) ev.stopPropagation(); // a pinch: no tool stroke follows
  if (!action || (action.type === "drag" && toolSelected())) return;
  const { w, h } = frameSize();
  setView(applyGesture(state.view, action, w, h));
}

function onEnd(ev) {
  if (isTouch(ev)) pointerUp(state.gesture, ev.pointerId);
}

function isPanel(el) {
  return el.tagName === "SECTION" && el.classList.contains("box");
}

function headOf(section) {
  return [...section.children].find((c) => c.classList.contains("panel-head")) ?? null;
}

// The heading of a panel: a button with the panel's name (its aria-label), which opens it.
function ensureHead(section) {
  if (headOf(section)) return;
  const doc = section.ownerDocument;
  const head = doc.createElement("h2");
  head.classList.add("panel-head");
  const button = doc.createElement("button");
  button.type = "button";
  button.addEventListener("click", () => {
    const open = section.classList.toggle("is-open");
    button.setAttribute("aria-expanded", String(open));
  });
  head.append(button);
  section.prepend(head);
}

// The heading follows the panel's name (translated with the page language) and the open state.
function refreshHead(section) {
  const button = headOf(section)?.children[0];
  if (!button) return;
  const name = section.getAttribute("aria-label") ?? "";
  if (button.textContent !== name) button.textContent = name;
  button.setAttribute("aria-expanded", String(section.classList.contains("is-open")));
}

function eachPanel(fn) {
  for (const el of [...state.frame.parentElement.children]) {
    if (isPanel(el)) fn(el);
  }
}

export function setup(api) {
  const frame = api.$("map-frame");
  if (!frame?.parentElement) {
    state = null; // no map on the page: nothing to wire
    return;
  }
  state = { frame, palette: api.$("palette"), gesture: createGesture(), view: VIEW_START };
  frame.addEventListener("pointerdown", onDown, { capture: true });
  frame.addEventListener("pointermove", onMove, { capture: true });
  frame.addEventListener("pointerup", onEnd, { capture: true });
  frame.addEventListener("pointercancel", onEnd, { capture: true });
  eachPanel((section) => {
    ensureHead(section);
    refreshHead(section);
  });
}

// After every redraw: the view is kept inside the frame (the window may have been resized), and
// the panels' headings are present and named (a panel may have rebuilt its contents).
export function update() {
  if (!state) return;
  const { w, h } = frameSize();
  const kept = clampView(state.view, w, h);
  if (kept.scale !== state.view.scale || kept.x !== state.view.x || kept.y !== state.view.y) setView(kept);
  eachPanel((section) => {
    ensureHead(section);
    refreshHead(section);
  });
}
