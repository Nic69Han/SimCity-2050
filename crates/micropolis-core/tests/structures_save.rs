//! The buildings in a saved city (docs/game-design-v04.md): chunk 6 and the rules flag bit 4.
//! Rule off and no building = the file is what it always was; a building round-trips; a bad
//! chunk is `cty_bad_extension`; a loaded city is made consistent.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::extensions::{CHUNK_MAX_TAG, CHUNK_RULES, CHUNK_STRUCTURES};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::simulation::Simulation;
use micropolis_core::structures::{
    GENRE_MONUMENT, GENRE_PARK, GENRE_PLAZA, RECORD_SIZE, SURFACE_TILE,
};
use micropolis_core::tile_chars::DIRT;
use micropolis_core::tool::ToolResult;
use support::{file_of, run};

const W: i32 = 97;
const H: i32 = 83;

fn city() -> Simulation {
    let mut s = Simulation::new(W, H);
    s.new_random_city(3);
    support::starter(&mut s);
    run(&mut s, 10);
    s.total_funds = 1_000_000;
    s
}

fn free_spot(s: &Simulation, genre: u8, from: i32) -> (i32, i32) {
    for x in from..W - 3 {
        for y in 0..H - 3 {
            if s.structure_preview(genre, x, y).result == ToolResult::Ok {
                return (x, y);
            }
        }
    }
    panic!("no free spot");
}

fn with_buildings() -> Simulation {
    let mut s = city();
    s.set_structure_rules(true);
    for (genre, from) in [(GENRE_PARK, 0), (GENRE_PLAZA, 30), (GENRE_MONUMENT, 60)] {
        let (x, y) = free_spot(&s, genre, from);
        assert_eq!(s.place_structure(genre, x, y), ToolResult::Ok);
    }
    s
}

fn version(file: &[u8]) -> u16 {
    u16::from_be_bytes([file[4], file[5]])
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

fn record(genre: u8, x: u16, y: u16) -> Vec<u8> {
    let mut v = vec![genre];
    v.extend_from_slice(&x.to_be_bytes());
    v.extend_from_slice(&y.to_be_bytes());
    v
}

#[test]
fn rule_off_and_no_building_is_the_file_it_always_was() {
    let pristine = file_of(&city());
    assert_eq!(version(&pristine), 1);
    // a building placed and removed, the rule switched off again: same file
    let mut s = city();
    s.set_structure_rules(true);
    let (x, y) = free_spot(&s, GENRE_MONUMENT, 0);
    assert_eq!(s.place_structure(GENRE_MONUMENT, x, y), ToolResult::Ok);
    assert_eq!(s.remove_structure(x, y), ToolResult::Ok);
    s.set_structure_rules(false);
    s.total_funds = city().total_funds;
    assert!(!s.needs_extension_block());
    assert_eq!(file_of(&s), pristine);
}

#[test]
fn a_rule_on_without_building_saves_the_flag_only() {
    let mut s = city();
    s.set_structure_rules(true);
    let file = file_of(&s);
    assert_eq!(version(&file), 3);
    assert_eq!(
        file.len(),
        file_of(&city()).len() + RELIEF_BLOCK_OVERHEAD + (W * H) as usize + 4 + 6
    );
    let back = loaded(&file);
    assert!(back.structure_rules() && back.structures().is_empty());
}

#[test]
fn buildings_round_trip() {
    let s = with_buildings();
    let file = file_of(&s);
    assert_eq!(version(&file), 3);
    let back = loaded(&file);
    assert!(back.structure_rules());
    assert_eq!(back.structures(), s.structures());
    assert_eq!(back.structures().len(), 3);
    assert_eq!(
        back.extensions().structure_list,
        s.extensions().structure_list
    );
    // the surface tiles are the saved ones; a load recomputes derived tile bits (power), so
    // the file is stable from the second save on
    for v in back.structures() {
        for dx in 0..v.width {
            for dy in 0..v.height {
                let t = back.tile(v.x + dx, v.y + dy).unwrap();
                assert_eq!(t & 0x3ff, SURFACE_TILE);
            }
        }
    }
    let again = file_of(&back);
    assert_eq!(file_of(&loaded(&again)), again);
}

#[test]
fn the_buildings_chunk_follows_the_deals_chunk_in_tag_order() {
    assert_eq!(CHUNK_STRUCTURES, 6);
    assert_eq!(CHUNK_MAX_TAG, micropolis_core::extensions::CHUNK_REWARDS);
    let file = file_of(&with_buildings());
    let chunks = &file[block_at() + 4..];
    assert_eq!(chunks[0], CHUNK_RULES);
    let rules_len = u32::from_be_bytes([chunks[1], chunks[2], chunks[3], chunks[4]]) as usize;
    assert_eq!(chunks[5] & 0b1_0000, 0b1_0000);
    let next = &chunks[5 + rules_len..];
    assert_eq!(next[0], CHUNK_STRUCTURES);
    assert_eq!(
        u32::from_be_bytes([next[1], next[2], next[3], next[4]]) as usize,
        3 * RECORD_SIZE
    );
}

#[test]
fn a_bad_chunk_is_refused_and_leaves_the_engine_untouched() {
    let good = file_of(&with_buildings());
    let bad_chunks = [
        ("cut record", chunk(CHUNK_STRUCTURES, &[1, 0, 0])),
        ("unknown genre", chunk(CHUNK_STRUCTURES, &record(9, 5, 5))),
        ("genre zero", chunk(CHUNK_STRUCTURES, &record(0, 5, 5))),
        (
            "off the map",
            chunk(CHUNK_STRUCTURES, &record(GENRE_MONUMENT, W as u16 - 2, 5)),
        ),
        (
            "overlap",
            chunk(
                CHUNK_STRUCTURES,
                &[record(GENRE_PARK, 5, 5), record(GENRE_PLAZA, 6, 6)].concat(),
            ),
        ),
        (
            "too many",
            chunk(
                CHUNK_STRUCTURES,
                &(0..257u16)
                    .flat_map(|i| record(GENRE_PLAZA, i % 90, i / 90))
                    .collect::<Vec<_>>(),
            ),
        ),
        ("unknown tag", chunk(9, &[1])),
    ];
    let mut engine = with_buildings();
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
    let good = file_of(&with_buildings());
    let s = with_buildings();
    let first = s.structures()[0];
    // the buildings chunk names nothing: the surface tiles in the map are owned by nobody
    let rules_only = chunk(CHUNK_RULES, &[0b1_0000]);
    let back = loaded(&with_chunks(&good, &rules_only));
    assert!(back.structures().is_empty());
    assert_eq!(back.tile(first.x, first.y).map(|t| t & 0x3ff), Some(DIRT));
    // the rule is off but the chunk lists buildings: they go
    let off = chunk(CHUNK_STRUCTURES, &s.extensions().structure_list.encode());
    let back = loaded(&with_chunks(&good, &off));
    assert!(!back.structure_rules() && back.structures().is_empty());
    assert_eq!(back.tile(first.x, first.y).map(|t| t & 0x3ff), Some(DIRT));
    assert!(!back.needs_extension_block());
}
