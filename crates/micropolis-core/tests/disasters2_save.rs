//! The extended disasters in a saved city (docs/game-design-v13.md): chunk 14 and the second rules
//! byte bit 4. Rule off and nothing stored = the file is what it always was; the drought
//! round-trips; a bad chunk is `cty_bad_extension`; a loaded city is made consistent.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::disasters2::{CHUNK_SIZE, DROUGHT_MONTHS, KIND_DROUGHT};
use micropolis_core::extensions::{CHUNK_DISASTERS, CHUNK_MAX_TAG, CHUNK_RULES};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::simulation::Simulation;
use support::{file_of, run};

const W: i32 = 97;
const H: i32 = 83;

fn city() -> Simulation {
    let mut s = Simulation::new(W, H);
    s.new_random_city(3);
    support::starter(&mut s);
    run(&mut s, 10);
    s
}

fn loaded(file: &[u8]) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(file, 1).expect("a file this crate wrote");
    s
}

fn block_at() -> usize {
    CITY_FILE_HEADER_SIZE
        + 2 * (6 * 240 + 120 + (W * H) as usize)
        + RELIEF_BLOCK_OVERHEAD
        + (W * H) as usize
}

fn chunk(tag: u8, bytes: &[u8]) -> Vec<u8> {
    let mut c = vec![tag];
    c.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    c.extend_from_slice(bytes);
    c
}

fn with_chunks(good: &[u8], chunks: &[u8]) -> Vec<u8> {
    let mut out = good[..block_at()].to_vec();
    out.extend_from_slice(&(chunks.len() as u32).to_be_bytes());
    out.extend_from_slice(chunks);
    out
}

fn dry_city() -> Simulation {
    let mut s = city();
    s.set_disaster2_rules(true);
    s.trigger_disaster(KIND_DROUGHT);
    s
}

#[test]
fn rule_off_and_nothing_stored_is_the_file_it_always_was() {
    let pristine = file_of(&city());
    let mut s = dry_city();
    s.set_disaster2_rules(false);
    assert!(!s.needs_extension_block());
    assert_eq!(file_of(&s), pristine);
}

#[test]
fn the_rule_alone_is_two_rule_bytes_and_no_chunk_14() {
    let mut s = city();
    s.set_disaster2_rules(true);
    let file = file_of(&s);
    let chunks = &file[block_at() + 4..];
    assert_eq!(chunks[0], CHUNK_RULES);
    assert_eq!(&chunks[1..5], &[0, 0, 0, 2]);
    assert_eq!(chunks[6] & 0b1_0000, 0b1_0000, "second byte, bit 4");
    assert_eq!(chunks.len(), 7, "nothing else is written");
    assert!(loaded(&file).disaster2_rules());
}

#[test]
fn the_drought_round_trips_in_chunk_14_the_last_one() {
    assert_eq!((CHUNK_DISASTERS, CHUNK_MAX_TAG, CHUNK_SIZE), (14, 14, 2));
    let s = dry_city();
    let file = file_of(&s);
    let chunks = &file[block_at() + 4..];
    assert_eq!(
        &chunks[chunks.len() - 7..],
        &[14, 0, 0, 0, 2, 0, DROUGHT_MONTHS as u8]
    );
    let back = loaded(&file);
    assert!(back.disaster2_rules());
    assert_eq!(back.disaster2_stats()[0], i32::from(DROUGHT_MONTHS));
    assert_eq!(
        back.extensions().disaster_state,
        s.extensions().disaster_state
    );
    let again = file_of(&back);
    assert_eq!(
        file_of(&loaded(&again)),
        again,
        "stable from the second save on"
    );
}

#[test]
fn a_loaded_drought_weakens_the_pumps_at_the_first_valves() {
    let mut s = dry_city();
    s.set_water_rules(true);
    let mut back = loaded(&file_of(&s));
    assert!(!back.water().is_weak(), "not before the valves");
    back.set_valves();
    assert!(back.water().is_weak());
}

#[test]
fn a_bad_chunk_is_refused_and_leaves_the_engine_untouched() {
    let mut engine = dry_city();
    let good = file_of(&engine);
    let before = file_of(&engine);
    let bad = [
        ("empty", chunk(CHUNK_DISASTERS, &[])),
        ("short", chunk(CHUNK_DISASTERS, &[1])),
        ("long", chunk(CHUNK_DISASTERS, &[0, 1, 0])),
        ("zero", chunk(CHUNK_DISASTERS, &[0, 0])),
        (
            "too many months",
            chunk(CHUNK_DISASTERS, &[0, DROUGHT_MONTHS as u8 + 1]),
        ),
        ("high byte", chunk(CHUNK_DISASTERS, &[1, 0])),
        ("tag past the last", chunk(CHUNK_MAX_TAG + 1, &[0, 1])),
    ];
    for (name, chunks) in &bad {
        let err = engine
            .load_city(&with_chunks(&good, chunks), 1)
            .expect_err(name);
        assert_eq!(err.code(), "cty_bad_extension", "{name}");
        assert_eq!(file_of(&engine), before, "{name}");
    }
}

#[test]
fn a_drought_stored_while_the_rule_is_off_is_forgotten() {
    let good = file_of(&dry_city());
    let only_drought = chunk(CHUNK_DISASTERS, &[0, 5]);
    let back = loaded(&with_chunks(&good, &only_drought));
    assert!(!back.disaster2_rules());
    assert!(back.extensions().disaster_state.is_empty());
}
