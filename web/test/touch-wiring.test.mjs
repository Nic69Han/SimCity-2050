// Wiring of the touch view (web/touch.js) on a fake DOM: pinch, drag with and without a tool, mouse and
// third pointers ignored, the 3D view left alone, the view kept in its frame, and the panel headings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, update } from "../touch.js";

function classList(initial = []) {
  const set = new Set(initial);
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle(c, force) {
      const on = force ?? !set.has(c);
      if (on) set.add(c);
      else set.delete(c);
      return on;
    },
  };
}

function fakeDoc() {
  const doc = {
    createElement: (tag) => element(tag, doc),
  };
  return doc;
}

// A minimal element: children, attributes, one listener per event type, style variables.
function element(tag, doc, { classes = [], w = 0, h = 0, text = "" } = {}) {
  const attrs = new Map();
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    ownerDocument: doc,
    children: [],
    classList: classList(classes),
    clientWidth: w,
    clientHeight: h,
    clientLeft: 0,
    clientTop: 0,
    textContent: text,
    style: { vars: {}, setProperty(k, v) { this.vars[k] = v; } },
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    getAttribute: (n) => (attrs.has(n) ? attrs.get(n) : null),
    setAttribute: (n, v) => attrs.set(n, String(v)),
    addEventListener: (type, fn) => listeners.set(type, fn),
    fire: (type, ev) => listeners.get(type)?.(ev),
    append: (...nodes) => el.children.push(...nodes),
    prepend: (node) => el.children.unshift(node),
    querySelector: () => (el.active ? {} : null),
  };
  return el;
}

// A page: a map frame and two panels (and a block that is no panel) in <main>.
function page({ panels = ["Premiers pas", "Déchets"] } = {}) {
  const doc = fakeDoc();
  const frame = element("div", doc, { w: 300, h: 200 });
  const sections = panels.map((name) => {
    const s = element("section", doc, { classes: ["box"] });
    s.setAttribute("aria-label", name);
    return s;
  });
  const other = element("div", doc, { classes: ["box"] });
  const main = { children: [frame, ...sections, other] };
  frame.parentElement = main;
  const palette = element("nav", doc);
  const elements = { "map-frame": frame, palette };
  const api = { $: (id) => elements[id] ?? null };
  return { api, frame, palette, sections, other, main, doc };
}

// A touch event at client position (x, y): the frame's left and top are at (10, 20).
let nextId = 1;
const touch = (id, x, y) => ({ pointerId: id, pointerType: "touch", clientX: x, clientY: y, stopped: false, stopPropagation() { this.stopped = true; } });
const mouse = (x, y) => ({ pointerId: 99, pointerType: "mouse", clientX: x, clientY: y, stopped: false, stopPropagation() { this.stopped = true; } });

// Two fingers at local (100, 100) and (200, 100), then the second to local (300, 100): a pinch to x2.
function pinchToX2(frame) {
  const a = nextId++;
  const b = nextId++;
  frame.fire("pointerdown", touch(a, 110, 120));
  frame.fire("pointerdown", touch(b, 210, 120));
  frame.fire("pointermove", touch(b, 310, 120));
  frame.fire("pointerup", touch(b, 310, 120));
  frame.fire("pointerup", touch(a, 110, 120));
}

test("setup: each panel gets one heading button named after it; other blocks get none", () => {
  const { api, sections, other } = page();
  setup(api);
  for (const s of sections) {
    const heads = s.children.filter((c) => c.classList.contains("panel-head"));
    assert.equal(heads.length, 1, "one heading");
    assert.equal(heads[0].children[0].textContent, s.getAttribute("aria-label"));
    assert.equal(heads[0].children[0].getAttribute("aria-expanded"), "true", "open by default");
  }
  assert.equal(other.children.length, 0, "a block that is not a panel is left alone");
});

test("a click on a heading folds and opens its panel and sets aria-expanded", () => {
  const { api, sections } = page();
  setup(api);
  const button = sections[0].children[0].children[0];
  assert.equal(sections[0].classList.contains("is-folded"), false, "open by default");
  button.fire("click", {});
  assert.equal(sections[0].classList.contains("is-folded"), true);
  assert.equal(button.getAttribute("aria-expanded"), "false");
  button.fire("click", {});
  assert.equal(sections[0].classList.contains("is-folded"), false);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(sections[1].classList.contains("is-folded"), false, "the other panel is not folded");
});

test("update: a heading rebuilt away by its panel comes back once, and names follow aria-label", () => {
  const { api, sections } = page();
  setup(api);
  sections[0].children = []; // the panel's feature rebuilt its contents
  update();
  update();
  assert.equal(sections[0].children.filter((c) => c.classList.contains("panel-head")).length, 1);
  sections[1].setAttribute("aria-label", "Waste");
  update();
  assert.equal(sections[1].children[0].children[0].textContent, "Waste");
});

test("a pinch zooms the flat map about the midpoint and stops the moves from reaching the tool stroke", () => {
  const { api, frame, palette } = page();
  setup(api);
  palette.active = true; // a tool is selected: the pinch must still zoom
  const a = nextId++;
  const b = nextId++;
  frame.fire("pointerdown", touch(a, 110, 120));
  frame.fire("pointerdown", touch(b, 210, 120));
  const move = touch(b, 310, 120);
  frame.fire("pointermove", move);
  assert.equal(move.stopped, true, "a pinch move does not reach input.js");
  assert.equal(frame.style.vars["--view-s"], "2");
  assert.equal(frame.style.vars["--view-x"], "-100px");
  assert.equal(frame.style.vars["--view-y"], "-100px");
  assert.equal(frame.classList.contains("is-zoomed"), true);
});

test("a single finger with no tool selected pans the zoomed map; the stroke is not stopped", () => {
  const { api, frame } = page();
  setup(api);
  pinchToX2(frame);
  const id = nextId++;
  frame.fire("pointerdown", touch(id, 110, 120));
  const move = touch(id, 140, 110); // local (130, 90): dx 30, dy -10
  frame.fire("pointermove", move);
  assert.equal(move.stopped, false, "one finger: input.js still sees the move (hover)");
  assert.equal(frame.style.vars["--view-x"], "-70px", "-100 + 30");
  assert.equal(frame.style.vars["--view-y"], "-110px", "-100 - 10");
});

test("a single finger with a tool selected does not pan the map (the stroke of input.js draws)", () => {
  const { api, frame, palette } = page();
  setup(api);
  pinchToX2(frame);
  palette.active = true;
  const before = frame.style.vars["--view-x"];
  const id = nextId++;
  frame.fire("pointerdown", touch(id, 110, 120));
  frame.fire("pointermove", touch(id, 150, 150));
  assert.equal(frame.style.vars["--view-x"], before);
});

test("the mouse is never tracked: its moves reach input.js and its drags do not pan", () => {
  const { api, frame } = page();
  setup(api);
  pinchToX2(frame);
  const before = frame.style.vars["--view-x"];
  const m = mouse(150, 150);
  frame.fire("pointerdown", { ...mouse(150, 150) });
  frame.fire("pointermove", m);
  assert.equal(m.stopped, false);
  assert.equal(frame.style.vars["--view-x"], before);
});

test("a third finger is ignored: its moves do not stop or move anything", () => {
  const { api, frame } = page();
  setup(api);
  const a = nextId++;
  const b = nextId++;
  const c = nextId++;
  frame.fire("pointerdown", touch(a, 110, 120));
  frame.fire("pointerdown", touch(b, 210, 120));
  frame.fire("pointerdown", touch(c, 160, 170));
  const move = touch(c, 170, 190);
  frame.fire("pointermove", move);
  assert.equal(move.stopped, false, "an untracked point is not stopped here");
  assert.equal(frame.style.vars["--view-s"], undefined, "no zoom from the third point");
});

test("in the 3D view the touch view does nothing", () => {
  const { api, frame } = page();
  setup(api);
  frame.classList.add("is-3d");
  pinchToX2(frame);
  assert.equal(frame.style.vars["--view-s"], undefined);
  assert.equal(frame.classList.contains("is-zoomed"), false);
});

test("the view is kept inside the frame when the frame shrinks", () => {
  const { api, frame } = page();
  setup(api);
  pinchToX2(frame);
  assert.equal(frame.style.vars["--view-x"], "-100px");
  frame.clientWidth = 50; // the window got narrower: the scaled map covers 100 px, so x >= -50
  update();
  assert.equal(frame.style.vars["--view-x"], "-50px");
});

test("after both fingers lift, one finger moves again without being stopped", () => {
  const { api, frame } = page();
  setup(api);
  pinchToX2(frame);
  const id = nextId++;
  frame.fire("pointerdown", touch(id, 110, 120));
  const move = touch(id, 150, 120);
  frame.fire("pointermove", move);
  assert.equal(move.stopped, false, "one finger again: no stop");
});

test("without a map on the page, setup and update do nothing", () => {
  assert.doesNotThrow(() => setup({ $: () => null }));
  assert.doesNotThrow(() => update());
});
