// Music, the pure part (docs/game-design-v1.md, "Musique"): a slow sequence of soft chords, the
// notes to schedule in the next window, the envelope of each note, the chord set of the time of
// day, and what localStorage keeps for the player's choice. No Web Audio, no DOM: music.js plays
// what this module chooses.
//
// Time is in seconds of the audio clock. The chords start at origin + k * CHORD_SECONDS (k = 0, 1,
// ...); origin is the audio time at which the music started. Each chord is a set of MIDI notes.

/** Seconds from one chord to the next (the note length of the sequence). */
export const CHORD_SECONDS = 8;
/** Seconds of fade-in of each note (the attack). */
export const ATTACK_SECONDS = 2.5;
/** Seconds of fade-out of each note after its chord ends (the release). */
export const RELEASE_SECONDS = 3;
/** Peak gain of one note, before the player's volume. Chords are quiet on purpose. */
export const NOTE_GAIN = 0.08;
/** How far ahead of the audio clock the notes are scheduled, in seconds. */
export const LOOKAHEAD_SECONDS = 0.6;
/** At most this many chords are scheduled in one window (a bound on the work of one pump). */
export const MAX_CHORDS_PER_WINDOW = 2;
/** Delay between the start of the audio context and the first chord, in seconds. */
export const START_LEAD_SECONDS = 0.2;
/** The volume at the start, when nothing is remembered (0..1). */
export const DEFAULT_VOLUME = 0.3;
/** localStorage key of the player's choice: { on, volume } as JSON. */
export const STORAGE_KEY = "micropolis.music";

/** Day chords (C, Am, F, G), MIDI notes: major and warm. */
export const DAY_CHORDS = Object.freeze([
  Object.freeze([60, 64, 67]),
  Object.freeze([57, 60, 64]),
  Object.freeze([53, 57, 60]),
  Object.freeze([55, 59, 62]),
]);

/** Night chords (Am, Dm, F, Em), an octave lower and darker. */
export const NIGHT_CHORDS = Object.freeze([
  Object.freeze([48, 52, 57]),
  Object.freeze([50, 53, 57]),
  Object.freeze([53, 56, 60]),
  Object.freeze([52, 55, 59]),
]);

/** The daylight from which the day chords play (0..1, the 3D view's daylight). */
export const DAY_THRESHOLD = 0.5;

/** Frequency in Hz of a MIDI note (A4 = note 69 = 440 Hz). */
export function midiToHz(note) {
  if (!Number.isFinite(note)) throw new RangeError(`music: MIDI note must be a finite number, got ${note}`);
  return 440 * 2 ** ((note - 69) / 12);
}

/** The chord set of a daylight level: the day set from DAY_THRESHOLD, the night set below. */
export function chordSetFor(daylight) {
  if (!Number.isFinite(daylight)) throw new RangeError(`music: daylight must be a finite number, got ${daylight}`);
  return daylight >= DAY_THRESHOLD ? DAY_CHORDS : NIGHT_CHORDS;
}

/** The state of a music that started at audio time `origin`: the next chord index not yet scheduled. */
export function initialState(origin) {
  if (!Number.isFinite(origin) || origin < 0) {
    throw new RangeError(`music: origin must be a time >= 0, got ${origin}`);
  }
  return { origin, chord: 0 };
}

/**
 * The notes to schedule for the window [now, now + LOOKAHEAD_SECONDS): at most MAX_CHORDS_PER_WINDOW
 * chords, from the first unscheduled one. Returns { state, notes }; state is a new object and the
 * caller keeps it. A note is { hz, start, duration, attack, release, gain } with start in audio time.
 */
export function next(state, nowSeconds, daylight) {
  if (!Number.isFinite(nowSeconds)) throw new RangeError(`music: now must be a finite time, got ${nowSeconds}`);
  const set = chordSetFor(daylight);
  const behind = Math.max(0, Math.ceil((nowSeconds - state.origin) / CHORD_SECONDS));
  const notes = [];
  let k = Math.max(state.chord, behind);
  const end = nowSeconds + LOOKAHEAD_SECONDS;
  for (let n = 0; n < MAX_CHORDS_PER_WINDOW; n++, k++) {
    const start = state.origin + k * CHORD_SECONDS;
    if (start >= end) break;
    for (const midi of set[k % set.length]) {
      notes.push({
        hz: midiToHz(midi), start, duration: CHORD_SECONDS, attack: ATTACK_SECONDS,
        release: RELEASE_SECONDS, gain: NOTE_GAIN,
      });
    }
  }
  return { state: { origin: state.origin, chord: k }, notes };
}

/**
 * The gain breakpoints of a note, as [{ time, gain }] in audio time: silent at its start, the peak
 * after the attack, held to the end of its chord, silent after the release.
 */
export function envelopePoints(note) {
  const { start, duration, attack, release, gain } = note;
  return [
    { time: start, gain: 0 },
    { time: start + attack, gain },
    { time: start + duration, gain },
    { time: start + duration + release, gain: 0 },
  ];
}

/** The time at which a note is silent again (its oscillator can stop there). */
export function noteEnd(note) {
  return note.start + note.duration + note.release;
}

/** A volume (any number) clamped to 0..1; anything not a number is the default volume. */
export function clampVolume(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, v));
}

/** The player's choice from what localStorage holds. Anything unreadable is off, at the default volume. */
export function settingsOf(raw) {
  const off = { on: false, volume: DEFAULT_VOLUME };
  if (typeof raw !== "string") return off;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return off; // a value that is not JSON was not written by this page: the default
  }
  if (parsed === null || typeof parsed !== "object") return off;
  return { on: parsed.on === true, volume: clampVolume(parsed.volume) };
}

/** What localStorage keeps for the choice. */
export function settingsValue({ on, volume }) {
  return JSON.stringify({ on: on === true, volume: clampVolume(volume) });
}

/** Label of the music button, in French: what a press does is the other state. */
export function musicLabel(on) {
  return on ? "Musique : activée" : "Musique : coupée";
}
