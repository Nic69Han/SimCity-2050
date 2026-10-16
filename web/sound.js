// Page feature: sounds of the actions and of the city's events (docs/game-design.md, workstream
// "Sons"). Presentation only: sound-model.js chooses the file, this module plays it with Web Audio.
// Nothing is created, fetched or played before a gesture of the player (autoplay rules); the
// choice is muted by default and remembered in localStorage (per viewer, never shared).
// Feature hooks: setup(api), called once by main.js.
import { onSound } from "./messages.js";
import {
  STORAGE_KEY, preferenceOf, preferenceValue, muteLabel, createLimiter, soundFiles, soundOf,
  soundForEngine, soundForToolMessage,
} from "./sound-model.js";

const limiter = createLimiter();
let on = false; // the player's choice (muted until they turn it on)
let button = null; // the mute button in #sound-controls
let audio = null; // { ctx, buffers: Map(file -> AudioBuffer) } once a gesture has come and sound is on

function audioContextClass() {
  return window.AudioContext ?? window.webkitAudioContext ?? null;
}

// The choice is kept per viewer. A browser that blocks storage keeps it for this page only.
function readChoice() {
  try {
    return preferenceOf(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    console.warn("son : choix non lu, coupé par défaut", e);
    return false;
  }
}

function writeChoice(value) {
  try {
    localStorage.setItem(STORAGE_KEY, preferenceValue(value));
  } catch (e) {
    console.warn("son : choix non enregistré", e);
  }
}

// Fetches and decodes one file. A file that fails is skipped (silence for its sound), with a warning.
async function loadFile(ctx, buffers, file) {
  try {
    const response = await fetch(`sounds/${file}`);
    if (!response.ok) throw new Error(`${file} : HTTP ${response.status}`);
    buffers.set(file, await ctx.decodeAudioData(await response.arrayBuffer()));
  } catch (e) {
    console.warn(`son : ${file} non chargé`, e);
  }
}

// Called from a gesture of the player only: creates the audio context (allowed then) and fetches
// the sounds, once. Without Web Audio the page has no sound control at all (setup).
function wake() {
  if (audio === null) {
    try {
      const ctx = new (audioContextClass())();
      const buffers = new Map();
      audio = { ctx, buffers };
      for (const file of soundFiles()) loadFile(ctx, buffers, file);
    } catch (e) {
      console.warn("son : audio indisponible", e);
      return;
    }
  }
  if (audio.ctx.state === "suspended") {
    audio.ctx.resume().catch((e) => console.warn("son : reprise impossible", e));
  }
}

// Starts one sound, if sound is on, its file is decoded and the rate limit allows it.
function play(sound) {
  if (!on || audio === null || sound === null) return;
  const buffer = audio.buffers.get(sound.file);
  if (buffer === undefined || !limiter.allow(performance.now())) return;
  const { ctx } = audio;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.playbackRate.value = sound.rate;
  gain.gain.value = sound.volume;
  source.connect(gain).connect(ctx.destination);
  source.start();
}

function render() {
  button.textContent = muteLabel(on);
}

function toggle() {
  on = !on;
  writeChoice(on);
  if (on) wake();
  render();
}

// A button of the page is a click: the click sound (the mute button itself has none).
function clickSound(event) {
  if (event.target instanceof Element && event.target.closest("button") && !event.target.closest("#sound-toggle")) {
    play(soundOf("click"));
  }
}

export function setup(api) {
  const box = api.$("sound-controls");
  if (!box || audioContextClass() === null) return; // no Web Audio: the control stays hidden
  on = readChoice();
  button = document.createElement("button");
  button.id = "sound-toggle";
  button.type = "button";
  button.addEventListener("click", toggle);
  box.replaceChildren(button);
  box.hidden = false;
  render();
  // a remembered "on" waits for the first gesture to load its sounds
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(type, () => {
      if (on) wake();
    }, true);
  }
  document.addEventListener("click", clickSound, true);
  onSound(({ name }) => play(soundForEngine(name)));
  const toolLine = api.$("tool-msg");
  if (toolLine) {
    // the tool line states the result of each tool press (tools.js): a refusal sounds
    new MutationObserver(() => play(soundForToolMessage(toolLine.textContent)))
      .observe(toolLine, { childList: true, characterData: true, subtree: true });
  }
}
