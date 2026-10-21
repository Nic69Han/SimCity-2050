//! The energy in a saved city (docs/game-design-v10.md): chunk 10 and the second rules byte bit 1.
//! Rule off and nothing stored = the file is what it always was; the ages and the electricity deals
//! round-trip; a bad chunk is `cty_bad_extension`; a loaded city is made consistent.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::deals::{DealResult, POWER_OFFER_BASE};
use micropolis_core::energy::{GENRE_WIND, RECORD_SIZE};
use micropolis_core::extensions::{CHUNK_ENERGY, CHUNK_MAX_TAG, CHUNK_RULES};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::simulation::Simulation;
use micropolis_core::tool::ToolResult;
use support::{file_of, run};

const W: i32 = 97;
const H: i32 = 83;
/// Months passed before saving.
const AGED: u32 = 7;

fn city() -> Simulation {
    let mut s = Simulation::new(W, H);
    s.new_random_city(3);
    support::starter(&mut s);
    run(&mut s, 10);
    s.total_funds = 1_000_000;
    s
}

fn free_spot(s: &Simulation, genre: u8) -> (i32, i32) {
    for x in 0..W - 4 {
        for y in 0..H - 4 {
            if s.structure_preview(genre, x, y).result == ToolResult::Ok {
                return (x, y);
            }
        }
    }
    panic!("no free spot");
}

/// Both rules on, a wind turbine aged `AGED` months, an electricity deal.
fn with_energy() -> (Simulation, (i32, i32)) {
    let mut s = city();
    s.set_structure_rules(true);
    s.set_energy_rules(true);
    s.set_deals_rules(true);
    let (x, y) = free_spot(&s, GENRE_WIND);
    assert_eq!(s.place_structure(GENRE_WIND, x, y), ToolResult::Ok);
    s.extensions_mut().energy_state.set(x, y, AGED);
    assert_eq!(s.accept_deal(POWER_OFFER_BASE + 2), DealResult::Done);
    (s, (x, y))
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

#[test]
fn rule_off_and_nothing_stored_is_the_file_it_always_was() {
    let pristine = file_of(&city());
    let mut s = city();
    s.set_structure_rules(true);
    s.set_energy_rules(true);
    let (x, y) = free_spot(&s, GENRE_WIND);
    assert_eq!(s.place_structure(GENRE_WIND, x, y), ToolResult::Ok);
    s.extensions_mut().energy_state.set(x, y, 3);
    s.set_energy_rules(false);
    s.set_structure_rules(false);
    s.total_funds = city().total_funds;
    assert!(!s.needs_extension_block());
    assert_eq!(file_of(&s), pristine);
}

#[test]
fn ages_and_electricity_deals_round_trip() {
    let (s, (x, y)) = with_energy();
    let file = file_of(&s);
    let back = loaded(&file);
    assert!(back.energy_rules() && back.structure_rules());
    assert_eq!(back.extensions().energy_state, s.extensions().energy_state);
    assert_eq!(back.extensions().energy_state.age_of(x, y), AGED);
    assert_eq!(back.energy_stats(), s.energy_stats());
    assert_eq!(back.energy_bought(), s.energy_bought());
    assert_eq!(back.deals().len(), 1);
    assert_eq!(back.deals()[0].resource, 3);
    // stable from the second save on
    let again = file_of(&back);
    assert_eq!(file_of(&loaded(&again)), again);
}

#[test]
fn the_energy_chunk_has_tag_10_and_is_the_last_one() {
    assert_eq!((CHUNK_ENERGY, CHUNK_MAX_TAG), (10, 10));
    let (s, _) = with_energy();
    let file = file_of(&s);
    let chunks = &file[block_at() + 4..];
    assert_eq!(chunks[0], CHUNK_RULES);
    let rules_len = u32::from_be_bytes([chunks[1], chunks[2], chunks[3], chunks[4]]) as usize;
    assert_eq!(rules_len, 2, "two rule bytes");
    assert_eq!(chunks[6] & 0b10, 0b10, "second byte, bit 1");
    let mut at = 5 + rules_len;
    let mut tags = Vec::new();
    while at < chunks.len() {
        tags.push(chunks[at]);
        let len = u32::from_be_bytes([
            chunks[at + 1],
            chunks[at + 2],
            chunks[at + 3],
            chunks[at + 4],
        ]);
        at += 5 + len as usize;
    }
    assert_eq!(tags.last(), Some(&CHUNK_ENERGY));
    assert!(tags.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn a_bad_chunk_is_refused_and_leaves_the_engine_untouched() {
    let (mut engine, _) = with_energy();
    let good = file_of(&engine);
    let rec = |x: u16, y: u16, m: u16| [x.to_be_bytes(), y.to_be_bytes(), m.to_be_bytes()].concat();
    let with = |n: u16, recs: &[Vec<u8>]| [n.to_be_bytes().to_vec(), recs.concat()].concat();
    let bad_chunks = [
        ("empty", chunk(CHUNK_ENERGY, &[])),
        ("cut count", chunk(CHUNK_ENERGY, &[0])),
        ("zero plants", chunk(CHUNK_ENERGY, &with(0, &[]))),
        ("record missing", chunk(CHUNK_ENERGY, &with(1, &[]))),
        (
            "extra bytes",
            chunk(CHUNK_ENERGY, &[with(1, &[rec(1, 1, 1)]), vec![0]].concat()),
        ),
        (
            "off the map",
            chunk(CHUNK_ENERGY, &with(1, &[rec(W as u16, 1, 5)])),
        ),
        (
            "out of order",
            chunk(CHUNK_ENERGY, &with(2, &[rec(6, 5, 1), rec(5, 9, 1)])),
        ),
        (
            "duplicate",
            chunk(CHUNK_ENERGY, &with(2, &[rec(5, 5, 1), rec(5, 5, 1)])),
        ),
    ];
    assert_eq!(RECORD_SIZE, 6);
    let before = file_of(&engine);
    for (name, chunks) in &bad_chunks {
        let file = with_chunks(&good, chunks);
        let err = engine.load_city(&file, 1).expect_err(name);
        assert_eq!(err.code(), "cty_bad_extension", "{name}");
        assert_eq!(file_of(&engine), before, "{name}");
    }
}

#[test]
fn a_loaded_city_is_made_consistent() {
    let (s, (x, y)) = with_energy();
    let good = file_of(&s);
    let ages = s.extensions().energy_state.encode();
    // a record for a plant that is not there goes; the real one stays
    let ghost = [
        2u16.to_be_bytes().to_vec(),
        [
            (x as u16).to_be_bytes(),
            (y as u16).to_be_bytes(),
            4u16.to_be_bytes(),
        ]
        .concat(),
        [
            ((W - 1) as u16).to_be_bytes(),
            ((H - 1) as u16).to_be_bytes(),
            9u16.to_be_bytes(),
        ]
        .concat(),
    ]
    .concat();
    let with_ghost = with_energy_chunk(&good, &ghost);
    let back = loaded(&with_ghost);
    assert_eq!(back.extensions().energy_state.as_slice().len(), 1);
    assert_eq!(back.extensions().energy_state.age_of(x, y), 4);
    assert_eq!(back.extensions().energy_state.age_of(W - 1, H - 1), 0);
    // the chunk is there but the rule is off: everything goes
    let mut off = good[..block_at()].to_vec();
    let rules_off = [chunk(CHUNK_RULES, &[0b1_0000]), chunk(CHUNK_ENERGY, &ages)].concat();
    off.extend_from_slice(&(rules_off.len() as u32).to_be_bytes());
    off.extend_from_slice(&rules_off);
    let back = loaded(&off);
    assert!(!back.energy_rules() && back.extensions().energy_state.is_empty());
}

/// `good` with the payload of its energy chunk (the last one) replaced.
fn with_energy_chunk(good: &[u8], payload: &[u8]) -> Vec<u8> {
    let start = block_at() + 4;
    let mut at = start;
    let mut kept = Vec::new();
    while at < good.len() {
        let len = u32::from_be_bytes([good[at + 1], good[at + 2], good[at + 3], good[at + 4]]);
        let end = at + 5 + len as usize;
        if good[at] != CHUNK_ENERGY {
            kept.extend_from_slice(&good[at..end]);
        }
        at = end;
    }
    kept.extend_from_slice(&chunk(CHUNK_ENERGY, payload));
    with_chunks(good, &kept)
}
