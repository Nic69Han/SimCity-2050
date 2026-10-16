// Game messages: the news ticker of the city (what the engine tells the player: a shortage, a
// fire, a monster, a population milestone...). Presentation only (ARCHITECTURE.md rule 5): the
// engine decides what is sent and where; this module lists it, translates the numbers
// (messages-text.js) and shows the place on the map. No game rule lives here.
//
// setup(api) runs once; update(api) runs after every redraw and drains the engine's messages with
// city.take_messages(). The panel stays hidden when the engine has no take_messages (no feature).
import { MONTHS } from "./status.js";
import { messageText } from "./messages-text.js";

/** Items kept in the ticker (the newest first). */
export const MAX_ITEMS = 30;
/** Numbers per record of take_messages (see crates/micropolis-wasm/src/messages.rs). */
export const RECORD_LEN = 6;
/** Record kinds of take_messages. Only messages make ticker items. */
export const KIND = Object.freeze({ MESSAGE: 1, SOUND: 2, WIN: 3, LOSE: 4, QUAKE: 5, GOTO: 6 });
/** How long the location highlight stays on the map. */
export const FLASH_MS = 3000;
/** Tiles covered by the location highlight, centred on the event (clipped to the map). */
const FLASH_TILES = 3;

const STYLE_ID = "messages-style";
const STYLE = `
.msg-list { list-style: none; margin: .4rem 0 0; padding: 0; max-height: 14rem; overflow-y: auto; font-size: .9rem; }
.msg-item { display: flex; flex-wrap: wrap; gap: .2rem .6rem; align-items: baseline; padding: .3rem 0; border-bottom: 1px solid var(--line); }
.msg-date { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 7rem; }
.msg-text { flex: 1 1 14rem; }
.msg-flag { font-size: .75rem; font-weight: 700; color: var(--on-accent); background: var(--bad); border-radius: 4px; padding: 0 .35rem; }
.msg-important .msg-text { font-weight: 600; }
.msg-locate { font-size: .8rem; padding: .15rem .5rem; }
.msg-empty { color: var(--muted); margin: .4rem 0 0; }
.msg-announce { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.msg-flash { position: absolute; box-sizing: border-box; border: 3px solid var(--bad); border-radius: 50%; pointer-events: none; box-shadow: 0 0 0 2px #0008; }
@media (prefers-reduced-motion: no-preference) {
  .msg-flash { animation: msg-pulse .6s ease-in-out 5 alternate; }
}
@keyframes msg-pulse { from { opacity: 1; } to { opacity: .25; } }
`;

let view = null; // the panel's elements, once setup has found the engine's messages
let ticker = null;

/** Date of the in-game clock, as the status line writes it: "jan 1900". */
export function dateText(month, year) {
  return `${MONTHS[month] ?? "?"} ${year}`;
}

/**
 * The records of take_messages (a flat list of RECORD_LEN numbers each) as objects
 * {kind, a, b, c, d, e}. A truncated last record is ignored.
 */
export function decodeRecords(flat) {
  const values = flat ?? [];
  const out = [];
  for (let o = 0; o + RECORD_LEN <= values.length; o += RECORD_LEN) {
    out.push({
      kind: values[o], a: values[o + 1], b: values[o + 2],
      c: values[o + 3], d: values[o + 4], e: values[o + 5],
    });
  }
  return out;
}

/**
 * A ticker item from a message record (kind MESSAGE): its French text, its place on the map
 * (null when the engine gives none: coordinates -1), and its flags. `date` is the in-game date.
 */
export function messageItem(record, date) {
  const located = record.b >= 0 && record.c >= 0;
  return {
    number: record.a,
    text: messageText(record.a),
    x: located ? record.b : null,
    y: located ? record.c : null,
    picture: record.d === 1,
    important: record.e === 1,
    date,
  };
}

/** The ticker items of a drain, in the order the engine sent them (other kinds are not messages). */
export function itemsOf(records, date) {
  return records.filter((r) => r.kind === KIND.MESSAGE).map((r) => messageItem(r, date));
}

/** The sound events of a drain as {name, x, y} in the order sent; `nameOf(index)` gives the name. */
export function soundEventsOf(records, nameOf) {
  return records
    .filter((r) => r.kind === KIND.SOUND)
    .map((r) => ({ name: nameOf(r.a), x: r.b, y: r.c }));
}

const soundListeners = new Set();

/**
 * Subscribes to the engine's sound events, read in update() with the messages (read-only: the
 * ticker is unchanged). listener({name, x, y}) runs for each event; name is City.sound_name's
 * "channel/sound" ("" when unknown). Returns the function that unsubscribes.
 */
export function onSound(listener) {
  soundListeners.add(listener);
  return () => soundListeners.delete(listener);
}

/**
 * The news ticker: the newest item first, at most `max` items. `add` takes the new items in the
 * order they were sent and returns them, for the announcement.
 */
export function createTicker(max = MAX_ITEMS) {
  let list = [];
  return {
    add(newItems) {
      list = newItems.slice().reverse().concat(list).slice(0, max);
      return newItems;
    },
    items() {
      return list.slice();
    },
  };
}

/**
 * Position of the location highlight, in percent of the map frame: a FLASH_TILES square centred
 * on tile (x, y), clipped to a map of w x h tiles.
 */
export function flashBox(x, y, w, h) {
  const half = Math.floor(FLASH_TILES / 2);
  const x0 = Math.max(0, x - half);
  const y0 = Math.max(0, y - half);
  const x1 = Math.min(w, x + half + 1);
  const y1 = Math.min(h, y + half + 1);
  return {
    left: `${(x0 / w) * 100}%`,
    top: `${(y0 / h) * 100}%`,
    width: `${((x1 - x0) / w) * 100}%`,
    height: `${((y1 - y0) / h) * 100}%`,
  };
}

function el(doc, tag, className = "", text = "") {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function rowFor(doc, item, locate) {
  const li = el(doc, "li", item.important ? "msg-item msg-important" : "msg-item");
  li.append(el(doc, "span", "msg-date", item.date));
  if (item.important) li.append(el(doc, "span", "msg-flag", "Important"));
  li.append(el(doc, "span", "msg-text", item.text));
  if (item.x !== null) {
    const button = el(doc, "button", "msg-locate", "Voir sur la carte");
    button.type = "button";
    button.setAttribute("aria-label", `Voir sur la carte : ${item.text} (${item.x}, ${item.y})`);
    button.addEventListener("click", () => locate(item.x, item.y));
    li.append(button);
  }
  return li;
}

// Builds the panel once: a heading, the empty note, the list, a visually hidden polite live
// region that announces new items, and the location highlight inside the map frame.
function buildView(panel, frame, locate) {
  const doc = panel.ownerDocument;
  if (!doc.getElementById(STYLE_ID)) {
    const style = el(doc, "style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    doc.head.append(style);
  }
  const list = el(doc, "ol", "msg-list");
  list.id = "messages-list";
  list.setAttribute("aria-label", "Derniers messages, du plus récent au plus ancien");
  const empty = el(doc, "p", "msg-empty", "Aucun message pour l'instant.");
  const announce = el(doc, "p", "msg-announce");
  announce.setAttribute("aria-live", "polite");
  const flash = el(doc, "div", "msg-flash");
  flash.setAttribute("aria-hidden", "true");
  flash.hidden = true;
  panel.replaceChildren(el(doc, "h2", "msg-title", "Journal de la ville"), empty, list, announce);
  return { doc, list, empty, announce, frame, flash, flashTimer: null, locate };
}

function render() {
  const items = ticker.items();
  view.list.replaceChildren(...items.map((item) => rowFor(view.doc, item, view.locate)));
  view.list.hidden = items.length === 0;
  view.empty.hidden = items.length > 0;
}

/** Highlights tile (x, y) on the map for FLASH_MS and brings the map frame into view. */
export function flashAt(api, x, y) {
  const frame = api.$("map-frame");
  const city = api.city();
  if (!view || !frame || x < 0 || y < 0) return;
  const { left, top, width, height } = flashBox(x, y, city.width(), city.height());
  const flash = view.flash;
  Object.assign(flash.style, { left, top, width, height });
  if (!flash.isConnected) frame.append(flash);
  flash.hidden = false;
  clearTimeout(view.flashTimer);
  view.flashTimer = setTimeout(() => {
    flash.hidden = true;
  }, FLASH_MS);
  frame.scrollIntoView?.({ block: "nearest" });
}

export function setup(api) {
  const panel = api.$("messages-panel");
  const frame = api.$("map-frame");
  if (!panel || !frame || typeof api.city()?.take_messages !== "function") return;
  ticker = createTicker();
  view = buildView(panel, frame, (x, y) => flashAt(api, x, y));
  view.frame.append(view.flash);
  view.flash.hidden = true;
  panel.hidden = false;
  render();
}

export function update(api) {
  if (!view) return;
  const city = api.city();
  const date = dateText(city.month(), city.year());
  const records = decodeRecords(city.take_messages());
  if (soundListeners.size > 0) {
    const nameOf = (index) => city.constructor.sound_name?.(index) ?? "";
    for (const event of soundEventsOf(records, nameOf)) {
      for (const listener of soundListeners) listener(event);
    }
  }
  const fresh = ticker.add(itemsOf(records, date));
  if (fresh.length === 0) return;
  render();
  view.announce.textContent = fresh.map((item) => `${item.date} : ${item.text}`).join(" ");
}
