//! wasm adapter: the messages of the game (translation only, ARCHITECTURE.md rule 4).
//!
//! `City::take_messages` drains the core event queue and returns the events the page
//! presents, as a flat list of fixed-size records `[kind, a, b, c, d, e]` (six `i32` each):
//!
//! | kind | event | a | b | c | d | e |
//! |------|-------|---|---|---|---|---|
//! | 1 `MESSAGE` | `sendMessage` | `MESSAGE_*` number | x (-1: none) | y (-1: none) | picture (0/1) | important (0/1) |
//! | 2 `SOUND` | `makeSound` | index in [`SOUNDS`] (`sound_name`) | x (-1: everywhere) | y (-1: everywhere) | 0 | 0 |
//! | 3 `WIN` | `winGame` | 0 | 0 | 0 | 0 | 0 |
//! | 4 `LOSE` | `loseGame` | 0 | 0 | 0 | 0 | 0 |
//! | 5 `QUAKE` | `startEarthquake` | strength | 0 | 0 | 0 | 0 |
//! | 6 `GOTO` | `autoGoto` | 0 | x | y | 0 | 0 |
//!
//! Map updates and display refreshes are not messages: they are dropped here (the page
//! redraws after every action anyway). The records are in the order the engine emitted them.

use crate::City;
use micropolis_core::events::Event;
use wasm_bindgen::prelude::*;

/// Number of `i32` values in one record.
pub const RECORD_LEN: usize = 6;
pub const KIND_MESSAGE: i32 = 1;
pub const KIND_SOUND: i32 = 2;
pub const KIND_WIN: i32 = 3;
pub const KIND_LOSE: i32 = 4;
pub const KIND_QUAKE: i32 = 5;
pub const KIND_GOTO: i32 = 6;

/// The `(channel, sound)` pairs the core passes to `makeSound`, indexed by the `a` field of a
/// sound record. A sound the table does not know is written as -1.
pub const SOUNDS: &[(&str, &str)] = &[
    ("city", "Siren"),
    ("city", "HonkHonkLow"),
    ("city", "HonkHonkMed"),
    ("city", "HonkHonkHigh"),
    ("city", "Monster"),
    ("city", "ExplosionLow"),
    ("city", "ExplosionHigh"),
    ("city", "HeavyTraffic"),
    ("city", "FogHornLow"),
    ("interface", "UhUh"),
    ("interface", "Sorry"),
];

/// Index of a sound in [`SOUNDS`], or -1.
fn sound_index(channel: &str, sound: &str) -> i32 {
    SOUNDS
        .iter()
        .position(|&(c, s)| c == channel && s == sound)
        .map_or(-1, |i| i as i32)
}

/// Appends one record.
fn push(out: &mut Vec<i32>, record: [i32; RECORD_LEN]) {
    out.extend_from_slice(&record);
}

#[wasm_bindgen]
impl City {
    /// Drains the pending game events the page presents, as flat records of [`RECORD_LEN`]
    /// values (see the table at the top of this file). Call it after every redraw; events
    /// not listed there are discarded.
    pub fn take_messages(&mut self) -> Vec<i32> {
        let mut out = Vec::new();
        for event in self.sim.drain_events() {
            match event {
                Event::Message {
                    number,
                    x,
                    y,
                    picture,
                    important,
                } => push(
                    &mut out,
                    [
                        KIND_MESSAGE,
                        i32::from(number),
                        i32::from(x),
                        i32::from(y),
                        i32::from(picture),
                        i32::from(important),
                    ],
                ),
                Event::Sound {
                    channel,
                    sound,
                    x,
                    y,
                } => push(
                    &mut out,
                    [KIND_SOUND, sound_index(channel, sound), x, y, 0, 0],
                ),
                Event::WinGame => push(&mut out, [KIND_WIN, 0, 0, 0, 0, 0]),
                Event::LoseGame => push(&mut out, [KIND_LOSE, 0, 0, 0, 0, 0]),
                Event::StartEarthquake(strength) => {
                    push(&mut out, [KIND_QUAKE, strength, 0, 0, 0, 0]);
                }
                Event::AutoGoto { x, y } => {
                    push(&mut out, [KIND_GOTO, 0, i32::from(x), i32::from(y), 0, 0]);
                }
                _ => {}
            }
        }
        out
    }

    /// `"channel/sound"` of the sound index `a` of a sound record; empty when unknown.
    pub fn sound_name(index: i32) -> String {
        usize::try_from(index)
            .ok()
            .and_then(|i| SOUNDS.get(i))
            .map_or_else(String::new, |(channel, sound)| format!("{channel}/{sound}"))
    }
}
