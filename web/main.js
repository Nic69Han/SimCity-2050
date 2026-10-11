// Presentation adapter (ARCHITECTURE.md, rule 5): draws what the engine
// exposes and forwards user actions. No game rule lives here.
import init, { City } from "./pkg/micropolis_wasm.js";

const SCALE = 6; // canvas pixels per tile
const MONTHS = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
const TICKS_PER_FRAME = { 1: 1, 2: 4, 3: 16 }; // simulation ticks per animation frame

// Tile character ranges (low 10 bits) -> RGB. Ranges come from MapTileCharacters.
const PALETTE = [
  [0, 0, "#8a7a52"], [2, 20, "#2a5fb0"], [21, 43, "#2f7d32"], [44, 47, "#7d6f66"],
  [48, 51, "#4f86d6"], [52, 55, "#b6d53a"], [56, 63, "#ff7a1a"], [64, 206, "#444444"],
  [208, 222, "#d6c200"], [224, 238, "#7a5a3a"], [240, 422, "#3ca84b"], [423, 611, "#2e6fd0"],
  [612, 692, "#d6a82a"], [693, 708, "#27a3b3"], [709, 744, "#9aa3ad"], [745, 760, "#e24b3a"],
  [761, 826, "#8b5fc7"], [827, 1023, "#6b6b7a"], [840, 843, "#5fc46a"],
];
const LOMASK = 0x03ff;
const rgb = new Uint32Array(1024).fill(0xffff00ff); // magenta = tile missing from PALETTE
for (const [lo, hi, c] of PALETTE) {
  const v = parseInt(c.slice(1), 16);
  const abgr = 0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | (v >> 16); // little-endian RGBA
  for (let t = lo; t <= hi; t++) rgb[t] = abgr;
}

const $ = (id) => document.getElementById(id);
const canvas = $("map");
const ctx = canvas.getContext("2d");
const status = $("status");
let city, image, playing = false;

function draw() {
  const w = city.width(), h = city.height(), tiles = city.tiles();
  if (!image || image.width !== w * SCALE) {
    canvas.width = w * SCALE;
    canvas.height = h * SCALE;
    image = ctx.createImageData(w * SCALE, h * SCALE);
  }
  const px = new Uint32Array(image.data.buffer);
  const stride = w * SCALE;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const c = rgb[tiles[x * h + y] & LOMASK];
      const base = y * SCALE * stride + x * SCALE;
      for (let dy = 0; dy < SCALE; dy++) px.fill(c, base + dy * stride, base + dy * stride + SCALE);
    }
  }
  ctx.putImageData(image, 0, 0);
  const [r, c, i] = city.demand();
  status.textContent =
    `${MONTHS[city.month()]} ${city.year()} · ${city.funds().toLocaleString("fr-FR")} $`;
  $("stats").textContent =
    `Population ${city.population().toLocaleString("fr-FR")} · score ${city.score()} · ` +
    `demande R ${r} / C ${c} / I ${i}`;
}

function frame() {
  if (!playing) return;
  const n = TICKS_PER_FRAME[city.speed()] ?? 1;
  for (let k = 0; k < n; k++) city.tick();
  draw();
  requestAnimationFrame(frame);
}

function setPlaying(on) {
  playing = on;
  $("play").textContent = on ? "⏸ Pause" : "▶ Lecture";
  $("play").setAttribute("aria-pressed", String(on));
  if (on) requestAnimationFrame(frame);
}

function load(bytes) {
  try {
    setPlaying(false);
    city.load_cty(bytes);
    city.take_events();
    city.set_speed(Number($("speed").value));
    city.enable_disasters($("disasters").checked);
    draw();
  } catch (e) {
    status.textContent = `Erreur : ${e.message ?? e}`;
  }
}

async function loadSample(name) {
  const r = await fetch(`cities/${name}.cty`);
  if (!r.ok) throw new Error(`${name}.cty: HTTP ${r.status}`);
  load(new Uint8Array(await r.arrayBuffer()));
}

await init();
city = new City(1);
$("city").onchange = (e) => loadSample(e.target.value).catch((err) => (status.textContent = err.message));
$("file").onchange = async (ev) => {
  const f = ev.target.files[0];
  if (f) load(new Uint8Array(await f.arrayBuffer()));
};
$("play").onclick = () => setPlaying(!playing);
$("speed").oninput = (e) => city.set_speed(Number(e.target.value));
$("disasters").onchange = (e) => city.enable_disasters(e.target.checked);
$("save").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([city.save_cty()], { type: "application/octet-stream" }));
  a.download = "city.cty";
  a.click();
  URL.revokeObjectURL(a.href);
};
draw();
loadSample("haight").catch((e) => (status.textContent = e.message));
