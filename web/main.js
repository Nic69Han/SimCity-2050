// Presentation adapter (ARCHITECTURE.md rule 5): draws what the engine
// exposes and forwards user actions. No game rule lives here.
import { TILE_PX as SCALE, setupTools } from "./tools.js";
import { PALETTE, legendEntries } from "./palette.js";
import { createRenderer } from "./render.js";
import * as messages from "./messages.js";
import * as budgetUi from "./budget-ui.js";
import * as overlays from "./overlays.js";
import * as saves from "./saves.js";
import { parseSeed, supportsNewCity, applyEnginePreferences } from "./newcity.js";
import { chooseSize, readLimits, supportsNewSized, saveNote, sizeErrorText } from "./sizes.js";
import { ticksPerFrame, createPlayback } from "./playback.js";
import { createLatest } from "./latest.js";
import { formatStatus, formatStats, formatLoadError, LOADING_TEXT, NO_CITY_TEXT } from "./status.js";
import { supportsRelief, readRelief, setRelief } from "./relief.js";
import * as advisors from "./advisors.js";
import * as tutorial from "./tutorial.js";
import * as sound from "./sound.js";

// ?mock=1 uses the dev-only fake engine (web/dev-mock.js); the wasm package is loaded otherwise.
const MOCK = new URLSearchParams(location.search).has("mock");
const { default: init, City } = MOCK ? await import("./dev-mock.js") : await import("./pkg/micropolis_wasm.js");
// Selector entries for a city that is not a sample (added while shown, removed by a sample).
const CHOICE_LABELS = Object.freeze({ random: "Ville aléatoire", local: "Fichier local", saved: "Partie enregistrée" });

const $ = (id) => document.getElementById(id);
const canvas = $("map");
const renderer = createRenderer({ canvas, frame: $("map-frame") });
const status = $("status");
let city, tools = null;
let ready = false; // true once a city is in the engine (sample, file or new city)
let seedNote = null; // seed of the city made by "Nouvelle ville", shown in the status line
let shown = "haight"; // the selector value of the city on the map
let sizeLimits = null; // map size limits of the engine (City.size_limits), read at start
let game = { id: 0, kind: "none" }; // games begun: id changes on each; kind is "new", "sample", "file" or "save"
const latest = createLatest(); // the newest load wins (a late sample never replaces a file)

const playback = createPlayback({
  tick() {
    const n = ticksPerFrame(city.speed());
    for (let k = 0; k < n; k++) city.tick();
    draw();
  },
});

// Enregistrer only saves the original 120 x 100 map (a .cty file describes that size).
function updateSaveButton() {
  const saveable = saves.canSaveBytes(city);
  $("save").disabled = !saveable;
  $("save-note").textContent = saveNote(saveable);
}

function draw() {
  if (!ready) return; // no city yet: the status line keeps "Chargement…", no numbers
  if (in3d) {
    frame.style.setProperty("--ratio", `${city.width()} / ${city.height()}`);
    view3d.update(city);
  } else {
    renderer.draw(city);
  }
  updateSaveButton();
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

// «Vue 3D»: the 3D view replaces the map canvas while it is on. Three.js is loaded at the first
// press only. The simulation keeps ticking: draw() hands the city to whichever view is shown.
const frame = $("map-frame");
const view3dButton = $("view3d");
let view3d = null; // web/view3d.js, once loaded
let in3d = false;
let switching = false;
async function setView3d(on) {
  if (switching || !ready || on === in3d) return;
  switching = true;
  try {
    if (on) {
      view3d ??= await import("./view3d.js");
      frame.classList.add("is-3d");
      view3d.mount(city, $("map3d"));
      in3d = true;
      tools?.useSurface(view3d.surface());
    } else {
      tools?.useSurface(null);
      view3d.dispose();
      frame.classList.remove("is-3d");
      in3d = false;
    }
    view3dButton.textContent = in3d ? "Vue 2D" : "Vue 3D";
    view3dButton.setAttribute("aria-pressed", String(in3d));
    draw();
  } finally {
    switching = false;
  }
}
view3dButton.onclick = () => setView3d(!in3d);

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
  $("view3d").disabled = false;
  $("save").disabled = false;
  $("palette").inert = false;
  $("map-frame").inert = false;
}

// Puts the engine's city in place from the bytes of a .cty file. Returns null on success, or
// the error the engine gave: the city, the status line and the playback are then left as they were.
function load(bytes, kind = "sample") {
  try {
    saves.loadBytes(city, bytes); // load_city when the engine has it (any size), else load_cty
  } catch (e) {
    return e;
  }
  setPlaying(false);
  city.take_events();
  seedNote = null;
  city.set_speed(Number($("speed").value));
  city.enable_disasters($("disasters").checked);
  syncRelief();
  setLoadMessage("");
  unlock();
  game = { id: game.id + 1, kind };
  draw();
  return null;
}

// The relief checkbox and the terraforming buttons show the engine's flag. It is read after a
// load or a new city (a file may carry it on), never pushed into the city.
function syncRelief() {
  $("relief-label").hidden = !supportsRelief(city);
  const on = readRelief(city);
  $("relief").checked = on;
  tools?.setFlag("relief", on);
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

async function loadSample(name, user = true) {
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
  else {
    showCity(name);
    saves.cityLoaded({ user });
  }
}

// A new random city of the chosen size, in the same city object (the tools and the playback keep it).
function makeCity(size, seed) {
  if (supportsNewSized(City)) city.adopt(City.new_sized(size.width, size.height, seed));
  else city.new_random_city(seed);
}

// "Nouvelle ville": stop playback, ask the engine for a city from the seed, keep the
// page's speed and disasters options, show the seed so it can be noted and reused.
function newCity() {
  const seedInput = $("seed");
  if (!ready) {
    $("new-msg").textContent = LOADING_TEXT;
    return;
  }
  const size = chooseSize({ preset: $("size").value, width: $("size-w").value, height: $("size-h").value }, sizeLimits);
  const sizeFields = { width: $("size-w"), height: $("size-h") };
  for (const f of Object.values(sizeFields)) f.removeAttribute("aria-invalid");
  if (size.error) {
    $("new-msg").textContent = size.error;
    if (size.field) sizeFields[size.field].setAttribute("aria-invalid", "true");
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
  try {
    makeCity(size, parsed.seed);
  } catch (e) {
    $("new-msg").textContent = sizeErrorText(String(e?.message ?? e), sizeLimits);
    return;
  }
  // the engine resets its speed and disasters on a new city: push the page's options again
  applyEnginePreferences(city, { speed: $("speed").value, disasters: $("disasters").checked });
  syncRelief();
  seedNote = parsed.seed;
  seedInput.value = String(parsed.seed);
  setLoadMessage("");
  showCity("random");
  game = { id: game.id + 1, kind: "new" };
  $("query-panel").hidden = true;
  draw();
  saves.cityLoaded({ user: true });
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
const features = [messages, budgetUi, overlays, saves, advisors, tutorial, sound];
const featureApi = {
  city: () => city,
  $,
  redraw: () => draw(),
  isReady: () => ready,
  game: () => game,
  limits: () => sizeLimits,
  // the page's name for the city now: the selector's entry and the seed of a random city
  describe: () => ({ label: $("city").selectedOptions[0]?.textContent ?? "", seed: seedNote }),
  // loads a save's bytes like an opened file; returns the engine's error, or null
  replaceCity(bytes) {
    const error = load(bytes, "save");
    if (!error) showCity("saved");
    return error;
  },
};
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
syncRelief();
sizeLimits = readLimits(City);
$("size-w").min = sizeLimits.minWidth;
$("size-w").max = sizeLimits.maxWidth;
$("size-h").min = sizeLimits.minHeight;
$("size-h").max = sizeLimits.maxHeight;
$("size").onchange = (e) => {
  $("size-custom").hidden = e.target.value !== "custom";
};
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
  const error = load(bytes, "file");
  if (error) reportFailure(error);
  else {
    showCity("local");
    saves.cityLoaded({ user: true });
  }
};
$("play").onclick = () => setPlaying(!playback.playing);
$("speed").oninput = (e) => city.set_speed(Number(e.target.value));
$("disasters").onchange = (e) => city.enable_disasters(e.target.checked);
$("relief").onchange = (e) => {
  $("relief").checked = setRelief(city, e.target.checked); // the engine's answer
  tools?.setFlag("relief", readRelief(city));
  draw();
};
$("save").onclick = () => {
  if (!ready || !saves.canSaveBytes(city)) return;
  const bytes = saves.saveBytes(city);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  // the original 120x100 format keeps .cty; any other size uses the extended format (magic "MCTY")
  const extended = bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "MCTY";
  a.download = extended ? "city.mcty" : "city.cty";
  a.click();
  URL.revokeObjectURL(a.href);
};
// The startup sample loads first; the saves then offer the autosave, if there is one.
if (MOCK) load(new Uint8Array(0));
else await loadSample("haight", false);
await saves.start();
