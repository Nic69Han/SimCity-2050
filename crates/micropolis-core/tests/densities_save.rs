//! The densities in a saved city (docs/game-design-v07.md): chunk 7 and the rules flag bit 5.
//! Rule off and no record = the file is what it always was; a record round-trips; a bad chunk
//! is `cty_bad_extension`; a loaded city is made consistent.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::densities::{
    DENSITY_DENSE, DENSITY_LIGHT, DENSITY_MEDIUM, GENRE_INDUSTRIAL, GENRE_RESIDENTIAL,
    MAX_DENSITY_ZONES, RECORD_SIZE,
};
use micropolis_core::extensions::{CHUNK_DENSITIES, CHUNK_MAX_TAG, CHUNK_RULES};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::simulation::Simulation;
use micropolis_core::tool::{EditingTool, ToolResult};
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

/// A free 3 x 3 spot for a zone, searching from column `from`.
fn free_spot(s: &Simulation, from: i32) -> (i32, i32) {
    let mut s = s.clone();
    s.set_density_rules(true);
    for x in from.max(2)..W - 3 {
        for y in 2..H - 3 {
            if s.zone_preview(GENRE_RESIDENTIAL, DENSITY_LIGHT, x, y)
                .result
                == ToolResult::Ok
            {
                return (x, y);
            }
        }
    }
    panic!("no free spot");
}

/// A city with a light residential, a medium industrial and a dense residential zone.
fn with_zones() -> Simulation {
    let mut s = city();
    s.set_density_rules(true);
    for (genre, density, from) in [
        (GENRE_RESIDENTIAL, DENSITY_LIGHT, 0),
        (GENRE_INDUSTRIAL, DENSITY_MEDIUM, 30),
        (GENRE_RESIDENTIAL, DENSITY_DENSE, 60),
    ] {
        let (x, y) = free_spot(&s, from);
        assert_eq!(s.place_zone(genre, density, x, y), ToolResult::Ok);
    }
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

fn record(x: u16, y: u16, density: u8) -> Vec<u8> {
    let mut v = x.to_be_bytes().to_vec();
    v.extend_from_slice(&y.to_be_bytes());
    v.push(density);
    v
}

fn version(file: &[u8]) -> u16 {
    u16::from_be_bytes([file[4], file[5]])
}

fn loaded(file: &[u8]) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(file, 1).expect("a file this crate wrote");
    s
}

#[test]
fn rule_off_and_no_record_is_the_file_it_always_was() {
    let pristine = file_of(&city());
    assert_eq!(version(&pristine), 1);
    // a zone placed with the rule on, the rule switched off again: the file of the classic zone
    let (x, y) = free_spot(&city(), 0);
    let mut classic = city();
    assert_eq!(
        classic.tool_down(EditingTool::Residential, x, y),
        ToolResult::Ok
    );
    let mut s = city();
    s.set_density_rules(true);
    assert_eq!(
        s.place_zone(GENRE_RESIDENTIAL, DENSITY_LIGHT, x, y),
        ToolResult::Ok
    );
    s.set_density_rules(false);
    s.total_funds = classic.total_funds;
    assert!(!s.needs_extension_block());
    assert_eq!(version(&file_of(&s)), 1);
    assert_eq!(file_of(&s), file_of(&classic));
    // and a rule never turned on changes nothing
    let mut untouched = city();
    untouched.set_density_rules(false);
    assert_eq!(file_of(&untouched), pristine);
}

#[test]
fn a_rule_on_without_a_record_saves_the_flag_only() {
    let mut s = city();
    s.set_density_rules(true);
    let file = file_of(&s);
    assert_eq!(version(&file), 3);
    assert_eq!(
        file.len(),
        file_of(&city()).len() + RELIEF_BLOCK_OVERHEAD + (W * H) as usize + 4 + 6
    );
    let back = loaded(&file);
    assert!(back.density_rules() && back.extensions().density_zones.is_empty());
}

#[test]
fn records_round_trip() {
    let s = with_zones();
    let file = file_of(&s);
    assert_eq!(version(&file), 3);
    let back = loaded(&file);
    assert!(back.density_rules());
    assert_eq!(
        back.extensions().density_zones,
        s.extensions().density_zones
    );
    assert_eq!(back.extensions().density_zones.len(), 2);
    let (before, after) = (s.density_stats(), back.density_stats());
    assert_eq!(before[..2], after[..2]);
    assert_eq!(after[..2], [1, 1], "one light and one medium zone");
    assert!(after[2] >= 2, "the classic zones are dense");
    // stable from the second save on (a load recomputes derived tile bits)
    let again = file_of(&back);
    assert_eq!(file_of(&loaded(&again)), again);
}

#[test]
fn the_densities_chunk_follows_the_buildings_chunk_in_tag_order() {
    assert_eq!(CHUNK_DENSITIES, 7);
    assert_eq!(CHUNK_MAX_TAG, CHUNK_DENSITIES);
    let file = file_of(&with_zones());
    let chunks = &file[block_at() + 4..];
    assert_eq!(chunks[0], CHUNK_RULES);
    let rules_len = u32::from_be_bytes([chunks[1], chunks[2], chunks[3], chunks[4]]) as usize;
    assert_eq!(chunks[5] & 0b10_0000, 0b10_0000);
    let next = &chunks[5 + rules_len..];
    assert_eq!(next[0], CHUNK_DENSITIES);
    assert_eq!(
        u32::from_be_bytes([next[1], next[2], next[3], next[4]]) as usize,
        2 * RECORD_SIZE
    );
}

#[test]
fn a_bad_chunk_is_refused_and_leaves_the_engine_untouched() {
    let good = file_of(&with_zones());
    let bad_chunks = [
        ("cut record", chunk(CHUNK_DENSITIES, &[1, 0, 0])),
        ("density zero", chunk(CHUNK_DENSITIES, &record(5, 5, 0))),
        (
            "dense is not recorded",
            chunk(CHUNK_DENSITIES, &record(5, 5, 3)),
        ),
        ("unknown density", chunk(CHUNK_DENSITIES, &record(5, 5, 9))),
        (
            "off the map",
            chunk(CHUNK_DENSITIES, &record(W as u16 - 1, 5, 1)),
        ),
        (
            "out of order",
            chunk(
                CHUNK_DENSITIES,
                &[record(9, 5, 1), record(5, 5, 1)].concat(),
            ),
        ),
        (
            "repeated",
            chunk(
                CHUNK_DENSITIES,
                &[record(5, 5, 1), record(5, 5, 2)].concat(),
            ),
        ),
        (
            "too many",
            chunk(
                CHUNK_DENSITIES,
                &(0..=MAX_DENSITY_ZONES as u16)
                    .flat_map(|i| record(1 + i % 90, 1 + i / 90, 1))
                    .collect::<Vec<_>>(),
            ),
        ),
        ("unknown tag", chunk(9, &[1])),
    ];
    let mut engine = with_zones();
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
    let s = with_zones();
    let good = file_of(&s);
    let rec = s.extensions().density_zones.as_slice()[0];
    let rules_only = chunk(CHUNK_RULES, &[0b10_0000]);
    // a record naming a tile that is no zone centre goes
    let (gx, gy) = free_spot(&s, 0);
    let ghost = chunk(CHUNK_DENSITIES, &record(gx as u16, gy as u16, 1));
    let back = loaded(&with_chunks(&good, &[rules_only.clone(), ghost].concat()));
    assert!(back.density_rules());
    assert!(back.extensions().density_zones.is_empty());
    // the real record stays
    let real = chunk(
        CHUNK_DENSITIES,
        &record(rec.x as u16, rec.y as u16, rec.density),
    );
    let back = loaded(&with_chunks(&good, &[rules_only, real.clone()].concat()));
    assert_eq!(back.extensions().density_zones.len(), 1);
    // the rule is off but the chunk lists a zone: it goes
    let back = loaded(&with_chunks(&good, &real));
    assert!(!back.density_rules() && back.extensions().density_zones.is_empty());
    assert!(!back.needs_extension_block());
}
