//! The zoning densities (docs/game-design-v07.md): placing and the prices, the nine growth
//! caps, consistency, the density layer and statistics. Rule off = the original engine.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::densities::{
    DENSITY_CAP, DENSITY_COST_PCT, DENSITY_DENSE, DENSITY_LIGHT, DENSITY_MEDIUM, GENRE_COMMERCIAL,
    GENRE_INDUSTRIAL, GENRE_RESIDENTIAL, MAX_DENSITY_ZONES,
};
use micropolis_core::position::Position;
use micropolis_core::simulation::Simulation;
use micropolis_core::tile_chars::{DIRT, RIVER, WOODS};
use micropolis_core::tool::{EditingTool, ToolResult};
use micropolis_core::traffic::ZoneType;
use support::{run, state};

const MONEY: i64 = 10_000_000;
const GENRES: [u8; 3] = [GENRE_RESIDENTIAL, GENRE_COMMERCIAL, GENRE_INDUSTRIAL];
const KINDS: [ZoneType; 3] = [
    ZoneType::Residential,
    ZoneType::Commercial,
    ZoneType::Industrial,
];

/// A 90 x 70 map of bare land with a river column at x = 10, the rules on and money to spend.
fn bare() -> Simulation {
    let mut s = Simulation::new(90, 70);
    s.tiles.fill(DIRT);
    for y in 0..70 {
        s.set_tile(10, y, RIVER);
    }
    s.total_funds = MONEY;
    s.set_density_rules(true);
    s
}

/// Replaces the zone centred on `pos` by one of population level `level` (0-based).
fn grow_to(s: &mut Simulation, genre: u8, pos: Position, level: i32) {
    match genre {
        GENRE_RESIDENTIAL => s.res_plop(pos, level, 0),
        GENRE_COMMERCIAL => s.com_plop(pos, level, 0),
        _ => s.ind_plop(pos, level, 0),
    }
}

/// Levels of population a zone of the genre goes through (`resPlop`: 4, `comPlop`: 5, `indPlop`: 4).
fn levels(genre: u8) -> i32 {
    if genre == GENRE_COMMERCIAL {
        5
    } else {
        4
    }
}

/// The population of the zone at `level`, as the cap table counts it.
fn population(genre: u8, level: i32) -> i32 {
    match genre {
        GENRE_RESIDENTIAL => 16 + 8 * level,
        _ => level + 1,
    }
}

#[test]
fn off_by_default_every_call_is_refused_for_free() {
    let mut s = Simulation::new(90, 70);
    s.total_funds = MONEY;
    assert!(!s.density_rules() && !s.extensions_active());
    for genre in 0..=4 {
        for density in 0..=4 {
            let p = s.zone_preview(genre, density, 20, 20);
            assert_eq!((p.result, p.cost), (ToolResult::Failed, 0));
            assert_eq!(s.place_zone(genre, density, 20, 20), ToolResult::Failed);
        }
    }
    assert_eq!(s.total_funds, MONEY);
    assert!(s.density_layer().iter().all(|&v| v == 0));
    assert!(s.extensions().density_zones.is_empty());
}

#[test]
fn rule_on_without_a_recorded_zone_is_the_original_engine() {
    let make = |on: bool| {
        let mut s = Simulation::new(120, 100);
        s.new_random_city(7);
        support::starter(&mut s);
        s.set_density_rules(on);
        run(&mut s, 400);
        s
    };
    assert_eq!(state(&make(false)), state(&make(true)));
}

#[test]
fn a_zone_costs_the_density_percentage_of_the_classic_price() {
    for (genre, tool) in [
        (GENRE_RESIDENTIAL, EditingTool::Residential),
        (GENRE_COMMERCIAL, EditingTool::Commercial),
        (GENRE_INDUSTRIAL, EditingTool::Industrial),
    ] {
        for density in DENSITY_LIGHT..=DENSITY_DENSE {
            let mut s = bare();
            let classic = tool.cost();
            let expected = classic * DENSITY_COST_PCT[usize::from(density) - 1] / 100;
            let p = s.zone_preview(genre, density, 30, 30);
            assert_eq!((p.result, p.cost), (ToolResult::Ok, expected));
            assert_eq!(s.total_funds, MONEY, "a preview charges nothing");
            assert_eq!(s.place_zone(genre, density, 30, 30), ToolResult::Ok);
            assert_eq!(s.total_funds, MONEY - i64::from(expected));
        }
    }
    assert_eq!(DENSITY_COST_PCT, [60, 80, 100]);
}

#[test]
fn the_funds_are_checked_against_the_scaled_price() {
    let mut s = bare();
    s.total_funds = 59;
    assert_eq!(s.zone_preview(1, 1, 30, 30).result, ToolResult::NoMoney);
    assert_eq!(s.place_zone(1, 1, 30, 30), ToolResult::NoMoney);
    assert_eq!(s.total_funds, 59);
    assert!(s.density_stats().iter().all(|&n| n == 0));
    s.total_funds = 60;
    let p = s.zone_preview(1, 1, 30, 30);
    assert_eq!((p.result, p.cost), (ToolResult::Ok, 60));
    // the same money does not buy a dense zone
    assert_eq!(s.zone_preview(1, 3, 30, 30).result, ToolResult::NoMoney);
    assert_eq!(s.place_zone(1, 1, 30, 30), ToolResult::Ok);
    assert_eq!(s.total_funds, 0);
    assert_eq!(s.density_stats()[0], 1);
}

#[test]
fn the_classic_zone_rules_apply_and_a_refusal_changes_nothing() {
    let mut s = bare();
    for (g, d, x, y) in [
        (0, 1, 30, 30),
        (4, 1, 30, 30),
        (1, 0, 30, 30),
        (1, 4, 30, 30),
    ] {
        assert_eq!(s.place_zone(g, d, x, y), ToolResult::Failed, "{g} {d}");
    }
    // off the map: refused; on water: whatever the classic tool says
    for (x, y) in [(0, 5), (89, 5), (30, 69)] {
        assert_eq!(
            s.zone_preview(1, 1, x, y).result,
            ToolResult::Failed,
            "{x} {y}"
        );
    }
    for (x, y) in [(10, 30), (11, 30)] {
        let classic = s.tool_preview(EditingTool::Residential, x, y).result;
        assert_ne!(classic, ToolResult::Ok);
        assert_eq!(s.zone_preview(1, 1, x, y).result, classic, "{x} {y}");
    }
    // a building in the way: bulldoze first
    assert_eq!(
        s.tool_down(EditingTool::FireStation, 40, 40),
        ToolResult::Ok
    );
    s.total_funds = MONEY;
    let p = s.zone_preview(1, 1, 41, 41);
    assert_eq!((p.result, p.cost), (ToolResult::NeedBulldoze, 0));
    assert_eq!(s.place_zone(1, 1, 41, 41), ToolResult::NeedBulldoze);
    assert_eq!(s.total_funds, MONEY);
    assert!(s.extensions().density_zones.is_empty());
}

#[test]
fn light_and_medium_zones_are_recorded_and_dense_ones_are_not() {
    let mut s = bare();
    assert_eq!(s.place_zone(1, DENSITY_LIGHT, 20, 20), ToolResult::Ok);
    assert_eq!(s.place_zone(2, DENSITY_MEDIUM, 30, 20), ToolResult::Ok);
    assert_eq!(s.place_zone(3, DENSITY_DENSE, 40, 20), ToolResult::Ok);
    assert_eq!(s.extensions().density_zones.len(), 2);
    assert_eq!(s.zone_density(20, 20), DENSITY_LIGHT);
    assert_eq!(s.zone_density(30, 20), DENSITY_MEDIUM);
    assert_eq!(s.zone_density(40, 20), DENSITY_DENSE);
    assert_eq!(s.zone_density(60, 60), DENSITY_DENSE, "no record: dense");
    assert_eq!(s.density_stats()[..3], [1, 1, 1]);
    assert!(s.needs_extension_block());
}

#[test]
fn the_nine_caps_stop_the_growth_of_a_zone() {
    for (g, genre) in GENRES.into_iter().enumerate() {
        for density in DENSITY_LIGHT..=DENSITY_DENSE {
            let mut s = bare();
            assert_eq!(s.place_zone(genre, density, 30, 30), ToolResult::Ok);
            let pos = Position::new(30, 30);
            let cap = DENSITY_CAP[g][usize::from(density) - 1];
            for level in 0..levels(genre) {
                grow_to(&mut s, genre, pos, level);
                let pop = population(genre, level);
                let expected = density == DENSITY_DENSE || pop < cap;
                assert_eq!(
                    s.ext_zone_can_grow(pos, KINDS[g]),
                    expected,
                    "genre {genre} density {density} population {pop} cap {cap}"
                );
            }
        }
    }
}

#[test]
fn the_caps_are_reachable_and_the_dense_cap_is_the_classic_maximum() {
    for (g, genre) in GENRES.into_iter().enumerate() {
        let top = population(genre, levels(genre) - 1);
        assert_eq!(DENSITY_CAP[g][2], top, "genre {genre}");
        assert!(DENSITY_CAP[g][0] >= population(genre, 0));
    }
}

#[test]
fn rule_off_lifts_every_cap_and_forgets_the_records() {
    let mut s = bare();
    assert_eq!(s.place_zone(1, DENSITY_LIGHT, 30, 30), ToolResult::Ok);
    grow_to(&mut s, GENRE_RESIDENTIAL, Position::new(30, 30), 3);
    assert!(!s.ext_zone_can_grow(Position::new(30, 30), ZoneType::Residential));
    s.set_density_rules(false);
    assert!(s.ext_zone_can_grow(Position::new(30, 30), ZoneType::Residential));
    assert!(s.extensions().density_zones.is_empty());
    assert!(!s.needs_extension_block() && !s.extensions_active());
    assert_eq!(s.density_stats(), [0; 5]);
}

#[test]
fn the_list_of_recorded_zones_is_capped() {
    let mut s = bare();
    for i in 0..MAX_DENSITY_ZONES as i32 {
        assert!(s
            .extensions_mut()
            .density_zones
            .set(1 + i % 80, 1 + i / 80, 1));
    }
    assert_eq!(s.place_zone(1, DENSITY_LIGHT, 30, 30), ToolResult::Failed);
    assert_eq!(
        s.zone_preview(1, DENSITY_MEDIUM, 30, 30).result,
        ToolResult::Failed
    );
    // a dense zone needs no record
    assert_eq!(s.place_zone(1, DENSITY_DENSE, 30, 30), ToolResult::Ok);
}

#[test]
fn a_destroyed_zone_loses_its_record() {
    let mut s = bare();
    for (x, density) in [
        (20, DENSITY_LIGHT),
        (30, DENSITY_MEDIUM),
        (40, DENSITY_LIGHT),
    ] {
        assert_eq!(s.place_zone(1, density, x, 20), ToolResult::Ok);
    }
    // bulldozer
    s.tool_down(EditingTool::Bulldozer, 20, 20);
    assert!(!s.repair_densities(), "the bulldozer already repaired it");
    assert_eq!(s.extensions().density_zones.len(), 2);
    // a disaster that wipes the centre tile, seen by the valves hook
    s.set_tile(30, 20, DIRT);
    s.ext_valves();
    assert_eq!(s.extensions().density_zones.len(), 1);
    // the monthly balance too
    s.set_tile(40, 20, DIRT);
    s.ext_monthly_balance();
    assert!(s.extensions().density_zones.is_empty());
    assert_eq!(s.density_stats(), [0; 5]);
}

#[test]
fn placing_over_a_cleared_zone_does_not_inherit_the_old_density() {
    let mut s = bare();
    assert_eq!(s.place_zone(1, DENSITY_LIGHT, 30, 30), ToolResult::Ok);
    s.tool_down(EditingTool::Bulldozer, 30, 30);
    assert_eq!(s.place_zone(1, DENSITY_DENSE, 30, 30), ToolResult::Ok);
    assert_eq!(s.zone_density(30, 30), DENSITY_DENSE);
    assert!(s.extensions().density_zones.is_empty());
}

#[test]
fn a_classic_zone_built_after_a_bulldozed_one_is_dense() {
    let mut s = bare();
    assert_eq!(s.place_zone(3, DENSITY_LIGHT, 30, 30), ToolResult::Ok);
    s.tool_down(EditingTool::Bulldozer, 30, 30);
    assert!(s.extensions().density_zones.is_empty());
    assert_eq!(s.tool_down(EditingTool::Commercial, 30, 30), ToolResult::Ok);
    assert_eq!(s.zone_density(30, 30), DENSITY_DENSE);
    assert!(s.extensions().density_zones.is_empty());
    s.ext_valves();
    assert_eq!(s.zone_density(30, 30), DENSITY_DENSE);
    assert_eq!(s.density_stats(), [0, 0, 1, 0, 0]);
}

#[test]
fn the_layer_marks_the_nine_tiles_of_every_zone() {
    let mut s = bare();
    assert_eq!(s.place_zone(1, DENSITY_LIGHT, 20, 20), ToolResult::Ok);
    assert_eq!(s.place_zone(2, DENSITY_MEDIUM, 30, 20), ToolResult::Ok);
    // a classic zone: dense
    assert_eq!(s.tool_down(EditingTool::Industrial, 40, 20), ToolResult::Ok);
    let (w, h) = s.world_size();
    let layer = s.density_layer();
    assert_eq!(layer.len(), (w * h) as usize);
    let at = |x: i32, y: i32| layer[(x * h + y) as usize];
    for (cx, value) in [(20, 1), (30, 2), (40, 3)] {
        for (dx, dy) in (-1..=1).flat_map(|dx| (-1..=1).map(move |dy| (dx, dy))) {
            assert_eq!(at(cx + dx, 20 + dy), value, "{cx} {dx} {dy}");
        }
        assert_eq!((at(cx - 2, 20), at(cx + 2, 20), at(cx, 22)), (0, 0, 0));
    }
    assert_eq!(layer.iter().filter(|&&v| v != 0).count(), 27);
    assert_eq!(s.density_stats()[..3], [1, 1, 1]);
}

#[test]
fn nothing_but_zones_is_in_the_layer() {
    let mut s = bare();
    s.tool_down(EditingTool::FireStation, 30, 30);
    s.tool_down(EditingTool::Road, 50, 50);
    assert!(s.density_layer().iter().all(|&v| v == 0));
}

#[test]
fn only_the_zone_price_is_scaled_not_the_clearing_of_the_site() {
    let mut s = bare();
    s.set_tile(31, 31, WOODS);
    let p = s.zone_preview(1, 1, 30, 30);
    assert_eq!((p.result, p.cost), (ToolResult::Ok, 60 + 1));
    assert_eq!(s.place_zone(1, 1, 30, 30), ToolResult::Ok);
    assert_eq!(s.total_funds, MONEY - 61);
}

/// Classic population of the zone centred on `(x, y)`.
fn zone_pop(s: &Simulation, x: i32, y: i32) -> i32 {
    let tile = s.tile(x, y).unwrap() & 0x3ff;
    if tile == micropolis_core::tile_chars::FREEZ {
        i32::from(s.do_free_pop(Position::new(x, y)))
    } else {
        i32::from(s.get_res_zone_pop(tile))
    }
}

/// The highest population among five residential zones of `density` after a long run.
fn grown_max(density: u8) -> i32 {
    let mut s = bare();
    s.set_speed(3);
    s.set_passes(1);
    s.tool_drag(EditingTool::Road, 15, 35, 75, 35);
    assert_eq!(s.tool_down(EditingTool::CoalPower, 20, 44), ToolResult::Ok);
    s.tool_drag(EditingTool::Wire, 20, 42, 20, 39);
    s.tool_drag(EditingTool::Wire, 20, 39, 75, 39);
    let spots = [25, 31, 37, 43, 49];
    for x in spots {
        assert_eq!(
            s.place_zone(GENRE_RESIDENTIAL, density, x, 37),
            ToolResult::Ok
        );
    }
    let mut top = 0;
    for _ in 0..100 {
        run(&mut s, 20);
        s.total_funds = MONEY;
        s.res_valve = 2000;
        s.population_density_map.fill(200); // the dense neighbourhood the big buildings ask for
        for x in spots {
            let pop = zone_pop(&s, x, 37);
            if density == DENSITY_LIGHT {
                assert!(pop <= DENSITY_CAP[0][0], "{x}");
            }
            top = top.max(pop);
        }
    }
    top
}

#[test]
fn zones_stop_growing_at_their_cap_in_a_running_city() {
    assert_eq!(
        grown_max(DENSITY_LIGHT),
        DENSITY_CAP[0][0],
        "light zones reach their cap"
    );
    assert!(
        grown_max(DENSITY_DENSE) > DENSITY_CAP[0][0],
        "dense ones go further"
    );
}
