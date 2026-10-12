// Saved games (#saves-panel, #resume-banner, the "Parties" button). Presentation only
// (ARCHITECTURE.md rule 5): the bytes come from the engine (save_city / save_cty) and go back
// to it (load_city / load_cty) through main.js; the page only keeps them in IndexedDB (storage.js).
// The page keeps no game state: a save is a copy of the engine's file, and a load is the same
// path as opening a file.
//
// Slots: one autosave (written every AUTOSAVE_MS while a city exists and something changed, on
// page hide, and after a city is loaded or made) and three manual slots. At startup, an autosave
// that exists is offered in a banner ("Reprendre la partie"); the sample city keeps loading.
//
// Exports: pure helpers and createAutosaver / createPrefs (unit-tested with a fake clock), and
// setup(api) / update(api) / start() / cityLoaded() for main.js (api: see main.js featureApi).
import { MONTHS } from "./status.js";
import { isSaveable } from "./sizes.js";
import { openStorage, checkRecord, StorageError } from "./storage.js";
import { engineErrorText, storageErrorText } from "./errors.js";

export const AUTOSAVE_MS = 60000;
export const AUTOSAVE_ID = "auto";
export const SLOT_IDS = Object.freeze(["slot-1", "slot-2", "slot-3"]);
export const NAME_MAX = 60;
export const THUMB_WIDTH = 120;
export const PREFS_KEY = "micropolis.prefs";
export const SPEEDS = Object.freeze([1, 2, 3]);

// ---- pure helpers ----------------------------------------------------------------------------

/**
 * A cheap digest of a file's bytes (two 32-bit hashes and the length), as text. Equal bytes give
 * equal digests; the autosave skips a write when the digest is the one it last wrote.
 */
export function digestBytes(bytes) {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    a = Math.imul(a ^ v, 0x01000193) >>> 0;
    b = Math.imul(b ^ v, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return `${bytes.length}:${a.toString(16)}:${b.toString(16)}`;
}

/** The game date as the status line writes it: "jan 1900". */
export function gameDate(meta) {
  return `${MONTHS[meta.month] ?? "?"} ${meta.year}`;
}

/** The name a new save gets when none is typed: "Ville jan 1900". */
export function defaultName(meta) {
  return `Ville ${gameDate(meta)}`;
}

/** The name typed by the player, cleaned: blanks collapsed, at most NAME_MAX characters; empty -> default. */
export function cleanName(text, meta) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  return s === "" ? defaultName(meta) : s;
}

/** "12 oct. 2026, 14:03" (fr-FR). `timeZone` is for tests; the default is the reader's. */
export function formatSavedAt(ms, timeZone = undefined) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone,
  }).format(new Date(ms));
}

/** "jan 1900 · 20 000 $ · 1 234 habitants · 120 × 100". */
export function formatMeta(meta) {
  const money = `${Number(meta.funds).toLocaleString("fr-FR")} $`;
  const pop = `${Number(meta.population).toLocaleString("fr-FR")} habitants`;
  return [gameDate(meta), money, pop, `${meta.width} × ${meta.height}`].join(" · ");
}

/** The line of the banner: "Haight-Ashbury · jan 1905 · 1 200 habitants · sauvegardée le 12 oct. 2026, 14:03". */
export function resumeText(record, timeZone = undefined) {
  const m = record.meta;
  return `${record.name} · ${gameDate(m)} · ${Number(m.population).toLocaleString("fr-FR")} habitants · ` +
    `sauvegardée le ${formatSavedAt(record.savedAt, timeZone)}`;
}

/** Width x height of a thumbnail `target` pixels wide, keeping the map's proportions. */
export function thumbnailSize(width, height, target = THUMB_WIDTH) {
  if (!(width > 0) || !(height > 0)) return { width: target, height: target };
  return { width: target, height: Math.max(1, Math.round((target * height) / width)) };
}

/** The meta data kept with a save, from the engine's numbers. */
export function metaOf(city) {
  return {
    year: city.year(),
    month: city.month(),
    funds: city.funds(),
    population: city.population(),
    width: city.width(),
    height: city.height(),
  };
}

/**
 * A record as the page writes it. `thumbnail` is a data URL or null. The record is checked
 * by storage.js (checkRecord) when it is written.
 */
export function buildRecord({ id, name, bytes, meta, thumbnail = null, savedAt = Date.now() }) {
  return { id, name, savedAt, meta, thumbnail, bytes };
}

/** Engine calls: a save is `save_city` when the engine has it, else the 120 x 100 `save_checked` / `save_cty`. */
export function canSaveBytes(city) {
  return typeof city?.save_city === "function" || isSaveable(city);
}

export function saveBytes(city) {
  if (typeof city.save_city === "function") return city.save_city();
  if (typeof city.save_checked === "function") return city.save_checked();
  return city.save_cty();
}

/** Loads the bytes of a file or a save into the engine. Throws the engine's error. */
export function loadBytes(city, bytes) {
  if (typeof city.load_city === "function") return city.load_city(bytes);
  return city.load_cty(bytes);
}

// ---- the autosave: scheduling and the digest skip --------------------------------------------

/**
 * The autosave logic, without the DOM or the storage (tests drive it with a fake clock).
 *   snapshot()      -> { bytes } of the city now, or null (no city / not saveable)
 *   write(bytes)    -> Promise: stores the save (rejects with a StorageError)
 *   schedule(fn, ms) / cancel(handle)  the timer (setInterval by default)
 *   onStatus(s)     -> { state: "saved" | "error", reason, error?, savedAt? }
 * Writes are serialised. A flush whose digest equals the last written one does not write.
 * A flush returns a promise of "idle" (not armed), "skipped" (no city), "same" (nothing
 * changed), "saved" or "error". It never rejects.
 */
export function createAutosaver({
  snapshot,
  write,
  schedule = (fn, ms) => setInterval(fn, ms),
  cancel = (h) => clearInterval(h),
  interval = AUTOSAVE_MS,
  onStatus = () => {},
  now = () => Date.now(),
}) {
  let handle = null;
  let armed = false;
  let baseline = null; // digest of the last bytes written (or the bytes the page took as saved)
  let chain = Promise.resolve();

  async function run(reason) {
    if (!armed) return "idle";
    const snap = snapshot();
    if (!snap) return "skipped";
    const digest = digestBytes(snap.bytes);
    if (digest === baseline) return "same";
    try {
      await write(snap.bytes, reason);
    } catch (error) {
      onStatus({ state: "error", reason, error });
      return "error";
    }
    baseline = digest;
    onStatus({ state: "saved", reason, savedAt: now() });
    return "saved";
  }

  function flush(reason = "manual") {
    const next = chain.then(() => run(reason));
    chain = next.catch(() => {});
    return next;
  }

  return {
    flush,
    start() {
      if (handle === null) handle = schedule(() => flush("timer"), interval);
    },
    stop() {
      if (handle !== null) cancel(handle);
      handle = null;
    },
    arm(on) {
      armed = Boolean(on);
    },
    isArmed: () => armed,
    /** The bytes are the saved state now (no write): the next flush compares with them. */
    markSaved(bytes) {
      baseline = digestBytes(bytes);
    },
    /** Takes the city as the saved state now, without writing it. False when there is no city. */
    syncBaseline() {
      const snap = snapshot();
      if (!snap) return false;
      baseline = digestBytes(snap.bytes);
      return true;
    },
    get baseline() {
      return baseline;
    },
  };
}

// ---- page preferences (localStorage, per viewer) ---------------------------------------------

function defaultStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage: the page works with its defaults
  }
}

/** The preferences that are kept, checked: unknown or malformed values are dropped. */
export function sanitizePrefs(raw, { tools = null, views = null } = {}) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  if (SPEEDS.includes(raw.speed)) out.speed = raw.speed;
  if (typeof raw.disasters === "boolean") out.disasters = raw.disasters;
  if (typeof raw.view === "string" && (views === null || views.includes(raw.view))) out.view = raw.view;
  if (typeof raw.tool === "string" && (tools === null || tools.includes(raw.tool))) out.tool = raw.tool;
  return out;
}

/** Reads and writes the preferences object under `key`. Every access is guarded. */
export function createPrefs(store = defaultStore(), key = PREFS_KEY) {
  const read = () => {
    try {
      const text = store?.getItem(key);
      const parsed = text ? JSON.parse(text) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  return {
    read,
    write(patch) {
      try {
        store?.setItem(key, JSON.stringify({ ...read(), ...patch }));
        return true;
      } catch {
        return false; // quota or blocked storage: the preference simply is not kept
      }
    },
  };
}

// ---- the page: panel, banner, startup ---------------------------------------------------------

const STYLE = `
#saves-panel h2 { margin: .2rem 0 .4rem; font-size: 1.05rem; }
#saves-panel h3 { margin: .7rem 0 .3rem; font-size: .95rem; }
#saves-panel .saves-note, #saves-panel .saves-hint { color: var(--muted); font-size: .9rem; margin: .3rem 0; }
#saves-panel #saves-msg { min-height: 1.3em; margin: .4rem 0 0; font-weight: 600; color: var(--fg); }
#saves-panel #saves-msg:empty { min-height: 0; }
#saves-panel #saves-msg.is-error { color: var(--bad); }
.save-row, .save-slot { display: grid; grid-template-columns: 120px 1fr; gap: .4rem .75rem; align-items: start; padding: .5rem 0; border-bottom: 1px solid var(--line); }
.save-slots { list-style: none; margin: 0; padding: 0; }
.save-thumb { width: 120px; height: auto; display: block; border: 1px solid var(--line); border-radius: 4px; background: #000; image-rendering: pixelated; }
.save-thumb-empty { width: 120px; min-height: 60px; display: grid; place-items: center; border: 1px dashed var(--line); border-radius: 4px; color: var(--muted); font-size: .8rem; }
.save-info { min-width: 0; }
.save-name { font-weight: 600; overflow-wrap: anywhere; }
.save-details { color: var(--muted); font-size: .85rem; margin: .15rem 0; font-variant-numeric: tabular-nums; }
.save-bad { color: var(--bad); font-weight: 600; font-size: .9rem; }
.save-controls { display: flex; flex-wrap: wrap; gap: .4rem; align-items: end; margin-top: .4rem; }
.save-controls label { display: grid; gap: .15rem; font-size: .8rem; color: var(--muted); }
.save-controls input[type=text] { max-width: none; width: min(16rem, 100%); }
.save-controls button { font-size: .9rem; padding: .3rem .6rem; }
.save-confirm { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; margin-top: .4rem; font-size: .9rem; }
.save-confirm[hidden], .save-actions[hidden] { display: none; }
.save-danger { border-color: var(--bad); color: var(--bad); }
.save-danger:hover { background: var(--bad); color: var(--on-accent); }
#resume-banner { display: flex; flex-wrap: wrap; gap: .5rem .9rem; align-items: center; margin-top: .75rem; padding: .5rem .75rem; background: var(--panel); border-left: 4px solid var(--accent); border-radius: 6px; }
#resume-banner .resume-text { flex: 1 1 18rem; margin: 0; }
#resume-banner .resume-msg { flex-basis: 100%; margin: 0; color: var(--bad); font-weight: 600; font-size: .9rem; }
#resume-banner .resume-msg:empty { display: none; }
#resume-banner .resume-actions { display: flex; gap: .4rem; }
@media (max-width: 480px) {
  .save-row, .save-slot { grid-template-columns: 1fr; }
  .save-thumb, .save-thumb-empty { width: min(120px, 100%); }
  .save-controls button { flex: 1 1 auto; }
}
`;

let api = null;
let els = null; // element references, once setup has built the panel
let storage = null; // the storage port, once start() has opened it
let storageState = "opening"; // "opening" | "ready" | "unavailable"
let storageError = null;
let autosaver = null;
let slots = new Map(); // id -> record summary, or { id, corrupt: true }
let pending = false; // the resume question is open (the banner shows)
let userResolved = false; // the player has loaded a city or answered the question
let currentName = null; // the name of the save the city came from (null: the city's own label)
let prefs = createPrefs(defaultStore());

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (k === "hidden") node.hidden = Boolean(v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function injectStyle() {
  if (document.getElementById("saves-style")) return;
  const style = el("style", { id: "saves-style" });
  style.textContent = STYLE;
  document.head.append(style);
}

function say(text, isError = false) {
  if (!els) return;
  els.msg.textContent = text;
  els.msg.classList.toggle("is-error", isError && text !== "");
}

function limits() {
  return api?.limits?.() ?? undefined;
}

// The city as the engine holds it now: { bytes, meta }, or { error } when it has no city or
// cannot be saved (a 120 x 100 check on an engine without save_city).
function snapshotNow() {
  if (!api || !api.isReady()) return { error: "Aucune ville à enregistrer." };
  const city = api.city();
  if (!canSaveBytes(city)) return { error: engineErrorText({ message: "size_not_saveable" }) };
  return { bytes: saveBytes(city), meta: metaOf(city) };
}

// The name of the city as it is now: the save it came from, or the city's own label, with its seed.
function cityName() {
  if (currentName) return currentName;
  const d = api?.describe?.() ?? { label: "Ville", seed: null };
  return d.seed !== null && d.seed !== undefined ? `${d.label} · graine ${d.seed}` : d.label;
}

function captureThumbnail() {
  try {
    const map = api?.$("map");
    if (!map || !map.width || !map.height) return null;
    const { width, height } = thumbnailSize(map.width, map.height);
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d").drawImage(map, 0, 0, width, height);
    return c.toDataURL("image/png");
  } catch {
    return null; // no thumbnail: the save still works
  }
}

function summaryOf(record) {
  return { id: record.id, name: record.name, savedAt: record.savedAt, meta: record.meta, thumbnail: record.thumbnail, size: record.bytes.length };
}

// ---- rendering --------------------------------------------------------------------------------

function thumbNode(record) {
  if (record?.thumbnail) return el("img", { class: "save-thumb", src: record.thumbnail, alt: "", width: "120" });
  return el("div", { class: "save-thumb-empty", "aria-hidden": "true", text: record ? "Pas d'aperçu" : "Vide" });
}

function renderNote() {
  if (!els) return;
  const note = els.note;
  if (storageState === "opening") note.textContent = "Ouverture du stockage…";
  else if (storageState === "unavailable") {
    note.textContent = `${storageErrorText(storageError ?? { code: "unavailable" })} Les fichiers de ville restent disponibles : Enregistrer et Ouvrir un fichier.`;
  } else {
    note.textContent = "Les parties sont gardées dans ce navigateur. Un fichier .cty reste possible à côté.";
  }
  const usable = storageState === "ready";
  els.autoSection.hidden = !usable;
  els.slotsSection.hidden = !usable;
}

function renderAuto() {
  if (!els) return;
  const rec = slots.get(AUTOSAVE_ID);
  els.autoBox.replaceChildren();
  if (storageState !== "ready") return;
  if (!rec) {
    els.autoBox.append(el("p", { class: "saves-note", text: "Pas encore de sauvegarde automatique." }));
    return;
  }
  if (rec.corrupt) {
    els.autoBox.append(el("p", { class: "save-bad", text: storageErrorText({ code: "corrupt" }) }));
    return;
  }
  const loadBtn = el("button", { type: "button", "data-act": "load-auto", text: "Charger" });
  loadBtn.addEventListener("click", () => loadSlot(AUTOSAVE_ID));
  els.autoBox.append(el("div", { class: "save-row" }, [
    thumbNode(rec),
    el("div", { class: "save-info" }, [
      el("div", { class: "save-name", text: rec.name }),
      el("div", { class: "save-details", text: formatMeta(rec.meta) }),
      el("div", { class: "save-details", text: `Sauvegardée le ${formatSavedAt(rec.savedAt)}` }),
      el("div", { class: "save-controls" }, [loadBtn]),
    ]),
  ]));
}

// One manual slot: its row is built once and updated in place, so the name box keeps what is typed.
function buildSlot(id, n) {
  const nameId = `saves-name-${n}`;
  const name = el("input", { type: "text", id: nameId, maxlength: String(NAME_MAX), autocomplete: "off" });
  const thumb = el("div", { class: "save-thumb-holder" });
  const info = el("div", { class: "save-info" });
  const actions = el("div", { class: "save-controls save-actions" });
  const confirm = el("div", { class: "save-confirm", hidden: true });
  const slot = { id, n, name, thumb, info, actions, confirm, buttons: {} };
  const li = el("li", { class: "save-slot", id: `saves-slot-${n}` }, [
    thumb,
    el("div", { class: "save-info" }, [
      info,
      el("div", { class: "save-controls" }, [el("label", { for: nameId, text: "Nom de la partie" }), name]),
      actions,
      confirm,
    ]),
  ]);
  slot.li = li;
  const button = (act, text, handler, { danger = false, needsCity = false } = {}) => {
    const attrs = { type: "button", "data-act": act, text };
    if (danger) attrs.class = "save-danger";
    if (needsCity) attrs["data-needs-city"] = "";
    const b = el("button", attrs);
    b.addEventListener("click", handler);
    actions.append(b);
    return b;
  };
  // Replacing and deleting ask first: one click cannot lose a save.
  const ask = (text, yesText, handler, danger = false) => {
    const yes = el("button", { type: "button", "data-act": "confirm", text: yesText, ...(danger ? { class: "save-danger" } : {}) });
    const no = el("button", { type: "button", "data-act": "cancel", text: "Annuler" });
    yes.addEventListener("click", () => {
      hideConfirm(slot);
      handler();
    });
    no.addEventListener("click", () => hideConfirm(slot));
    confirm.replaceChildren(el("span", { text }), yes, no);
    showConfirm(slot);
  };
  slot.buttons = {
    save: button("save", "Enregistrer ici", () => saveSlot(id, name.value), { needsCity: true }),
    replace: button("replace", "Remplacer", () => ask(`Remplacer la partie de l'emplacement ${n} ?`, "Remplacer", () => saveSlot(id, name.value)), { needsCity: true }),
    load: button("load", "Charger", () => loadSlot(id)),
    rename: button("rename", "Renommer", () => renameSlot(id, name.value)),
    delete: button("delete", "Supprimer", () => ask(`Supprimer l'emplacement ${n} ?`, "Supprimer", () => deleteSlot(id), true), { danger: true }),
  };
  return slot;
}

function showConfirm(slot) {
  slot.actions.hidden = true;
  slot.confirm.hidden = false;
  slot.confirm.querySelector("button")?.focus();
}

function hideConfirm(slot) {
  slot.confirm.hidden = true;
  slot.actions.hidden = false;
}

function renderSlot(slot) {
  const rec = slots.get(slot.id);
  const b = slot.buttons;
  const ready = api?.isReady() ?? false;
  const typing = document.activeElement === slot.name;
  const shown = rec && !rec.corrupt ? rec : null;
  slot.thumb.replaceChildren(thumbNode(shown));
  const show = (act, on) => setHidden(b[act], !on);
  if (!rec) {
    slot.info.replaceChildren(el("div", { class: "save-name", text: `Emplacement ${slot.n}` }),
      el("div", { class: "save-details", text: "Vide" }));
    if (!typing) slot.name.value = ready ? defaultName(metaOf(api.city())) : "";
    show("save", true); show("replace", false); show("load", false); show("rename", false); show("delete", false);
    return;
  }
  if (rec.corrupt) {
    slot.info.replaceChildren(el("div", { class: "save-name", text: `Emplacement ${slot.n}` }),
      el("p", { class: "save-bad", text: storageErrorText({ code: "corrupt" }) }));
    show("save", false); show("replace", false); show("load", false); show("rename", false); show("delete", true);
    return;
  }
  slot.info.replaceChildren(
    el("div", { class: "save-name", text: rec.name }),
    el("div", { class: "save-details", text: formatMeta(rec.meta) }),
    el("div", { class: "save-details", text: `Enregistrée le ${formatSavedAt(rec.savedAt)}` }),
  );
  if (!typing) slot.name.value = rec.name;
  show("save", false); show("replace", true); show("load", true); show("rename", true); show("delete", true);
}

function setHidden(node, on) {
  node.hidden = Boolean(on);
}

function renderSlots() {
  for (const slot of els.slotRows) renderSlot(slot);
}

function renderAll() {
  renderNote();
  renderAuto();
  renderSlots();
  refreshNeedsCity();
}

// Buttons that need a city are disabled until the engine has one (cheap: runs after every redraw).
function refreshNeedsCity() {
  if (!els) return;
  const ready = api?.isReady() ?? false;
  for (const b of els.panel.querySelectorAll("[data-needs-city]")) {
    if (b.disabled !== !ready) b.disabled = !ready;
  }
}

// ---- storage actions (every one catches its errors and says them in French) -------------

async function refresh() {
  try {
    const list = await storage.list();
    slots = new Map(list.map((e) => [e.id, e]));
  } catch (e) {
    say(storageErrorText(e), true);
  }
  renderAll();
}

async function saveSlot(id, text) {
  const n = SLOT_IDS.indexOf(id) + 1;
  if (storageState !== "ready") return say(storageErrorText({ code: "unavailable" }), true);
  const snap = snapshotNow();
  if (snap.error) return say(snap.error, true);
  const name = cleanName(text, snap.meta);
  try {
    await storage.put(buildRecord({ id, name, bytes: snap.bytes, meta: snap.meta, thumbnail: captureThumbnail() }));
  } catch (e) {
    return say(storageErrorText(e), true);
  }
  currentName = name;
  await refresh();
  say(`Partie « ${name} » enregistrée dans l'emplacement ${n}.`);
}

async function renameSlot(id, text) {
  const n = SLOT_IDS.indexOf(id) + 1;
  const name = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
  if (name === "") return say("Donnez un nom à la partie.", true);
  try {
    const rec = await storage.get(id);
    if (!rec) return say("Cet emplacement est vide.", true);
    await storage.put({ ...rec, name });
  } catch (e) {
    return say(storageErrorText(e), true);
  }
  await refresh();
  say(`Emplacement ${n} renommé : « ${name} ».`);
}

async function deleteSlot(id) {
  const n = SLOT_IDS.indexOf(id) + 1;
  try {
    await storage.remove(id);
  } catch (e) {
    return say(storageErrorText(e), true);
  }
  await refresh();
  say(`Emplacement ${n} vidé.`);
}

// Loads a save into the engine through main.js (the same path as a file). The save is then the
// city the autosave follows.
async function loadSlot(id) {
  if (storageState !== "ready") return say(storageErrorText({ code: "unavailable" }), true);
  let rec;
  try {
    rec = await storage.get(id);
  } catch (e) {
    return say(storageErrorText(e), true);
  }
  if (!rec) return say("Cet emplacement est vide.", true);
  const error = api.replaceCity(rec.bytes);
  if (error) return say(engineErrorText(error, limits()), true);
  cityLoaded({ user: true, name: rec.name });
  say(`Partie « ${rec.name} » chargée.`);
  return undefined;
}

// ---- the resume banner --------------------------------------------------------------------

function showBanner(rec) {
  if (!els) return;
  els.bannerText.textContent = resumeText(rec);
  els.bannerMsg.textContent = "";
  els.banner.hidden = false; // no focus move: the banner waits for the player
}

function hideBanner() {
  if (els) els.banner.hidden = true;
}

async function resume() {
  let rec;
  try {
    rec = await storage.get(AUTOSAVE_ID);
  } catch (e) {
    els.bannerMsg.textContent = storageErrorText(e);
    return;
  }
  if (!rec) {
    pending = false;
    hideBanner();
    syncArm();
    return;
  }
  const error = api.replaceCity(rec.bytes);
  if (error) {
    els.bannerMsg.textContent = engineErrorText(error, limits());
    return;
  }
  pending = false;
  hideBanner();
  cityLoaded({ user: true, write: false, name: rec.name });
  say(`Partie « ${rec.name} » reprise.`);
}

function ignoreBanner() {
  pending = false;
  userResolved = true;
  hideBanner();
  autosaver?.syncBaseline(); // the sample is the state now: the old autosave stays until the city changes
  syncArm();
}

// ---- the autosave wiring -------------------------------------------------------------------

// Writes are allowed once the storage is open and no resume question is open.
function syncArm() {
  autosaver?.arm(storageState === "ready" && !pending);
}

async function writeAuto(bytes) {
  if (!storage) throw new StorageError("unavailable", "no storage");
  const city = api.city();
  const record = buildRecord({
    id: AUTOSAVE_ID, name: cityName(), bytes, meta: metaOf(city), thumbnail: captureThumbnail(),
  });
  await storage.put(record);
  slots.set(AUTOSAVE_ID, summaryOf(checkRecord(record)));
}

function onAutosaveStatus(s) {
  if (!els) return;
  if (s.state === "saved") {
    const at = formatSavedAt(s.savedAt);
    els.note.textContent = `Sauvegarde automatique à ${at}.`;
    renderAuto();
    if (els.msg.classList.contains("is-error")) say("");
  } else if (s.state === "error") {
    say(storageErrorText(s.error), true);
  }
}

// ---- public: setup, update, start, cityLoaded ------------------------------------------------

/**
 * Builds the panel and the banner, wires the Parties button and the preferences. No storage is
 * opened here (start does that). main.js calls it once, before the palette exists.
 */
export function setup(theApi) {
  api = theApi;
  const panel = api.$("saves-panel");
  const banner = api.$("resume-banner");
  const toggle = api.$("saves-toggle");
  if (!panel || !banner || !toggle) return;
  injectStyle();

  // preferences that are inputs: restored now, so the first load of the engine uses them
  const saved = prefs.read();
  const speed = api.$("speed");
  const disasters = api.$("disasters");
  if (saved.speed !== undefined && speed) speed.value = String(saved.speed);
  if (saved.disasters !== undefined && disasters) disasters.checked = saved.disasters;
  speed?.addEventListener("input", () => prefs.write({ speed: Number(speed.value) }));
  disasters?.addEventListener("change", () => prefs.write({ disasters: disasters.checked }));

  // selected tool and view mode: kept when their button is pressed (any way: click or key)
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const b = r.target;
      if (b.getAttribute("aria-pressed") !== "true") continue;
      if (b.matches("#palette button.tool[data-tool]")) prefs.write({ tool: b.dataset.tool });
      else if (b.matches("#view-modes button[data-view]")) prefs.write({ view: b.dataset.view });
    }
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });

  const note = el("p", { id: "saves-note", class: "saves-note", role: "status" });
  const autoBox = el("div", { id: "saves-auto" });
  const autoSection = el("section", { "aria-labelledby": "saves-h-auto" }, [
    el("h3", { id: "saves-h-auto", text: "Sauvegarde automatique" }),
    autoBox,
  ]);
  const slotRows = SLOT_IDS.map((id, i) => buildSlot(id, i + 1));
  const slotsSection = el("section", { "aria-labelledby": "saves-h-slots" }, [
    el("h3", { id: "saves-h-slots", text: "Emplacements" }),
    el("ol", { class: "save-slots", id: "saves-slots" }, slotRows.map((s) => s.li)),
  ]);
  const msg = el("p", { id: "saves-msg", role: "status", "aria-live": "polite" });
  panel.replaceChildren(
    el("h2", { id: "saves-h", text: "Parties sauvegardées" }),
    note,
    autoSection,
    slotsSection,
    msg,
    el("p", { class: "saves-hint", text: "Pour un fichier de ville (.cty ou .mcty), utilisez Enregistrer et Ouvrir un fichier dans l'en-tête." }),
  );

  // the banner: a question that does not block the page
  const bannerText = el("p", { class: "resume-text" });
  const bannerMsg = el("p", { class: "resume-msg", role: "status" });
  const resumeBtn = el("button", { type: "button", "data-act": "resume", text: "Reprendre" });
  const ignoreBtn = el("button", { type: "button", "data-act": "ignore", text: "Ignorer" });
  resumeBtn.addEventListener("click", () => resume());
  ignoreBtn.addEventListener("click", () => ignoreBanner());
  banner.replaceChildren(
    el("p", { class: "resume-title" }, [el("strong", { text: "Reprendre la partie" })]),
    bannerText,
    el("div", { class: "resume-actions" }, [resumeBtn, ignoreBtn]),
    bannerMsg,
  );
  banner.hidden = true;

  els = {
    panel, note, msg, autoBox, autoSection, slotsSection, slotRows, banner, bannerText, bannerMsg,
  };

  toggle.setAttribute("aria-controls", "saves-panel");
  toggle.setAttribute("aria-expanded", "false");
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) renderAll();
  });
  panel.hidden = true;

  autosaver = createAutosaver({
    snapshot: snapshotNow,
    write: writeAuto,
    onStatus: onAutosaveStatus,
  });
  // The page keeps no game state; this only lets the tests write the autosave now (documented in web/test/README.md).
  globalThis.__saves = { flush: () => autosaver.flush("dev") };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") autosaver.flush("hidden");
  });
  window.addEventListener("pagehide", () => {
    autosaver.flush("pagehide");
  });
  renderNote();
  renderAuto();
  refreshNeedsCity();
}

/** Called after every redraw: the buttons that need a city follow the engine. */
export function update() {
  refreshNeedsCity();
}

/**
 * Startup, after the sample city has loaded (main.js): restores the palette tool and view mode,
 * opens the storage, reads the slots, offers the autosave when there is one, and starts the timer.
 */
export async function start() {
  if (!els) return;
  restoreButtons();
  storageState = "opening";
  renderNote();
  const opened = await openStorage();
  if (!opened.available) {
    storageState = "unavailable";
    storageError = opened.error;
    renderAll();
    syncArm();
    return;
  }
  storage = opened.storage;
  storageState = "ready";
  await refresh();
  const auto = slots.get(AUTOSAVE_ID);
  if (!userResolved && auto && !auto.corrupt) {
    try {
      const rec = await storage.get(AUTOSAVE_ID);
      if (rec) {
        pending = true;
        showBanner(rec);
      }
    } catch {
      // unreadable: no question; the next write replaces it
    }
  }
  syncArm();
  autosaver.start();
  if (autosaver.isArmed()) autosaver.flush("start");
}

/**
 * main.js calls this after a city is in the engine. `user` is true for a choice of the player
 * (a sample from the selector, a file, a new city, a save); false for the startup sample.
 * `write: false` takes the city as saved without writing it (a resumed save).
 */
export function cityLoaded({ user = false, write = true, name = null } = {}) {
  if (!autosaver) return;
  if (user) {
    userResolved = true;
    pending = false;
    currentName = name;
    hideBanner();
  }
  if (pending) return; // the question is still open: nothing is written before the answer
  if (!write) {
    autosaver.syncBaseline();
    syncArm();
    return;
  }
  syncArm();
  if (autosaver.isArmed()) autosaver.flush(user ? "load" : "start");
}

/** Restores the palette tool and the view mode (their buttons exist once the page is built). */
function restoreButtons() {
  const saved = sanitizePrefs(prefs.read(), {
    tools: [...document.querySelectorAll("#palette button.tool[data-tool]")].map((b) => b.dataset.tool),
    views: [...document.querySelectorAll("#view-modes button[data-view]")].map((b) => b.dataset.view),
  });
  if (saved.view) document.querySelector(`#view-modes button[data-view="${saved.view}"]`)?.click();
  if (saved.tool) document.querySelector(`#palette button.tool[data-tool="${saved.tool}"]`)?.click();
}
