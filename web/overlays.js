import { TILE_PX } from "./tools.js";

// Map views (presentation only, ARCHITECTURE.md rule 5): population density, land value, crime,
// pollution, traffic, power grid and fire / police coverage, drawn as a heat layer over the map,
// like the original game's map windows. The engine gives one value per cluster of tiles
// (city.overlay); the page only colours it.
//
// The colour bands are the original's (map.cpp, getCI): below 50 nothing is drawn, then 50..99,
// 100..149, 150..199 and 200 and above. The colours are viridis, which stays readable with the
// common colour-vision deficiencies; each band is also named in the legend text.
//
// Everything above setup() is pure (node:test). setup() and update() touch the page only.

// `kind` is the engine's overlay kind (overlays.rs); `binary` marks a map that only says yes or no.
export const VIEW_MODES = Object.freeze([
  { id: "normal", label: "Normal", kind: null, title: "" },
  { id: "densite", label: "Densité", kind: 0, title: "Densité de population" },
  { id: "valeur", label: "Valeur du terrain", kind: 1, title: "Valeur du terrain" },
  { id: "criminalite", label: "Criminalité", kind: 2, title: "Criminalité" },
  { id: "pollution", label: "Pollution", kind: 3, title: "Pollution" },
  { id: "trafic", label: "Trafic", kind: 4, title: "Densité de trafic" },
  { id: "reseau", label: "Réseau électrique", kind: 5, binary: true, title: "Réseau électrique" },
  { id: "pompiers", label: "Pompiers", kind: 6, title: "Couverture des pompiers" },
  { id: "police", label: "Police", kind: 7, title: "Couverture de la police" },
]);

// Band thresholds of the original (getCI): a value v is in band k when BANDS[k-1] <= v < BANDS[k].
export const BANDS = Object.freeze([50, 100, 150, 200]);

// Band colours: [none, low, medium, high, very high]. "none" is transparent.
export const BAND_COLOURS = Object.freeze([null, "#440154", "#31688e", "#35b779", "#fde725"]);
const BAND_ALPHA = 0.72;

const BAND_NAMES = Object.freeze(["aucune", "faible", "moyenne", "forte", "très forte"]);

// Band of a value (0 = none, 1..4 = the four coloured bands).
export function bandOf(value) {
  let band = 0;
  for (const t of BANDS) if (value >= t) band++;
  return band;
}

// Pixel word (ABGR, little endian) of each band, or 0 for the transparent band.
export function bandWords() {
  return BAND_COLOURS.map((hex) => {
    if (!hex) return 0;
    const v = parseInt(hex.slice(1), 16);
    const r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    const a = Math.round(BAND_ALPHA * 255);
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  });
}

// Fills `out` (a Uint32Array of w*h*S*S pixels, row-major, ABGR) with the heat layer for an
// overlay: `cells` (column-major, `cols` x `rows` clusters of `block` tiles), for a map of w x h
// tiles drawn at `tilePx` pixels per tile. `offset` is added to each value first (the original's
// pollution bands start at 10). Returns the number of tiles that have a colour.
export function paintHeat(out, { cells, cols, rows, block, w, h, tilePx, offset = 0, binary = false }, words = bandWords()) {
  const stride = w * tilePx;
  let coloured = 0;
  out.fill(0);
  for (let x = 0; x < w; x++) {
    const cx = Math.min(cols - 1, Math.floor(x / block));
    for (let y = 0; y < h; y++) {
      const cy = Math.min(rows - 1, Math.floor(y / block));
      const band = binary ? (cells[cx * rows + cy] > 0 ? BAND_COLOURS.length - 1 : 0) : bandOf(cells[cx * rows + cy] + offset);
      const word = words[band];
      if (!word) continue;
      coloured++;
      const base = y * tilePx * stride + x * tilePx;
      for (let dy = 0; dy < tilePx; dy++) out.fill(word, base + dy * stride, base + dy * stride + tilePx);
    }
  }
  return coloured;
}

// The legend of a mode: title and the meaning of each band, as text (the colours are in the bar).
export function legendOf(mode) {
  if (!mode || mode.kind === null) return null;
  const ranges = ["", `${BANDS[0]} à ${BANDS[1] - 1}`, `${BANDS[1]} à ${BANDS[2] - 1}`, `${BANDS[2]} à ${BANDS[3] - 1}`, `${BANDS[3]} et plus`];
  const bands = BAND_COLOURS.map((colour, i) => ({ colour, name: BAND_NAMES[i], range: ranges[i] })).slice(1);
  const power = mode.binary === true;
  return {
    title: mode.title,
    bands: power ? [{ colour: BAND_COLOURS[4], name: "alimenté", range: "" }] : bands,
    note: power ? "Zones non colorées : sans courant." : "Valeurs de la carte : plus la couleur est claire, plus la valeur est forte.",
  };
}

// Mode with the given id, or the normal view.
export function modeById(id) {
  return VIEW_MODES.find((m) => m.id === id) ?? VIEW_MODES[0];
}

// Offset added to an overlay before banding (the original's pollution bands start at 10).
export function offsetOf(mode) {
  return mode.kind === 3 ? 10 : 0;
}

// --- Page -------------------------------------------------------------------------------------

const state = { mode: VIEW_MODES[0], layer: null, api: null, supported: false, image: null };

function setMode(id) {
  state.mode = modeById(id);
  for (const b of document.querySelectorAll("#view-modes button[data-view]")) {
    b.setAttribute("aria-pressed", String(b.dataset.view === state.mode.id));
  }
  renderLegend();
  state.api?.redraw();
}

function renderLegend() {
  const box = document.getElementById("view-legend");
  if (!box) return;
  const legend = legendOf(state.mode);
  box.replaceChildren();
  if (!legend) return;
  const title = document.createElement("span");
  title.className = "view-legend-title";
  title.textContent = legend.title;
  const bar = document.createElement("span");
  bar.className = "view-legend-bands";
  for (const band of legend.bands) {
    const item = document.createElement("span");
    item.className = "view-legend-band";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = band.colour;
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, `${band.name}${band.range ? ` (${band.range})` : ""}`);
    bar.append(item);
  }
  const note = document.createElement("span");
  note.className = "view-legend-note";
  note.textContent = legend.note;
  box.append(title, " ", bar, " ", note);
}

// The selector's layout (style.css is not this module's): a wrapping row, and a visible pressed state.
function injectStyle() {
  if (document.getElementById("view-modes-style")) return;
  const style = document.createElement("style");
  style.id = "view-modes-style";
  style.textContent = `
#view-modes { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
#view-modes .view { font-size: .85rem; padding: .25rem .55rem; }
#view-modes .view[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
.view-legend { display: inline-flex; flex-wrap: wrap; gap: .3rem .6rem; align-items: center; font-size: .85rem; color: var(--muted); }
.view-legend-title { font-weight: 600; color: var(--fg); }
.view-legend-bands { display: inline-flex; flex-wrap: wrap; gap: .2rem .6rem; }
.view-legend-band { display: inline-flex; align-items: center; gap: .3rem; }
.view-legend-note { flex-basis: 100%; }
`;
  document.head.append(style);
}

// Creates the selector (buttons in #view-modes) and the heat layer above the map. Without the
// overlay method of the engine (the mock engine), the selector stays hidden.
export function setup(api) {
  const { city, $ } = api;
  state.api = api;
  const group = $("view-modes");
  if (!group) return;
  state.supported = typeof city()?.overlay === "function" && typeof city()?.overlay_layout === "function";
  group.hidden = !state.supported;
  if (!state.supported) return;
  injectStyle();

  const map = $("map");
  const layer = document.createElement("canvas");
  layer.setAttribute("aria-hidden", "true");
  layer.hidden = true;
  layer.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";
  map.after(layer);
  state.layer = layer;

  for (const mode of VIEW_MODES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "view";
    b.dataset.view = mode.id;
    b.textContent = mode.label;
    b.setAttribute("aria-pressed", String(mode.id === state.mode.id));
    b.onclick = () => setMode(mode.id);
    group.append(b);
  }
  const legend = document.createElement("span");
  legend.id = "view-legend";
  legend.className = "view-legend";
  legend.setAttribute("role", "note");
  group.append(legend);
  renderLegend();
}

// Paints the heat layer for the current mode after each redraw (features run after the map).
export function update(api) {
  const { city } = api;
  const layer = state.layer;
  if (!layer || !state.supported) return;
  const mode = state.mode;
  if (mode.kind === null || !api.isReady()) {
    layer.hidden = true;
    return;
  }
  const engine = city();
  const map = document.getElementById("map");
  const [block, cols, rows] = engine.overlay_layout(mode.kind);
  const cells = engine.overlay(mode.kind);
  const w = engine.width(), h = engine.height();
  if (layer.width !== map.width || layer.height !== map.height) {
    layer.width = map.width;
    layer.height = map.height;
    state.image = null;
  }
  const ctx = layer.getContext("2d");
  if (!state.image) state.image = ctx.createImageData(map.width, map.height);
  const words = new Uint32Array(state.image.data.buffer);
  paintHeat(words, { cells, cols, rows, block, w, h, tilePx: TILE_PX, offset: offsetOf(mode), binary: mode.binary === true });
  ctx.putImageData(state.image, 0, 0);
  layer.hidden = false;
}
