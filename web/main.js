// Presentation adapter (ARCHITECTURE.md rule 5): draws what the engine
// exposes and forwards user actions. No game rule lives here.
import { TILE_PX as SCALE, setupTools } from "./tools.js";
import { PALETTE, legendEntries } from "./palette.js";
import { createRenderer } from "./render.js";
import * as messages from "./messages.js";
import * as budgetUi from "./budget-ui.js";
import * as overlays from "./overlays.js";
import { parseSeed, supportsNewCity, applyEnginePreferences } from "./newcity.js";
import { ticksPerFrame, createPlayback } from "./playback.js";
import { createLatest } from "./latest.js";
import { formatStatus, formatStats, formatLoadError, LOADING_TEXT, NO_CITY_TEXT } from "./status.js";

// ?mock=1 uses the dev-only fake engine (web/dev-mock.js); the wasm package is loaded otherwise.
const MOCK = new URLSearchParams(location.search).has("mock");
const { default: init, City } = MOCK ? await import("./dev-mock.js") : await import("./pkg/micropolis_wasm.js");
// Selector entries for a city that is not a sample (added while shown, removed by a sample).
const CHOICE_LABELS = Object.freeze({ random: "Ville aléatoire", local: "Fichier local" });

const $ = (id) => document.getElementById(id);
const canvas = $("map");
const renderer = createRenderer({ canvas, frame: $("map-frame") });
const status = $("status");
let city, tools = null;
let ready = false; // true once a city is in the engine (sample, file or new city)
let seedNote = null; // seed of the city made by "Nouvelle ville", shown in the status line
let shown = "haight"; // the selector value of the city on the map
const latest = createLatest(); // the newest load wins (a late sample never replaces a file)

const playback = createPlayback({
  tick() {
    const n = ticksPerFrame(city.speed());
    for (let k = 0; k < n; k++) city.tick();
    draw();
  },
});

function draw() {
  if (!ready) return; // no city yet: the status line keeps "Chargement…", no numbers
  renderer.draw(city);
  // funds are part of every redraw, so the status line shows them after every action
  status.textContent = formatStatus({
    seed: seedNote,
    month: city.month(),
    year: city.year(),
    funds: city.funds(),
  });
  $("stats").textContent = formatStats({
    population: city.population(),
    score: city.score(),
    demand: city.demand(),
  });
  tools?.render();
  for (const f of features) f.update?.(featureApi);
}

function setPlaying(on) {
  playback.set(on);
  const playing = playback.playing;
  $("play").textContent = playing ? "⏸ Pause" : "▶ Lecture";
  $("play").setAttribute("aria-pressed", String(playing));
}

// The load messages live in their own live region: the status line is never replaced by them.
function setLoadMessage(text) {
  $("load-msg").textContent = text;
}

// The first city is in: the controls that need a city become usable.
function unlock() {
  ready = true;
  $("play").disabled = false;
  $("save").disabled = false;
  $("palette").inert = false;
  $("map-frame").inert = false;
}

// Puts the engine's city in place from the bytes of a .cty file. Returns null on success, or
// the error the engine gave: the city, the status line and the playback are then left as they were.
function load(bytes) {
  try {
    city.load_cty(bytes);
  } catch (e) {
    return e;
  }
  setPlaying(false);
  city.take_events();
  seedNote = null;
  city.set_speed(Number($("speed").value));
  city.enable_disasters($("disasters").checked);
  setLoadMessage("");
  unlock();
  draw();
  return null;
}

// Shows `value` in the city selector: a sample name, or "random" / "local" (an extra entry).
function showCity(value) {
  shown = value;
  const select = $("city");
  select.querySelector("option[data-choice]")?.remove();
  if (Object.hasOwn(CHOICE_LABELS, value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = CHOICE_LABELS[value];
    option.dataset.choice = "";
    select.append(option);
  }
  select.value = value;
}

// A load that failed: say why, and show the city that is still there.
function reportFailure(error) {
  setLoadMessage(formatLoadError(error));
  $("city").value = shown;
  if (!ready) status.textContent = NO_CITY_TEXT;
}

async function loadSample(name) {
  const ticket = latest.start();
  let bytes;
  try {
    const r = await fetch(`cities/${name}.cty`);
    if (!r.ok) throw new Error(`${name}.cty : HTTP ${r.status}`);
    bytes = new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    if (latest.isCurrent(ticket)) reportFailure(e);
    return;
  }
  if (!latest.isCurrent(ticket)) return;
  const error = load(bytes);
  if (error) reportFailure(error);
  else showCity(name);
}

// "Nouvelle ville": stop playback, ask the engine for a city from the seed, keep the
// page's speed and disasters options, show the seed so it can be noted and reused.
function newCity() {
  const seedInput = $("seed");
  if (!ready) {
    $("new-msg").textContent = LOADING_TEXT;
    return;
  }
  const parsed = parseSeed(seedInput.value);
  if (parsed.error) {
    $("new-msg").textContent = parsed.error;
    seedInput.setAttribute("aria-invalid", "true");
    return;
  }
  $("new-msg").textContent = "";
  seedInput.removeAttribute("aria-invalid");
  latest.start(); // a sample or file still loading must not replace this city
  setPlaying(false);
  city.new_random_city(parsed.seed);
  // the engine resets its speed and disasters on a new city: push the page's options again
  applyEnginePreferences(city, { speed: $("speed").value, disasters: $("disasters").checked });
  seedNote = parsed.seed;
  seedInput.value = String(parsed.seed);
  setLoadMessage("");
  showCity("random");
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
// Feature modules (messages, budget…): each exports setup(api) / update(api) and checks that the
// engine has the methods it needs. `update` runs after every redraw.
const features = [messages, budgetUi, overlays];
const featureApi = { city: () => city, $, redraw: () => draw(), isReady: () => ready };
for (const f of features) f.setup?.(featureApi);
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
$("city").onchange = (e) => loadSample(e.target.value);
$("file").onchange = async (ev) => {
  const input = ev.target;
  const f = input.files[0];
  input.value = ""; // so that choosing the same file again still fires "change"
  if (!f) return;
  const ticket = latest.start();
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (!latest.isCurrent(ticket)) return;
  const error = load(bytes);
  if (error) reportFailure(error);
  else showCity("local");
};
$("play").onclick = () => setPlaying(!playback.playing);
$("speed").oninput = (e) => city.set_speed(Number(e.target.value));
$("disasters").onchange = (e) => city.enable_disasters(e.target.checked);
$("save").onclick = () => {
  if (!ready) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([city.save_cty()], { type: "application/octet-stream" }));
  a.download = "city.cty";
  a.click();
  URL.revokeObjectURL(a.href);
};
if (MOCK) {
  load(new Uint8Array(0));
} else {
  loadSample("haight");
}
