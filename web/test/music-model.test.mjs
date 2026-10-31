// Tests of the music's pure part (web/music-model.js): frequencies, the chord set of the daylight, the
// notes of each window (bounded, no repeats, no gaps), the envelope, the volume and the stored choice.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CHORD_SECONDS, ATTACK_SECONDS, RELEASE_SECONDS, NOTE_GAIN, LOOKAHEAD_SECONDS, MAX_CHORDS_PER_WINDOW,
  DEFAULT_VOLUME, DAY_CHORDS, NIGHT_CHORDS, STORAGE_KEY, midiToHz, chordSetFor, initialState, next,
  envelopePoints, noteEnd, clampVolume, settingsOf, settingsValue, musicLabel,
} from "../music-model.js";

describe("frequencies and chord sets", () => {
  test("A4 is 440 Hz and an octave doubles the frequency", () => {
    assert.equal(midiToHz(69), 440);
    assert.equal(midiToHz(57), 220);
    assert.equal(midiToHz(81), 880);
    assert.ok(Math.abs(midiToHz(60) - 261.6256) < 0.001, "middle C");
  });

  test("a non-finite note is an error, not a silent frequency", () => {
    assert.throws(() => midiToHz(NaN), RangeError);
    assert.throws(() => midiToHz(Infinity), RangeError);
  });

  test("daylight from one half is the day set, below it the night set", () => {
    assert.equal(chordSetFor(1), DAY_CHORDS);
    assert.equal(chordSetFor(0.5), DAY_CHORDS);
    assert.equal(chordSetFor(0.49), NIGHT_CHORDS);
    assert.equal(chordSetFor(0), NIGHT_CHORDS);
  });

  test("a non-finite daylight is an error", () => {
    assert.throws(() => chordSetFor(NaN), RangeError);
  });

  test("every chord has three notes, and the night chords are lower than the day chords", () => {
    for (const c of [...DAY_CHORDS, ...NIGHT_CHORDS]) assert.equal(c.length, 3);
    assert.ok(midiToHz(NIGHT_CHORDS[0][0]) < midiToHz(DAY_CHORDS[0][0]));
  });
});

describe("the notes of each window", () => {
  test("the first window starts the first chord at the origin, with its three notes", () => {
    const { state, notes } = next(initialState(5), 5, 1);
    assert.equal(notes.length, 3);
    for (const n of notes) assert.equal(n.start, 5);
    assert.deepEqual(notes.map((n) => n.hz), DAY_CHORDS[0].map(midiToHz));
    assert.equal(state.chord, 1, "the next chord to schedule is the second");
  });

  test("nothing is scheduled while the next chord is beyond the lookahead", () => {
    const { state, notes } = next(initialState(10), 0, 1);
    assert.deepEqual(notes, []);
    assert.equal(state.chord, 0, "still the first chord to schedule");
  });

  test("the chord inside the lookahead is scheduled, once", () => {
    const first = next(initialState(0), 0, 1);
    const later = next(first.state, CHORD_SECONDS - 0.1, 1);
    assert.equal(later.notes.length, 3);
    assert.equal(later.notes[0].start, CHORD_SECONDS);
    const again = next(later.state, CHORD_SECONDS - 0.1, 1);
    assert.deepEqual(again.notes, [], "a chord is never scheduled twice");
  });

  test("the chords follow the sequence and wrap around it", () => {
    let state = initialState(0);
    const firsts = [];
    for (let k = 0; k <= DAY_CHORDS.length; k++) {
      const r = next(state, k * CHORD_SECONDS, 1);
      state = r.state;
      firsts.push(r.notes[0].hz);
    }
    const expected = [...DAY_CHORDS, DAY_CHORDS[0]].map((c) => midiToHz(c[0]));
    assert.deepEqual(firsts, expected);
  });

  test("the night set plays when the daylight is low", () => {
    const { notes } = next(initialState(0), 0, 0);
    assert.deepEqual(notes.map((n) => n.hz), NIGHT_CHORDS[0].map(midiToHz));
  });

  test("a long pause schedules from the current chord, never a burst of missed ones", () => {
    const { notes, state } = next(initialState(0), 1000, 1);
    assert.ok(notes.length <= MAX_CHORDS_PER_WINDOW * 3, "bounded by the window");
    assert.ok(notes.every((n) => n.start >= 1000), "no note in the past");
    assert.ok(state.chord > 0);
  });

  test("a window never schedules more than MAX_CHORDS_PER_WINDOW chords, even from a far-behind state", () => {
    const far = { origin: 0, chord: 0 };
    const { notes } = next(far, 1e6, 1);
    assert.ok(notes.length <= MAX_CHORDS_PER_WINDOW * DAY_CHORDS[0].length);
  });

  test("the input state is not changed", () => {
    const state = initialState(0);
    next(state, 0, 1);
    assert.deepEqual(state, { origin: 0, chord: 0 });
  });

  test("each note has the envelope and the gain of the model", () => {
    const [n] = next(initialState(2), 2, 1).notes;
    assert.deepEqual(
      { duration: n.duration, attack: n.attack, release: n.release, gain: n.gain },
      { duration: CHORD_SECONDS, attack: ATTACK_SECONDS, release: RELEASE_SECONDS, gain: NOTE_GAIN },
    );
  });

  test("bad inputs are errors: a non-finite now, a negative origin", () => {
    assert.throws(() => next(initialState(0), NaN, 1), RangeError);
    assert.throws(() => initialState(-1), RangeError);
    assert.throws(() => initialState(NaN), RangeError);
  });
});

describe("the envelope", () => {
  const note = { start: 10, duration: 8, attack: 2, release: 3, gain: 0.5 };

  test("silent at the start, the peak after the attack, held to the end of the chord, silent after the release", () => {
    assert.deepEqual(envelopePoints(note), [
      { time: 10, gain: 0 },
      { time: 12, gain: 0.5 },
      { time: 18, gain: 0.5 },
      { time: 21, gain: 0 },
    ]);
  });

  test("the points are in time order and the note ends at its last point", () => {
    const pts = envelopePoints(note);
    for (let i = 1; i < pts.length; i++) assert.ok(pts[i].time > pts[i - 1].time);
    assert.equal(noteEnd(note), pts[pts.length - 1].time);
  });
});

describe("volume", () => {
  test("a volume is clamped to 0..1", () => {
    assert.equal(clampVolume(0.4), 0.4);
    assert.equal(clampVolume(2), 1);
    assert.equal(clampVolume(-1), 0);
  });

  test("a value that is not a number is the default volume", () => {
    assert.equal(clampVolume(NaN), DEFAULT_VOLUME);
    assert.equal(clampVolume("0.5"), DEFAULT_VOLUME);
    assert.equal(clampVolume(undefined), DEFAULT_VOLUME);
  });
});

describe("the stored choice", () => {
  test("nothing stored, or a value that is not a choice, is off at the default volume", () => {
    const off = { on: false, volume: DEFAULT_VOLUME };
    assert.deepEqual(settingsOf(null), off);
    assert.deepEqual(settingsOf(""), off);
    assert.deepEqual(settingsOf("{not json"), off);
    assert.deepEqual(settingsOf("null"), off);
    assert.deepEqual(settingsOf("[1,2]"), off);
    assert.deepEqual(settingsOf(42), off);
  });

  test("a stored choice is read as it was written", () => {
    assert.deepEqual(settingsOf('{"on":true,"volume":0.7}'), { on: true, volume: 0.7 });
  });

  test("only the boolean true turns the music on", () => {
    assert.equal(settingsOf('{"on":"yes","volume":0.2}').on, false);
    assert.equal(settingsOf('{"volume":0.2}').on, false);
  });

  test("an out-of-range stored volume is clamped", () => {
    assert.equal(settingsOf('{"on":true,"volume":9}').volume, 1);
    assert.equal(settingsOf('{"on":true,"volume":"loud"}').volume, DEFAULT_VOLUME);
  });

  test("what is written is read back the same", () => {
    const choice = { on: true, volume: 0.25 };
    assert.deepEqual(settingsOf(settingsValue(choice)), choice);
    assert.equal(settingsValue({ on: false, volume: 0.25 }).includes('"on":false'), true);
  });

  test("the storage key is named by the feature", () => {
    assert.equal(STORAGE_KEY, "micropolis.music");
  });

  test("the label says what a press does not, in French", () => {
    assert.equal(musicLabel(false), "Musique : coupée");
    assert.equal(musicLabel(true), "Musique : activée");
  });
});
