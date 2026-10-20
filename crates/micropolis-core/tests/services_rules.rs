//! The public services (docs/game-design-v09.md): switches, coverage and capacity, the EQ and
//! the life expectancy (rise, fall, target, bounds), the four hooks and their caps, upkeep.
//! Rule off = the original engine.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::position::Position;
use micropolis_core::services::{
    EQ_MAX, EQ_STEP, GENRE_CLINIC, GENRE_COLLEGE, GENRE_HOSPITAL, GENRE_LIBRARY, GENRE_MUSEUM,
    GENRE_PRISON, GENRE_SCHOOL, LIFE_BASE, LIFE_MAX, LIFE_STEP, POLLUTION_CUT_MAX_PCT,
    PRISON_CRIME_CUT_MAX_PCT, PRISON_CRIME_CUT_PCT, PRISON_LAND_MALUS, PRISON_LAND_MALUS_CAP,
    SERVICES, VALVE_PUSH_CEILING,
};
use micropolis_core::simulation::Simulation;
use micropolis_core::structures::kind_of;
use micropolis_core::tile::PWRBIT;
use micropolis_core::tile_chars::DIRT;
use micropolis_core::tool::ToolResult;
use support::{run, state};

const MONEY: i64 = 10_000_000;
const RES_DENSITY: i32 = 3; // a zone of 40 residents
const ZONE_POP: i32 = 40;

fn bare() -> Simulation {
    let mut s = Simulation::new(90, 70);
    s.tiles.fill(DIRT);
    s.total_funds = MONEY;
    s.set_structure_rules(true);
    s.set_service_rules(true);
    s
}

/// A residential zone of [`ZONE_POP`] residents centred on `(x, y)`.
fn zone(s: &mut Simulation, x: i32, y: i32) {
    s.res_plop(Position::new(x, y), RES_DENSITY, 0);
}

/// Marks every tile of a building powered, as the power scan does.
fn power(s: &mut Simulation, genre: u8, x: i32, y: i32) {
    let k = kind_of(genre).unwrap();
    for dx in 0..k.width {
        for dy in 0..k.height {
            let t = s.tile(x + dx, y + dy).unwrap();
            s.set_tile(x + dx, y + dy, t | PWRBIT);
        }
    }
}

/// Places a powered building.
fn build(s: &mut Simulation, genre: u8, x: i32, y: i32) {
    assert_eq!(s.place_structure(genre, x, y), ToolResult::Ok, "{genre}");
    power(s, genre, x, y);
}

/// `n` months pass, each followed by the valves hook.
fn months(s: &mut Simulation, n: usize) {
    for _ in 0..n {
        s.city_time += 4;
        s.ext_valves();
    }
}

fn layer_at(s: &Simulation, kind: i32, x: i32, y: i32) -> u8 {
    s.coverage_layer(kind)[(x * 70 + y) as usize]
}

#[test]
fn the_buildings_are_refused_while_the_rule_or_the_structures_are_off() {
    let mut s = Simulation::new(90, 70);
    s.tiles.fill(DIRT);
    s.total_funds = MONEY;
    for g in 30..=36 {
        assert_eq!(s.place_structure(g, 20, 20), ToolResult::Failed);
    }
    s.set_structure_rules(true);
    assert!(!s.service_rules());
    for g in 30..=36 {
        assert_eq!(s.place_structure(g, 20, 20), ToolResult::Failed, "rule off");
    }
    s.set_service_rules(true);
    assert_eq!(s.place_structure(GENRE_SCHOOL, 20, 20), ToolResult::Ok);
    assert_eq!(s.total_funds, MONEY - 500);
    s.set_structure_rules(false);
    assert!(!s.services_active());
    assert_eq!(s.service_stats(), [0; 10]);
    assert!((0..3).all(|k| s.coverage_layer(k).iter().all(|&v| v == 0)));
}

#[test]
fn rule_on_without_a_building_is_the_original_engine() {
    let make = |on: bool| {
        let mut s = Simulation::new(120, 100);
        s.new_random_city(7);
        support::starter(&mut s);
        s.set_structure_rules(on);
        s.set_service_rules(on);
        run(&mut s, 400);
        s
    };
    assert_eq!(state(&make(false)), state(&make(true)));
}

#[test]
fn switching_off_removes_the_service_buildings_and_forgets_the_numbers() {
    let mut s = bare();
    zone(&mut s, 30, 30);
    build(&mut s, GENRE_SCHOOL, 28, 33);
    months(&mut s, 3);
    assert!(s.education_quotient() > 0);
    s.set_service_rules(false);
    assert!(s.structures().is_empty());
    assert_eq!(
        (s.education_quotient(), s.life_expectancy()),
        (0, LIFE_BASE)
    );
}

#[test]
fn coverage_is_full_at_the_footprint_falls_off_and_stops_past_the_radius() {
    let mut s = bare();
    build(&mut s, GENRE_SCHOOL, 40, 30); // radius 8
    zone(&mut s, 38, 30);
    assert_eq!(layer_at(&s, 0, 40, 30), 255);
    let near = layer_at(&s, 0, 44, 30);
    let far = layer_at(&s, 0, 48, 30);
    assert!(255 > near && near > far && far > 0);
    assert_eq!(layer_at(&s, 0, 50, 30), 0, "past the radius (8 + 1 wide)");
    assert_eq!(layer_at(&s, 0, 20, 30), 0);
    // the other kinds are empty, so is an unknown kind
    for kind in [1, 2, -1, 3, 99] {
        assert!(s.coverage_layer(kind).iter().all(|&v| v == 0), "{kind}");
    }
    assert_eq!(s.coverage_layer(0).len(), 90 * 70);
}

#[test]
fn an_unpowered_building_covers_nothing() {
    let mut s = bare();
    zone(&mut s, 30, 30);
    assert_eq!(s.place_structure(GENRE_SCHOOL, 32, 30), ToolResult::Ok);
    assert!(s.coverage_layer(0).iter().all(|&v| v == 0));
    assert_eq!(s.service_stats()[2], 0);
    power(&mut s, GENRE_SCHOOL, 32, 30);
    assert_eq!(layer_at(&s, 0, 32, 30), 255);
    assert_eq!(s.service_stats()[2], ZONE_POP);
}

#[test]
fn the_capacity_is_shared_among_the_residents_it_covers() {
    let mut s = bare();
    // 5 zones x 40 = 200 residents for a school of 150 places
    for x in [34, 36, 38, 40, 42] {
        zone(&mut s, x, 28);
    }
    build(&mut s, GENRE_SCHOOL, 38, 31);
    let st = s.service_stats();
    assert_eq!((st[2], st[3]), (150, 150));
    // saturated: three quarters of what it covers get a place
    assert_eq!(layer_at(&s, 0, 38, 31), (255 * 150 / 200) as u8);
    // a second school takes the zone nearest to it: 160 residents for the first, 40 for the second
    build(&mut s, GENRE_SCHOOL, 44, 31);
    let st = s.service_stats();
    assert_eq!((st[2], st[3]), (150 + 40, 300));
}

#[test]
fn the_nearest_building_serves_a_zone_and_a_tie_goes_to_the_oldest() {
    let mut s = bare();
    zone(&mut s, 40, 30);
    build(&mut s, GENRE_SCHOOL, 33, 30);
    build(&mut s, GENRE_SCHOOL, 45, 30); // as far as the first one
    let one = s.service_stats()[2];
    assert_eq!(one, ZONE_POP, "served once, not twice");
    // the oldest school got the zone: a saturated newer one does not change the count
    s.remove_structure(33, 30);
    assert_eq!(s.service_stats()[2], ZONE_POP);
    s.remove_structure(45, 30);
    assert_eq!(s.service_stats()[2], 0);
}

#[test]
fn a_zone_out_of_every_radius_is_not_served() {
    let mut s = bare();
    zone(&mut s, 10, 10);
    build(&mut s, GENRE_HOSPITAL, 60, 50);
    assert_eq!(s.service_stats()[4], 0);
    assert_eq!(s.service_stats()[5], 400);
}

#[test]
fn the_eq_climbs_by_bounded_steps_to_its_target_and_stays_there() {
    let mut s = bare();
    zone(&mut s, 40, 30);
    // all four education buildings around the one zone: coverage 100 percent
    build(&mut s, GENRE_SCHOOL, 36, 30);
    build(&mut s, GENRE_COLLEGE, 36, 34);
    build(&mut s, GENRE_LIBRARY, 44, 30);
    build(&mut s, GENRE_MUSEUM, 44, 34);
    assert_eq!(s.service_targets().0, EQ_MAX);
    assert_eq!(s.service_stats()[8], 100);
    let mut last = 0;
    months(&mut s, 1); // the first pass only measures
    assert_eq!(s.education_quotient(), 0);
    for _ in 0..(EQ_MAX / EQ_STEP + 5) {
        months(&mut s, 1);
        let eq = s.education_quotient();
        assert!((0..=EQ_STEP).contains(&(eq - last)));
        assert!(eq <= EQ_MAX);
        last = eq;
    }
    assert_eq!(last, EQ_MAX);
    months(&mut s, 10);
    assert_eq!(s.education_quotient(), EQ_MAX);
}

#[test]
fn a_partial_education_gives_a_partial_target_and_the_eq_falls_back() {
    let mut s = bare();
    zone(&mut s, 40, 30);
    build(&mut s, GENRE_SCHOOL, 36, 30);
    assert_eq!(s.service_targets().0, 60);
    months(&mut s, 40);
    assert_eq!(s.education_quotient(), 60);
    s.remove_structure(36, 30);
    assert_eq!(s.service_targets().0, 0);
    months(&mut s, 1);
    assert_eq!(s.education_quotient(), 60 - EQ_STEP);
    months(&mut s, 30);
    assert_eq!(s.education_quotient(), 0, "never below zero");
}

#[test]
fn the_life_expectancy_follows_the_health_coverage_within_its_bounds() {
    let mut s = bare();
    zone(&mut s, 40, 30);
    assert_eq!(s.life_expectancy(), LIFE_BASE);
    build(&mut s, GENRE_CLINIC, 38, 30);
    build(&mut s, GENRE_HOSPITAL, 44, 30);
    assert_eq!(s.service_targets().1, LIFE_MAX);
    months(&mut s, 1);
    for i in 1..=(LIFE_MAX - LIFE_BASE) {
        months(&mut s, 1);
        assert_eq!(s.life_expectancy(), LIFE_BASE + i * LIFE_STEP);
    }
    months(&mut s, 20);
    assert_eq!(s.life_expectancy(), LIFE_MAX);
    assert_eq!(s.service_stats()[9], 100);
    s.remove_structure(44, 30);
    s.remove_structure(38, 30);
    months(&mut s, 100);
    assert_eq!(
        s.life_expectancy(),
        LIFE_BASE,
        "falls back to the base, never lower"
    );
}

#[test]
fn a_month_is_counted_once_however_many_times_the_valves_run() {
    let mut s = bare();
    zone(&mut s, 40, 30);
    build(&mut s, GENRE_SCHOOL, 36, 30);
    months(&mut s, 2);
    let eq = s.education_quotient();
    for _ in 0..10 {
        s.ext_valves();
    }
    assert_eq!(s.education_quotient(), eq);
}

#[test]
fn the_valves_are_pushed_a_little_never_past_the_ceiling_or_a_cap() {
    let mut s = bare();
    zone(&mut s, 40, 30);
    for (g, x, y) in [
        (GENRE_SCHOOL, 36, 30),
        (GENRE_COLLEGE, 36, 34),
        (GENRE_LIBRARY, 44, 30),
        (GENRE_MUSEUM, 44, 34),
        (GENRE_CLINIC, 40, 36),
        (GENRE_HOSPITAL, 40, 40),
    ] {
        build(&mut s, g, x, y);
    }
    months(&mut s, 80);
    assert_eq!(
        (s.education_quotient(), s.life_expectancy()),
        (EQ_MAX, LIFE_MAX)
    );
    let probe = |s: &mut Simulation, res: i16, com: i16| {
        s.res_valve = res;
        s.com_valve = com;
        s.ext_valves();
        (s.res_valve, s.com_valve)
    };
    // 150 / 50 = 3 for the commercial valve, 40 / 10 = 4 for the residential one
    assert_eq!(probe(&mut s, 0, 0), (4, 3));
    assert_eq!(
        probe(&mut s, 498, 499),
        (VALVE_PUSH_CEILING as i16, VALVE_PUSH_CEILING as i16)
    );
    assert_eq!(
        probe(&mut s, 900, 1200),
        (900, 1200),
        "a valve above is left alone"
    );
    assert_eq!(probe(&mut s, -300, -300), (-296, -297));
    s.res_cap = true;
    s.com_cap = true;
    assert_eq!(
        probe(&mut s, -10, -10),
        (-10, -10),
        "a stadium or airport cap holds"
    );
}

#[test]
fn a_city_without_service_leaves_the_valves_alone() {
    let mut s = bare();
    zone(&mut s, 40, 30);
    s.res_valve = 77;
    s.com_valve = 55;
    months(&mut s, 5);
    assert_eq!((s.res_valve, s.com_valve), (77, 55));
}

#[test]
fn a_high_eq_cuts_the_pollution_by_at_most_the_maximum_share() {
    let mut s = bare();
    zone(&mut s, 40, 30);
    for (g, x, y) in [
        (GENRE_SCHOOL, 36, 30),
        (GENRE_COLLEGE, 36, 34),
        (GENRE_LIBRARY, 44, 30),
        (GENRE_MUSEUM, 44, 34),
    ] {
        build(&mut s, g, x, y);
    }
    assert_eq!(s.ext_pollution(5, 5, 200), 200, "EQ 0");
    months(&mut s, 31); // the first month only measures: EQ 90
    let eq = s.education_quotient();
    assert_eq!(eq, 90);
    let mid = s.ext_pollution(5, 5, 200);
    assert_eq!(mid, 200 - 200 * eq * POLLUTION_CUT_MAX_PCT / (EQ_MAX * 100));
    months(&mut s, 60);
    assert_eq!(s.education_quotient(), EQ_MAX);
    let cut = s.ext_pollution(5, 5, 250);
    assert_eq!(cut, 250 - 250 * POLLUTION_CUT_MAX_PCT / 100);
    assert_eq!(s.ext_pollution(5, 5, 0), 0);
    assert!(mid > s.ext_pollution(5, 5, 200));
}

/// A city of `zones` zones of 40 residents with the crime average `crime`.
fn crime_city(zones: usize, crime: i16) -> Simulation {
    let mut s = bare();
    for i in 0..zones {
        zone(&mut s, 20 + 4 * i as i32, 10);
    }
    s.crime_average = crime;
    s
}

#[test]
fn a_prison_cuts_the_crime_in_its_radius_only_and_scales_with_its_places() {
    let mut s = crime_city(5, 100); // 200 residents x 100 / 1000 = 20 detainees
    build(&mut s, GENRE_PRISON, 50, 30); // radius 20, 100 places
    months(&mut s, 1);
    assert_eq!(s.service_stats()[6], 20);
    assert_eq!(s.service_stats()[7], 100);
    let full = 100 - 100 * PRISON_CRIME_CUT_PCT / 100;
    assert_eq!(s.ext_crime(50, 30, 100), full);
    let mid = s.ext_crime(60, 30, 100);
    assert!(full < mid && mid < 100);
    assert_eq!(s.ext_crime(80, 30, 100), 100, "outside the radius");
    assert_eq!(s.ext_crime(50, 30, 0), 0);
    // more crime than places: the effect shrinks with the share of the demand met
    s.crime_average = 500; // 100 detainees... exactly the places
    s.extensions_mut().service_cache = Default::default();
    months(&mut s, 1);
    assert_eq!(s.ext_crime(50, 30, 100), full);
    s.crime_average = 1000; // 200 detainees for 100 places: half
    s.city_time += 4;
    s.ext_valves();
    assert_eq!(
        s.ext_crime(50, 30, 100),
        100 - 100 * (PRISON_CRIME_CUT_PCT / 2) / 100
    );
}

#[test]
fn an_unpowered_prison_or_a_city_without_one_leaves_the_crime_alone() {
    let mut s = crime_city(5, 100);
    assert_eq!(s.place_structure(GENRE_PRISON, 50, 30), ToolResult::Ok);
    months(&mut s, 1);
    assert_eq!(s.ext_crime(50, 30, 100), 100);
    let mut t = crime_city(5, 100);
    months(&mut t, 1);
    assert_eq!(t.ext_crime(50, 30, 100), 100);
}

#[test]
fn the_prisons_together_never_cut_more_than_the_maximum() {
    let mut s = crime_city(5, 100);
    for x in [50, 54, 58] {
        build(&mut s, GENRE_PRISON, x, 30);
    }
    months(&mut s, 1);
    assert_eq!(s.ext_crime(54, 31, 100), 100 - PRISON_CRIME_CUT_MAX_PCT);
}

#[test]
fn a_prison_lowers_the_land_value_nearby_up_to_a_cap() {
    let mut s = bare();
    assert_eq!(s.ext_land_value(50, 30, 100), 100);
    build(&mut s, GENRE_PRISON, 50, 30);
    assert_eq!(s.ext_land_value(50, 30, 100), 100 - PRISON_LAND_MALUS);
    let near = s.ext_land_value(53, 30, 100);
    assert!(100 - PRISON_LAND_MALUS < near && near < 100);
    assert_eq!(s.ext_land_value(70, 30, 100), 100, "far away");
    for x in [53, 56] {
        build(&mut s, GENRE_PRISON, x, 30);
    }
    assert_eq!(s.ext_land_value(53, 31, 100), 100 - PRISON_LAND_MALUS_CAP);
}

#[test]
fn the_upkeep_is_the_one_of_the_structures_and_is_paid_once() {
    let mut s = bare();
    for (g, x) in [(GENRE_SCHOOL, 10), (GENRE_PRISON, 20), (GENRE_CLINIC, 30)] {
        build(&mut s, g, x, 30);
    }
    let expected: i32 = [GENRE_SCHOOL, GENRE_PRISON, GENRE_CLINIC]
        .iter()
        .map(|&g| kind_of(g).unwrap().upkeep)
        .sum();
    assert_eq!(s.structures_upkeep(), expected);
    let before = s.total_funds;
    s.ext_monthly_balance();
    assert_eq!(before - s.total_funds, i64::from(expected));
}

#[test]
fn every_catalog_service_has_a_capacity_a_radius_and_needs_power() {
    for sv in &SERVICES {
        let k = kind_of(sv.genre).unwrap();
        assert!(sv.capacity > 0 && k.radius > 0);
        assert_eq!(k.flags & micropolis_core::structures::FLAG_POWER, 1);
    }
    assert_eq!(SERVICES.len(), 7);
    assert_eq!(SERVICES[6].genre, GENRE_PRISON);
}

#[test]
fn the_loops_stay_bounded_on_a_full_map() {
    // every tile a zone-free map, the maximum of buildings: still finishes and stays in range
    let mut s = bare();
    zone(&mut s, 40, 30);
    let mut n = 0;
    'fill: for x in (1..85).step_by(3) {
        for y in (1..65).step_by(3) {
            if s.place_structure(GENRE_CLINIC, x, y) != ToolResult::Ok {
                break 'fill;
            }
            power(&mut s, GENRE_CLINIC, x, y);
            n += 1;
        }
    }
    assert!(n > 100);
    let st = s.service_stats();
    assert!(st[5] <= micropolis_core::structures::MAX_STRUCTURES as i32 * 80);
    months(&mut s, 3);
    assert!((40..=90).contains(&s.life_expectancy()));
}
