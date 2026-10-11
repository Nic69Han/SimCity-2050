// Presentation adapter (ARCHITECTURE.md, rule 5): draws what the engine
// exposes and forwards user actions. No game rule lives here.
import { TILE_PX as SCALE, setupTools } from "./tools.js";
import { PALETTE, buildRgbTable, legendEntries } from "./palette.js";
import { parseSeed, supportsNewCity, applyEnginePreferences } from "./newcity.js";

// ?mock=1 uses the dev-only fake engine (web/dev-mock.js); the wasm package is loaded otherwise.
const MOCK = new URLSearchParams(location.search).has("mock");
const { default: init, City } = MOCK ? await import("./dev-mock.js") : await import("./pkg/micropolis_wasm.js");
const MONTHS = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];
const TICKS_PER_FRAME = { 1: 1, 2: 4, 3: 16 }; // simulation ticks per animation frame
const LOMASK = 0x03ff;
const rgb = buildRgbTable(PALETTE); // one ABGR word per tile character, from palette.js

const $ = (id) => document.getElementById(id);
const canvas = $("map");
const ctx = canvas.getContext("2d");
const status = $("status");
let city, image, tools = null, playing = false;
let seedNote = null; // seed of the city made by "Nouvelle ville", shown in the status line

function draw() {
  const w = city.width(), h = city.height(), tiles = city.tiles();
  if (!image || image.width !== w * SCALE) {
    canvas.width = w * SCALE;
    canvas.height = h * SCALE;
    // CSS scales the frame to the viewport at this ratio (style.css); tiles stay exact.
    $("map-frame").style.setProperty("--ratio", `${w} / ${h}`);
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
  // funds are part of every redraw, so the status line shows them after every action
  status.textContent =
    `${seedNote !== null ? `Graine ${seedNote} · ` : ""}` +
    `${MONTHS[city.month()]} ${city.year()} · ${city.funds().toLocaleString("fr-FR")} $`;
  $("stats").textContent =
    `Population ${city.population().toLocaleString("fr-FR")} · score ${city.score()} · ` +
    `demande R ${r} / C ${c} / I ${i}`;
  tools?.render();
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
    seedNote = null;
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

// "Nouvelle ville": stop playback, ask the engine for a city from the seed, keep the
// page's speed and disasters options, show the seed so it can be noted and reused.
function newCity() {
  const seedInput = $("seed");
  const parsed = parseSeed(seedInput.value);
  if (parsed.error) {
    $("new-msg").textContent = parsed.error;
    seedInput.setAttribute("aria-invalid", "true");
    return;
  }
  $("new-msg").textContent = "";
  seedInput.removeAttribute("aria-invalid");
  setPlaying(false);
  city.new_random_city(parsed.seed);
  // the engine resets its speed and disasters on a new city: push the page's options again
  applyEnginePreferences(city, { speed: $("speed").value, disasters: $("disasters").checked });
  seedNote = parsed.seed;
  seedInput.value = String(parsed.seed);
  $("query-panel").hidden = true;
  draw();
}

function buildLegend(list) {
  for (const { label, color } of legendEntries(PALETTE)) {
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = color;
    swatch.setAttribute("aria-hidden", "true");
    li.append(swatch, label);
    list.append(li);
  }
}

await init();
city = new City(1);
buildLegend($("legend"));
tools = setupTools({
  city,
  canvas,
  overlay: $("overlay"),
  palette: $("palette"),
  message: $("tool-msg"),
  queryPanel: $("query-panel"),
  help: $("shortcuts"),
  onChange: draw,
});
const hasNewCity = supportsNewCity(city);
$("newcity").hidden = !hasNewCity;
$("newcity-btn").onclick = newCity;
$("seed").onkeydown = (e) => {
  if (e.key === "Enter") newCity();
};
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
if (MOCK) load(new Uint8Array(0));
else loadSample("haight").catch((e) => (status.textContent = e.message));
