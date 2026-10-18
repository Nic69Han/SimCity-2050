// Sounds, the pure part (docs/game-design.md, workstream "Sons"): which file plays for an engine
// sound (City.sound_name, crates/micropolis-wasm/src/messages.rs) or a page event, how loud, and
// how often. No Web Audio, no DOM: web/sound.js plays what this module chooses.
// Files and licence: web/sounds/ (Kenney packs, CC0; see docs/credits.md).
import { RESULT } from "./tools.js";

/** At most this many sounds start in any window of one second (a fast drag must not spam). */
export const MAX_PLAYS_PER_SECOND = 6;
/** The window of the rate limit, in milliseconds. */
export const WINDOW_MS = 1000;
/** localStorage key of the player's choice ("on" or "off"). */
export const STORAGE_KEY = "micropolis.sound";

/**
 * The sounds by key: the file in web/sounds/, a volume (0..1) and a playback rate (1 by default).
 * Several keys may share a file (the three horns differ by pitch).
 */
export const SOUNDS = Object.freeze({
  click: { file: "ui-click.ogg", volume: 0.4 },
  // a built tool: the click file, lower and a little louder (no new file: the folder is capped at 1 MB)
  build: { file: "ui-click.ogg", volume: 0.5, rate: 0.7 },
  refused: { file: "ui-refused.ogg", volume: 0.6 },
  noMoney: { file: "ui-no-money.ogg", volume: 0.6 },
  siren: { file: "city-siren.ogg", volume: 0.35 },
  honkLow: { file: "city-honk.ogg", volume: 0.4, rate: 0.8 },
  honkMed: { file: "city-honk.ogg", volume: 0.4 },
  honkHigh: { file: "city-honk.ogg", volume: 0.4, rate: 1.25 },
  monster: { file: "city-monster.ogg", volume: 0.5 },
  explosionLow: { file: "city-explosion-low.ogg", volume: 0.5 },
  explosionHigh: { file: "city-explosion-high.ogg", volume: 0.6 },
  traffic: { file: "city-traffic.ogg", volume: 0.25 },
  fogHorn: { file: "city-fog-horn.ogg", volume: 0.4 },
});

/** Engine sound name ("channel/sound", as City.sound_name gives it) -> key of SOUNDS. */
export const ENGINE_SOUNDS = Object.freeze({
  "city/Siren": "siren",
  "city/HonkHonkLow": "honkLow",
  "city/HonkHonkMed": "honkMed",
  "city/HonkHonkHigh": "honkHigh",
  "city/Monster": "monster",
  "city/ExplosionLow": "explosionLow",
  "city/ExplosionHigh": "explosionHigh",
  "city/HeavyTraffic": "traffic",
  "city/FogHornLow": "fogHorn",
  "interface/UhUh": "refused",
  "interface/Sorry": "refused",
});

/** The file of a key of SOUNDS, with its defaults filled in; null for an unknown key. */
export function soundOf(key) {
  if (!Object.hasOwn(SOUNDS, key)) return null;
  const s = SOUNDS[key];
  return { key, file: s.file, volume: s.volume, rate: s.rate ?? 1 };
}

/** The sound of an engine sound name, or null when no file is mapped to it (silence). */
export function soundForEngine(name) {
  return Object.hasOwn(ENGINE_SOUNDS, name) ? soundOf(ENGINE_SOUNDS[name]) : null;
}

/**
 * The sound of a tool result (tools.js onToolResult: { kind, result }): success builds, a missing budget
 * and the refusals have their own. A null result (an engine drag reports none) or an unknown code is
 * silence. `kind` does not matter here: a drag segment that succeeds sounds like a click that does.
 */
export function soundForToolResult(event) {
  switch (event?.result) {
    case RESULT.OK:
      return soundOf("build");
    case RESULT.NO_MONEY:
      return soundOf("noMoney");
    case RESULT.NEED_BULLDOZE:
    case RESULT.FAILED:
      return soundOf("refused");
    default:
      return null;
  }
}

/** Files of every sound of the table, each once (what the page loads). */
export function soundFiles() {
  return [...new Set(Object.values(SOUNDS).map((s) => s.file))];
}

/**
 * Rate limit: `allow(now)` is true when a sound may start at time `now` (milliseconds, any origin),
 * and records it. At most `max` are allowed in any `windowMs`. The record is bounded by `max`.
 */
export function createLimiter({ max = MAX_PLAYS_PER_SECOND, windowMs = WINDOW_MS } = {}) {
  const starts = [];
  return {
    allow(now) {
      while (starts.length > 0 && now - starts[0] >= windowMs) starts.shift();
      if (starts.length >= max) return false;
      starts.push(now);
      return true;
    },
  };
}

/** The player's choice from what localStorage holds. Anything but "on" is muted (the default). */
export function preferenceOf(raw) {
  return raw === "on";
}

/** What localStorage keeps for the choice. */
export function preferenceValue(on) {
  return on ? "on" : "off";
}

/** Label of the mute button, in French: what a press does is the other state. */
export function muteLabel(on) {
  return on ? "Son : activé" : "Son : coupé";
}
