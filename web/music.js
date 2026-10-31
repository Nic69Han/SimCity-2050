// Page feature: the ambiance music (docs/game-design-v1.md, "Musique"). music-model.js chooses the
// notes; this module plays them with oscillators and gain envelopes, a little ahead of the audio clock.
// Nothing is created before a gesture of the player: the AudioContext is made by the click that
// turns the music on (or by the first press or key of a page that remembers "on"). Turning it off
// stops the timer and closes the context. The button and the volume slider sit in #sound-controls,
// after the sound toggle (main.js lists the sound feature before this one).
// Feature hooks: setup(api), called once by main.js.
import {
  STORAGE_KEY, DEFAULT_VOLUME, initialState, next, envelopePoints, noteEnd, clampVolume,
  settingsOf, settingsValue, musicLabel, START_LEAD_SECONDS,
} from "./music-model.js";

/** How often the timer schedules the next window, in milliseconds (shorter than the lookahead). */
export const PUMP_MS = 200;
/** The daylight the page gives the music: the 3D view does not expose its daylight, so the day set plays. */
const FULL_DAY = 1;

/**
 * The player: start() creates the context and the timer, stop() stops and closes them, setVolume()
 * sets the master gain. Every browser object comes in through `deps`, so the tests run it with a
 * fake AudioContext. Returns { running, start, stop, setVolume }.
 */
export function createPlayer({ makeContext, schedule, cancel, daylight = () => FULL_DAY, volume = DEFAULT_VOLUME }) {
  let audio = null; // { ctx, master, state, timer } while the music plays
  let level = clampVolume(volume);

  function playNote(ctx, out, note) {
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.frequency.value = note.hz;
    const [first, ...rest] = envelopePoints(note);
    envelope.gain.setValueAtTime(first.gain, first.time);
    for (const p of rest) envelope.gain.linearRampToValueAtTime(p.gain, p.time);
    oscillator.connect(envelope).connect(out);
    oscillator.start(note.start);
    oscillator.stop(noteEnd(note));
  }

  // One window: the notes of the next chords, scheduled ahead of the audio clock (model: next).
  function pump() {
    if (audio === null) return;
    const { ctx } = audio;
    const { state, notes } = next(audio.state, ctx.currentTime, daylight());
    audio.state = state;
    for (const note of notes) playNote(ctx, audio.master, note);
  }

  return {
    get running() {
      return audio !== null;
    },
    start() {
      if (audio !== null) return;
      const ctx = makeContext();
      const master = ctx.createGain();
      master.gain.value = level;
      master.connect(ctx.destination);
      if (ctx.state === "suspended") ctx.resume().catch((e) => console.warn("musique : reprise impossible", e));
      audio = { ctx, master, state: initialState(ctx.currentTime + START_LEAD_SECONDS), timer: null };
      audio.timer = schedule(pump, PUMP_MS);
      pump();
    },
    stop() {
      if (audio === null) return;
      const { ctx, timer } = audio;
      audio = null;
      cancel(timer);
      ctx.close().catch((e) => console.warn("musique : fermeture impossible", e));
    },
    setVolume(v) {
      level = clampVolume(v);
      if (audio !== null) audio.master.gain.value = level;
    },
  };
}

// Module state of the page feature (one page, one music).
let player = null;
let on = false; // the player's choice (off until they turn it on)
let volume = DEFAULT_VOLUME;
let button = null; // the music toggle
let slider = null; // the volume slider (0..100)

function audioContextClass() {
  return window.AudioContext ?? window.webkitAudioContext ?? null;
}

// The choice and the volume are kept per viewer. A browser that blocks storage keeps them for this page.
function readSettings() {
  try {
    return settingsOf(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    console.warn("musique : réglage non lu, coupée par défaut", e);
    return settingsOf(null);
  }
}

function writeSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, settingsValue({ on, volume }));
  } catch (e) {
    console.warn("musique : réglage non enregistré", e);
  }
}

// Starts the music from a gesture of the player. Without Web Audio the choice is dropped.
function startPlayer() {
  try {
    player.start();
  } catch (e) {
    console.warn("musique : audio indisponible", e);
    on = false;
  }
}

function render() {
  button.textContent = musicLabel(on);
  button.setAttribute("aria-pressed", String(on));
  slider.value = String(Math.round(volume * 100));
}

function toggle() {
  on = !on;
  writeSettings();
  if (on) startPlayer();
  else player.stop();
  render();
}

function changeVolume() {
  volume = clampVolume(Number(slider.value) / 100);
  player.setVolume(volume);
  writeSettings();
}

export function setup(api) {
  const box = api.$("sound-controls");
  if (!box || audioContextClass() === null) return; // no Web Audio: no music control
  const saved = readSettings();
  on = saved.on;
  volume = saved.volume;
  player = createPlayer({
    makeContext: () => new (audioContextClass())(),
    schedule: (fn, ms) => setInterval(fn, ms),
    cancel: (timer) => clearInterval(timer),
    volume,
  });
  button = document.createElement("button");
  button.id = "music-toggle";
  button.type = "button";
  button.addEventListener("click", toggle);
  slider = document.createElement("input");
  slider.id = "music-volume";
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "5";
  slider.setAttribute("aria-label", "Volume de la musique");
  slider.style.width = "6em";
  slider.addEventListener("input", changeVolume);
  box.append(button, slider);
  box.hidden = false;
  render();
  // a remembered "on" waits for the first gesture: the context is created only then
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(type, () => {
      if (on && !player.running) startPlayer();
    }, true);
  }
}
