//! The waste in a saved city (docs/game-design-v08.md): chunk 8 and the rules flag bit 6. Rule off
//! and nothing stored = the file is what it always was; piles, landfill fills and waste deals
//! round-trip; a bad chunk is `cty_bad_extension`; a loaded city is made consistent.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::deals::{DealResult, WASTE_OFFER_BASE};
use micropolis_core::extensions::{CHUNK_MAX_TAG, CHUNK_RULES, CHUNK_WASTE};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::simulation::Simulation;
use micropolis_core::tool::ToolResult;
use micropolis_core::waste::{GENRE_LANDFILL, LANDFILL_CAPACITY};
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

fn free_spot(s: &Simulation, genre: u8) -> (i32, i32) {
    for x in 0..W - 3 {
        for y in 0..H - 3 {
            if s.structure_preview(genre, x, y).result == ToolResult::Ok {
                return (x, y);
            }
        }
    }
    panic!("no free spot");
}

/// Waste and structure rules on, a landfill with a fill, piles on two tiles, a waste deal.
fn with_waste() -> (Simulation, (i32, i32)) {
    let mut s = city();
    s.set_structure_rules(true);
    s.set_waste_rules(true);
    s.set_deals_rules(true);
    let (x, y) = free_spot(&s, GENRE_LANDFILL);
    assert_eq!(s.place_structure(GENRE_LANDFILL, x, y), ToolResult::Ok);
    let state = &mut s.extensions_mut().waste_state;
    state.set_fill(x, y, 1234);
    state.set_pile(3 * H as u32 + 4, 200);
    state.set_pile(50 * H as u32 + 9, 255);
    assert_eq!(s.accept_deal(WASTE_OFFER_BASE + 3), DealResult::Done);
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
    s.set_waste_rules(true);
    let (x, y) = free_spot(&s, GENRE_LANDFILL);
    assert_eq!(s.place_structure(GENRE_LANDFILL, x, y), ToolResult::Ok);
    s.extensions_mut().waste_state.set_fill(x, y, 10);
    assert_eq!(s.remove_structure(x, y), ToolResult::Ok);
    s.set_waste_rules(false);
    s.set_structure_rules(false);
    s.total_funds = city().total_funds;
    assert!(!s.needs_extension_block());
    assert_eq!(file_of(&s), pristine);
}

#[test]
fn piles_fills_and_waste_deals_round_trip() {
    let (s, (x, y)) = with_waste();
    let file = file_of(&s);
    let back = loaded(&file);
    assert!(back.waste_rules() && back.structure_rules());
    assert_eq!(back.extensions().waste_state, s.extensions().waste_state);
    assert_eq!(back.extensions().waste_state.fill_at(x, y), 1234);
    assert_eq!(back.waste_layer(), s.waste_layer());
    assert_eq!(back.deals().len(), 1);
    assert_eq!(back.deals()[0].resource, 2);
    // stable from the second save on
    let again = file_of(&back);
    assert_eq!(file_of(&loaded(&again)), again);
}

#[test]
fn the_waste_chunk_has_tag_8_and_follows_the_densities_chunk() {
    assert_eq!(
        (CHUNK_WASTE, CHUNK_MAX_TAG),
        (8, 11),
        "the economy chunk (v0.11) is the last"
    );
    let (s, _) = with_waste();
    let file = file_of(&s);
    let chunks = &file[block_at() + 4..];
    assert_eq!(chunks[0], CHUNK_RULES);
    let rules_len = u32::from_be_bytes([chunks[1], chunks[2], chunks[3], chunks[4]]) as usize;
    assert_eq!(chunks[5] & 0b100_0000, 0b100_0000, "bit 6");
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
    assert_eq!(tags.last(), Some(&CHUNK_WASTE));
    assert!(tags.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn a_bad_chunk_is_refused_and_leaves_the_engine_untouched() {
    let (mut engine, _) = with_waste();
    let good = file_of(&engine);
    let tile = |x: u16, y: u16, u: u8| {
        [x.to_be_bytes(), y.to_be_bytes()]
            .concat()
            .into_iter()
            .chain([u])
            .collect::<Vec<u8>>()
    };
    let fill = |x: u16, y: u16, u: u32| {
        [x.to_be_bytes(), y.to_be_bytes()]
            .concat()
            .into_iter()
            .chain(u.to_be_bytes())
            .collect::<Vec<u8>>()
    };
    let cap = LANDFILL_CAPACITY as u32;
    let bad_chunks = [
        ("empty", chunk(CHUNK_WASTE, &[])),
        ("cut count", chunk(CHUNK_WASTE, &[0])),
        ("cut tile", chunk(CHUNK_WASTE, &[0, 0, 1, 2, 3])),
        ("fill missing", chunk(CHUNK_WASTE, &[0, 1])),
        (
            "fill off the map",
            chunk(
                CHUNK_WASTE,
                &[&[0u8, 1][..], &fill(W as u16, 1, 5)].concat(),
            ),
        ),
        (
            "fill zero",
            chunk(CHUNK_WASTE, &[&[0u8, 1][..], &fill(1, 1, 0)].concat()),
        ),
        (
            "fill over capacity",
            chunk(CHUNK_WASTE, &[&[0u8, 1][..], &fill(1, 1, cap + 1)].concat()),
        ),
        (
            "tile off the map",
            chunk(
                CHUNK_WASTE,
                &[&[0u8, 0][..], &tile(1, H as u16, 5)].concat(),
            ),
        ),
        (
            "tile empty",
            chunk(CHUNK_WASTE, &[&[0u8, 0][..], &tile(1, 1, 0)].concat()),
        ),
        (
            "tiles out of order",
            chunk(
                CHUNK_WASTE,
                &[&[0u8, 0][..], &tile(2, 1, 5), &tile(1, 1, 5)].concat(),
            ),
        ),
        ("unknown tag", chunk(9, &[1])),
    ];
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
    let (s, (x, y)) = with_waste();
    let good = file_of(&s);
    let waste = s.extensions().waste_state.encode(H);
    // the rule bits name waste and structures, but no building: the fill of a missing landfill goes
    let rules = chunk(CHUNK_RULES, &[0b101_0000]);
    let lone = [rules.clone(), chunk(CHUNK_WASTE, &waste)].concat();
    let back = loaded(&with_chunks(&good, &lone));
    assert!(back.extensions().waste_state.fills().is_empty());
    assert!(
        back.extensions().waste_state.pile_total() > 0,
        "the pile stays"
    );
    // the chunk is there but the rule is off: everything goes
    let off = [chunk(CHUNK_RULES, &[0b1_0000]), chunk(CHUNK_WASTE, &waste)].concat();
    let back = loaded(&with_chunks(&good, &off));
    assert!(!back.waste_rules() && back.extensions().waste_state.is_empty());
    assert_eq!(back.extensions().waste_state.fill_at(x, y), 0);
}
