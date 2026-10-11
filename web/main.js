// Presentation adapter (ARCHITECTURE.md, rule 5): draws what the engine
// exposes and forwards user actions. No game rule lives here.
import init, { City } from "./pkg/micropolis_wasm.js";

const SCALE = 6; // canvas pixels per tile
const MONTHS = ["jan", "fév", "mar", "avr", "mai", "juin", "juil", "août", "sep", "oct", "nov", "déc"];

// Tile character ranges (low 10 bits) -> colour. Ranges come from MapTileCharacters.
const PALETTE = [
  [0, 0, "#8a7a52"],        // dirt
  [2, 20, "#2a5fb0"],       // water
  [21, 43, "#2f7d32"],      // trees
  [44, 47, "#7d6f66"],      // rubble
  [48, 51, "#4f86d6"],      // flood
  [52, 55, "#b6d53a"],      // radiation
  [56, 63, "#ff7a1a"],      // fire
  [64, 206, "#444"],        // road
  [208, 222, "#d6c200"],    // power lines
  [224, 238, "#7a5a3a"],    // rail
  [240, 422, "#3ca84b"],    // residential & hospital/church
  [423, 611, "#2e6fd0"],    // commercial
  [612, 692, "#d6a82a"],    // industrial
  [693, 708, "#27a3b3"],    // seaport
  [709, 744, "#9aa3ad"],    // airport
  [745, 760, "#e24b3a"],    // power plants
  [761, 826, "#8b5fc7"],    // fire/police stations, stadium, nuclear
  [827, 1023, "#6b6b7a"],   // other zone parts and special tiles
  [840, 843, "#5fc46a"],    // parks and fountains
];
const LOMASK = 0x03ff;

const colourOf = new Array(1024).fill("#ff00ff") // magenta = tile missing from PALETTE;
for (const [lo, hi, c] of PALETTE) for (let t = lo; t <= hi; t++) colourOf[t] = c;

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");
let city;

function draw() {
  const w = city.width(), h = city.height(), tiles = city.tiles();
  canvas.width = w * SCALE;
  canvas.height = h * SCALE;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      ctx.fillStyle = colourOf[tiles[x * h + y] & LOMASK];
      ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
    }
  }
  status.textContent =
    `${MONTHS[city.month()]} ${city.year()} · ${city.funds().toLocaleString("fr-FR")} $`;
}

function load(bytes) {
  try {
    city.load_cty(bytes);
    city.take_events();
    draw();
  } catch (e) {
    status.textContent = `Erreur : ${e.message ?? e}`;
  }
}

async function loadSample() {
  const r = await fetch("cities/haight.cty");
  if (!r.ok) throw new Error(`haight.cty: HTTP ${r.status}`);
  load(new Uint8Array(await r.arrayBuffer()));
}

await init();
city = new City(1);
document.getElementById("sample").onclick = () => loadSample().catch((e) => (status.textContent = e.message));
document.getElementById("file").onchange = async (ev) => {
  const f = ev.target.files[0];
  if (f) load(new Uint8Array(await f.arrayBuffer()));
};
document.getElementById("save").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([city.save_cty()], { type: "application/octet-stream" }));
  a.download = "city.cty";
  a.click();
  URL.revokeObjectURL(a.href);
};
draw();
loadSample().catch((e) => (status.textContent = e.message));
