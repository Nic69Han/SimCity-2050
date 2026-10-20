//! The services in a saved city (docs/game-design-v09.md): bit 0 of the second byte of the rules
//! chunk and chunk 9. Rule off = the file is what it always was; a city round-trips; a bad chunk
//! is `cty_bad_extension`.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::extensions::{CHUNK_MAX_TAG, CHUNK_RULES, CHUNK_SERVICES};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::services::{GENRE_CLINIC, GENRE_SCHOOL};
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::PWRBIT;
use micropolis_core::tool::ToolResult;
use support::{file_of, run};

const W: i32 = 97;
const H: i32 = 83;

fn base() -> Simulation {
    let mut s = Simulation::new(W, H);
    s.new_random_city(3);
    support::starter(&mut s);
    run(&mut s, 10);
    s.total_funds = 1_000_000;
    s
}

fn loaded(file: &[u8]) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(file, 1).expect("a file this crate wrote");
    s
}

fn power(s: &mut Simulation, x: i32, y: i32, size: i32) {
    for dx in 0..size {
        for dy in 0..size {
            let t = s.tile(x + dx, y + dy).unwrap();
            s.set_tile(x + dx, y + dy, t | PWRBIT);
        }
    }
}

/// A bare city with a zone, a powered school and a powered clinic, and numbers that have moved.
fn served() -> Simulation {
    let mut s = Simulation::new(W, H);
    s.tiles.fill(micropolis_core::tile_chars::DIRT);
    s.total_funds = 1_000_000;
    s.set_structure_rules(true);
    s.set_service_rules(true);
    s.res_plop(micropolis_core::position::Position::new(40, 30), 3, 0);
    for (genre, size, x) in [(GENRE_SCHOOL, 2, 36), (GENRE_CLINIC, 1, 44)] {
        assert_eq!(s.place_structure(genre, x, 30), ToolResult::Ok);
        power(&mut s, x, 30, size);
    }
    for _ in 0..6 {
        s.city_time += 4;
        s.ext_valves();
    }
    s
}

fn chunk_tags(file: &[u8], w: i32, h: i32) -> Vec<(u8, usize)> {
    let at = CITY_FILE_HEADER_SIZE
        + 2 * (6 * 240 + 120 + (w * h) as usize)
        + RELIEF_BLOCK_OVERHEAD
        + (w * h) as usize;
    let len = u32::from_be_bytes(file[at..at + 4].try_into().unwrap()) as usize;
    let mut out = Vec::new();
    let mut i = at + 4;
    while i < at + 4 + len {
        let size = u32::from_be_bytes(file[i + 1..i + 5].try_into().unwrap()) as usize;
        out.push((file[i], size));
        i += 5 + size;
    }
    out
}

#[test]
fn the_new_tag_is_accepted() {
    assert_eq!(CHUNK_SERVICES, 9);
    assert_eq!(CHUNK_MAX_TAG, 9);
}

#[test]
fn rule_off_the_file_is_the_one_without_services() {
    let plain = base();
    let mut toggled = base();
    toggled.set_service_rules(true);
    toggled.set_service_rules(false);
    assert_eq!(file_of(&plain), file_of(&toggled));
    // with the structures on, services off: still no second byte, no chunk 9
    let mut a = base();
    a.set_structure_rules(true);
    let mut b = base();
    b.set_structure_rules(true);
    b.set_service_rules(true);
    b.set_service_rules(false);
    assert_eq!(file_of(&a), file_of(&b));
    let tags = chunk_tags(&file_of(&a), W, H);
    assert!(tags.contains(&(CHUNK_RULES, 1)) && tags.iter().all(|t| t.0 != CHUNK_SERVICES));
}

#[test]
fn the_rule_alone_adds_a_second_byte_and_no_chunk_9() {
    let mut s = base();
    s.set_structure_rules(true);
    s.set_service_rules(true);
    let tags = chunk_tags(&file_of(&s), W, H);
    assert!(tags.contains(&(CHUNK_RULES, 2)));
    assert!(
        tags.iter().all(|t| t.0 != CHUNK_SERVICES),
        "start values are not stored"
    );
    let back = loaded(&file_of(&s));
    assert!(back.service_rules() && back.structure_rules());
}

#[test]
fn a_city_round_trips_with_its_numbers_and_buildings() {
    let s = served();
    assert!(s.education_quotient() > 0 && s.life_expectancy() > 50);
    let file = file_of(&s);
    assert!(chunk_tags(&file, W, H).contains(&(CHUNK_SERVICES, 2)));
    let back = loaded(&file);
    assert!(back.service_rules() && back.structure_rules());
    assert_eq!(back.education_quotient(), s.education_quotient());
    assert_eq!(back.life_expectancy(), s.life_expectancy());
    assert_eq!(back.structures(), s.structures());
    // the classic loader settles the zone tiles, so the coverage is compared by its buildings
    assert_eq!(back.coverage_layer(0)[(36 * H + 30) as usize], 255);
    assert_eq!(chunk_tags(&file_of(&back), W, H), chunk_tags(&file, W, H));
}

#[test]
fn two_loads_of_one_file_continue_identically() {
    let file = file_of(&served());
    let (mut a, mut b) = (loaded(&file), loaded(&file));
    run(&mut a, 200);
    run(&mut b, 200);
    assert_eq!(a.education_quotient(), b.education_quotient());
    assert_eq!(a.life_expectancy(), b.life_expectancy());
    assert_eq!(file_of(&a), file_of(&b));
}

#[test]
fn loading_a_city_without_services_resets_the_numbers() {
    let mut s = served();
    let plain = file_of(&base());
    s.load_city(&plain, 1).unwrap();
    assert!(!s.service_rules());
    assert_eq!((s.education_quotient(), s.life_expectancy()), (0, 50));
}
