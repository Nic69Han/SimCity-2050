//! The highways in a saved city (docs/game-design-v13.md): chunk 13 and the second rules byte
//! bit 5. Rule off and nothing stored = the file is what it always was; the tiles round-trip; a
//! bad chunk is `cty_bad_extension`; a loaded city is made consistent.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::extensions::{CHUNK_HIGHWAYS, CHUNK_RULES};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::highways::is_highway_road;
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::ROADS;
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

fn road_tiles(s: &Simulation, n: usize) -> Vec<(i32, i32)> {
    let (w, h) = s.world_size();
    let all = (0..w).flat_map(|x| (0..h).map(move |y| (x, y)));
    all.filter(|&(x, y)| s.tile(x, y).is_some_and(is_highway_road))
        .take(n)
        .collect()
}

fn with_highways() -> (Simulation, Vec<(i32, i32)>) {
    let mut s = city();
    s.set_highway_rules(true);
    let roads = road_tiles(&s, 6);
    assert_eq!(roads.len(), 6, "the starter city has roads");
    for &(x, y) in &roads {
        assert_eq!(s.place_highway(x, y) as i32, 1);
    }
    (s, roads)
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
    let mut pristine = city();
    pristine.total_funds = 0;
    let (mut s, _) = with_highways();
    s.set_highway_rules(false);
    s.total_funds = 0;
    assert!(!s.needs_extension_block());
    assert_eq!(file_of(&s), file_of(&pristine));
}

#[test]
fn the_rule_alone_is_two_rule_bytes_and_no_chunk_13() {
    let mut s = city();
    s.set_highway_rules(true);
    let file = file_of(&s);
    let chunks = &file[block_at() + 4..];
    assert_eq!(chunks[0], CHUNK_RULES);
    assert_eq!(chunks[6] & 0b10_0000, 0b10_0000, "second byte, bit 5");
    assert_eq!(chunks.len(), 7);
    assert!(loaded(&file).highway_rules());
}

#[test]
fn the_tiles_round_trip_in_chunk_13_sorted() {
    let (s, roads) = with_highways();
    let file = file_of(&s);
    let chunks = &file[block_at() + 4..];
    assert_eq!(chunks[7], CHUNK_HIGHWAYS);
    let len = u32::from_be_bytes([chunks[8], chunks[9], chunks[10], chunks[11]]) as usize;
    assert_eq!(len, 2 + 4 * roads.len());
    let back = loaded(&file);
    assert!(back.highway_rules());
    assert_eq!(back.extensions().highway_list, s.extensions().highway_list);
    assert_eq!(back.highway_stats(), s.highway_stats());
    assert_eq!(back.highway_layer(), s.highway_layer());
    let again = file_of(&back);
    assert_eq!(
        file_of(&loaded(&again)),
        again,
        "stable from the second save on"
    );
}

#[test]
fn a_bad_chunk_is_refused_and_leaves_the_engine_untouched() {
    let (mut engine, _) = with_highways();
    let good = file_of(&engine);
    let before = file_of(&engine);
    let bad = [
        ("empty", chunk(CHUNK_HIGHWAYS, &[])),
        ("one byte", chunk(CHUNK_HIGHWAYS, &[0])),
        ("zero tiles", chunk(CHUNK_HIGHWAYS, &[0, 0])),
        ("count without tiles", chunk(CHUNK_HIGHWAYS, &[0, 1])),
        ("cut tile", chunk(CHUNK_HIGHWAYS, &[0, 1, 0, 1, 0, 1, 0])),
        (
            "extra byte",
            chunk(CHUNK_HIGHWAYS, &[0, 1, 0, 1, 0, 1, 0, 0]),
        ),
        ("off the map", chunk(CHUNK_HIGHWAYS, &[0, 1, 0, 200, 0, 1])),
        (
            "unsorted",
            chunk(CHUNK_HIGHWAYS, &[0, 2, 0, 5, 0, 5, 0, 4, 0, 5]),
        ),
        (
            "duplicate",
            chunk(CHUNK_HIGHWAYS, &[0, 2, 0, 5, 0, 5, 0, 5, 0, 5]),
        ),
        ("too many", chunk(CHUNK_HIGHWAYS, &[0x10, 1, 0, 1, 0, 1])),
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
fn a_loaded_city_is_made_consistent() {
    let (s, roads) = with_highways();
    let good = file_of(&s);
    // stored while the rule is off (no rules chunk): forgotten
    let one = chunk(
        CHUNK_HIGHWAYS,
        &[0, 1, 0, roads[0].0 as u8, 0, roads[0].1 as u8],
    );
    let back = loaded(&with_chunks(&good, &one));
    assert!(!back.highway_rules() && back.extensions().highway_list.is_empty());
    // the road under a stored highway is gone: the highway is dropped
    let mut t = s.clone();
    let (x, y) = roads[2];
    t.set_tile(x, y, 0);
    let back = loaded(&file_of(&t));
    assert_eq!(back.highway_stats()[0], roads.len() as i32 - 1);
    assert!(!back.is_highway(x, y));
    // a tile that is a bridge, not a road a highway may lie on: dropped as well
    let mut u = s.clone();
    u.set_tile(roads[0].0, roads[0].1, ROADS - 2);
    assert!(!loaded(&file_of(&u)).is_highway(roads[0].0, roads[0].1));
}
