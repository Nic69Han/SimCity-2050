//! The farms (docs/game-design-v07.md): a light industrial zone on cheap land, far from the
//! pollution, recomputed every month; no pollution from a farm; the agricultural jobs.

use micropolis_core::densities::{
    DENSITY_DENSE, DENSITY_LIGHT, DENSITY_MEDIUM, FARM_LAND_VALUE_MAX, FARM_POLLUTION_MAX,
    FARM_RING, GENRE_COMMERCIAL, GENRE_INDUSTRIAL, GENRE_RESIDENTIAL, LAYER_FARM,
};
use micropolis_core::position::Position;
use micropolis_core::simulation::Simulation;
use micropolis_core::tile_chars::DIRT;
use micropolis_core::tool::{EditingTool, ToolResult};

const MONEY: i64 = 10_000_000;
const AT: (i32, i32) = (30, 30);

fn bare(rules: bool) -> Simulation {
    let mut s = Simulation::new(90, 70);
    s.tiles.fill(DIRT);
    s.total_funds = MONEY;
    s.set_density_rules(rules);
    s
}

/// A populated industrial zone (3 jobs) at `AT`, of the given density, on a city with the rules on.
fn with_zone(genre: u8, density: u8) -> Simulation {
    let mut s = bare(true);
    assert_eq!(s.place_zone(genre, density, AT.0, AT.1), ToolResult::Ok);
    populate(&mut s, genre);
    s
}

fn populate(s: &mut Simulation, genre: u8) {
    let pos = Position::new(AT.0, AT.1);
    match genre {
        GENRE_INDUSTRIAL => s.ind_plop(pos, 2, 0),
        GENRE_COMMERCIAL => s.com_plop(pos, 2, 0),
        _ => s.res_plop(pos, 2, 0),
    }
}

fn farms(s: &Simulation) -> i32 {
    s.density_stats()[3]
}

fn month(s: &mut Simulation) {
    s.ext_monthly_balance();
}

fn set_land_value(s: &mut Simulation, v: u8) {
    s.land_value_map.world_set(AT.0, AT.1, v);
}

fn set_ring_pollution(s: &mut Simulation, v: u8) {
    s.pollution_density_map.world_set(AT.0 + FARM_RING, AT.1, v);
}

#[test]
fn a_farm_appears_at_the_monthly_balance_and_not_before() {
    let mut s = with_zone(GENRE_INDUSTRIAL, DENSITY_LIGHT);
    assert_eq!(farms(&s), 0, "nothing is recomputed between two months");
    month(&mut s);
    assert_eq!(s.density_stats(), [1, 0, 0, 1, 3]);
    let (_, h) = s.world_size();
    let layer = s.density_layer();
    for (dx, dy) in (-1..=1).flat_map(|dx| (-1..=1).map(move |dy| (dx, dy))) {
        assert_eq!(layer[((AT.0 + dx) * h + AT.1 + dy) as usize], LAYER_FARM);
    }
    assert_eq!(layer.iter().filter(|&&v| v != 0).count(), 9);
}

#[test]
fn a_farm_disappears_when_the_land_value_rises() {
    let mut s = with_zone(GENRE_INDUSTRIAL, DENSITY_LIGHT);
    set_land_value(&mut s, (FARM_LAND_VALUE_MAX - 1) as u8);
    month(&mut s);
    assert_eq!(farms(&s), 1);
    set_land_value(&mut s, FARM_LAND_VALUE_MAX as u8);
    assert_eq!(farms(&s), 1, "only the monthly balance decides");
    month(&mut s);
    assert_eq!(
        s.density_stats(),
        [1, 0, 0, 0, 0],
        "a light zone, no farm, no jobs"
    );
    assert!(s
        .density_layer()
        .iter()
        .all(|&v| v == 0 || v == DENSITY_LIGHT));
    set_land_value(&mut s, 0);
    month(&mut s);
    assert_eq!(
        farms(&s),
        1,
        "and it comes back when the land is cheap again"
    );
}

#[test]
fn a_farm_disappears_when_the_pollution_around_it_rises() {
    let mut s = with_zone(GENRE_INDUSTRIAL, DENSITY_LIGHT);
    set_ring_pollution(&mut s, (FARM_POLLUTION_MAX - 1) as u8);
    month(&mut s);
    assert_eq!(farms(&s), 1);
    set_ring_pollution(&mut s, FARM_POLLUTION_MAX as u8);
    month(&mut s);
    assert_eq!(farms(&s), 0);
}

#[test]
fn only_a_light_industrial_zone_can_be_a_farm() {
    for (genre, density) in [
        (GENRE_INDUSTRIAL, DENSITY_MEDIUM),
        (GENRE_INDUSTRIAL, DENSITY_DENSE),
        (GENRE_COMMERCIAL, DENSITY_LIGHT),
        (GENRE_RESIDENTIAL, DENSITY_LIGHT),
    ] {
        let mut s = with_zone(genre, density);
        month(&mut s);
        assert_eq!(farms(&s), 0, "genre {genre} density {density}");
    }
    // a classic industrial zone is dense
    let mut s = bare(true);
    assert_eq!(
        s.tool_down(EditingTool::Industrial, AT.0, AT.1),
        ToolResult::Ok
    );
    month(&mut s);
    assert_eq!(s.density_stats(), [0, 0, 1, 0, 0]);
}

#[test]
fn the_agricultural_jobs_are_the_industrial_population_of_the_farms() {
    let mut s = bare(true);
    for (x, level) in [(20, 0), (40, 1), (60, 3)] {
        assert_eq!(
            s.place_zone(GENRE_INDUSTRIAL, DENSITY_LIGHT, x, 30),
            ToolResult::Ok
        );
        s.ind_plop(Position::new(x, 30), level, 0);
    }
    // a medium zone is not a farm: its jobs do not count
    assert_eq!(
        s.place_zone(GENRE_INDUSTRIAL, DENSITY_MEDIUM, 75, 30),
        ToolResult::Ok
    );
    s.ind_plop(Position::new(75, 30), 3, 0);
    month(&mut s);
    assert_eq!(s.density_stats(), [3, 1, 0, 3, 1 + 2 + 4]);
}

#[test]
fn a_farm_makes_no_pollution_and_the_same_zone_does_when_it_is_not_a_farm() {
    let pollution_at = |s: &mut Simulation| {
        s.pollution_terrain_land_value_scan();
        i32::from(s.pollution_density_map.world_get(AT.0, AT.1))
    };
    // the classic industry of the same size pollutes
    let mut classic = bare(false);
    assert_eq!(
        classic.tool_down(EditingTool::Industrial, AT.0, AT.1),
        ToolResult::Ok
    );
    populate(&mut classic, GENRE_INDUSTRIAL);
    assert!(pollution_at(&mut classic) > 0);
    // a medium zone with the rules on pollutes
    let mut medium = with_zone(GENRE_INDUSTRIAL, DENSITY_MEDIUM);
    month(&mut medium);
    assert!(pollution_at(&mut medium) > 0);
    // a farm does not
    let mut farm = with_zone(GENRE_INDUSTRIAL, DENSITY_LIGHT);
    month(&mut farm);
    assert_eq!(farms(&farm), 1);
    assert_eq!(pollution_at(&mut farm), 0);
    // and it stays a farm after the scan: its own diffusion is not read as pollution
    month(&mut farm);
    assert_eq!(farms(&farm), 1);
    // rule off: the farm is a classic industry again
    farm.set_density_rules(false);
    assert!(pollution_at(&mut farm) > 0);
}

#[test]
fn a_destroyed_farm_stops_being_one_at_once() {
    let mut s = with_zone(GENRE_INDUSTRIAL, DENSITY_LIGHT);
    month(&mut s);
    assert_eq!(farms(&s), 1);
    s.tool_down(EditingTool::Bulldozer, AT.0, AT.1);
    assert!(!s.repair_densities(), "the bulldozer already repaired it");
    assert!(s.extensions().farms.is_empty());
    assert_eq!(s.density_stats(), [0; 5]);
}

#[test]
fn turning_the_rules_off_removes_the_farms() {
    let mut s = with_zone(GENRE_INDUSTRIAL, DENSITY_LIGHT);
    month(&mut s);
    s.set_density_rules(false);
    assert!(s.extensions().farms.is_empty());
    assert_eq!(s.density_stats(), [0; 5]);
    assert!(s.density_layer().iter().all(|&v| v == 0));
}
