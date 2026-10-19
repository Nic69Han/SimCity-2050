//! The extended buildings (docs/game-design-v04.md): placement and its result codes, the surface
//! tiles and what the classic tools do with them, consistency (bulldozer, fire), power, water,
//! upkeep, land value and the cap. Rule off = the original engine.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::simulation::Simulation;
use micropolis_core::structures::{
    is_surface, kind_of, CATALOG, GENRE_MONUMENT, GENRE_PARK, GENRE_PLAZA, LAND_VALUE_CAP,
    MAX_STRUCTURES, SURFACE_BITS,
};
use micropolis_core::tile::{CONDBIT, LOMASK, PWRBIT};
use micropolis_core::tile_chars::{DIRT, FIRE, RIVER, ROADS, WOODS};
use micropolis_core::tool::{EditingTool, ToolResult};
use micropolis_core::water::PUMP;
use support::{run, state};

const MONEY: i64 = 10_000_000;

/// A 90 x 70 map of bare land with a river column at x = 10, the rules on and money to spend.
fn bare() -> Simulation {
    let mut s = Simulation::new(90, 70);
    s.tiles.fill(DIRT);
    for y in 0..70 {
        s.set_tile(10, y, RIVER);
    }
    s.total_funds = MONEY;
    s.set_structure_rules(true);
    s
}

fn kind(genre: u8) -> micropolis_core::structures::Kind {
    *kind_of(genre).unwrap()
}

#[test]
fn off_by_default_every_call_is_refused_for_free() {
    let mut s = Simulation::new(90, 70);
    s.total_funds = MONEY;
    assert!(!s.structure_rules() && !s.extensions_active());
    for genre in 0..=4 {
        let p = s.structure_preview(genre, 20, 20);
        assert_eq!((p.result, p.cost), (ToolResult::Failed, 0));
        assert_eq!(s.place_structure(genre, 20, 20), ToolResult::Failed);
    }
    assert_eq!(s.remove_structure(20, 20), ToolResult::Failed);
    assert!(s.structures().is_empty());
    assert_eq!(s.structures_upkeep(), 0);
    assert_eq!(s.total_funds, MONEY);
    assert!(!s.needs_extension_block());
}

#[test]
fn rule_on_without_a_building_is_the_original_engine() {
    let make = |on: bool| {
        let mut s = Simulation::new(120, 100);
        s.new_random_city(7);
        support::starter(&mut s);
        s.set_structure_rules(on);
        run(&mut s, 400);
        s
    };
    assert_eq!(state(&make(false)), state(&make(true)));
}

#[test]
fn placing_checks_the_site_and_the_money_in_order() {
    let mut s = bare();
    let park = kind(GENRE_PARK);
    // unknown genre, off the map, on water: Failed
    for (g, x, y) in [
        (0, 20, 20),
        (9, 20, 20),
        (1, -1, 5),
        (1, 89, 5),
        (3, 88, 68),
        (1, 9, 20),
    ] {
        assert_eq!(
            s.structure_preview(g, x, y).result,
            ToolResult::Failed,
            "{g} {x} {y}"
        );
    }
    // trees, a road, a fire: bulldoze first
    s.set_tile(31, 31, WOODS);
    s.set_tile(40, 40, ROADS);
    for (x, y) in [(30, 30), (31, 30), (39, 39), (31, 31)] {
        let p = s.structure_preview(1, x, y);
        assert_eq!((p.result, p.cost), (ToolResult::NeedBulldoze, 0), "{x} {y}");
    }
    // free site: price returned, nothing changed by the preview
    let p = s.structure_preview(1, 20, 20);
    assert_eq!((p.result, p.cost), (ToolResult::Ok, park.cost));
    assert_eq!(s.total_funds, MONEY);
    assert!(s.structures().is_empty());
    // no money
    s.total_funds = i64::from(park.cost) - 1;
    assert_eq!(s.structure_preview(1, 20, 20).result, ToolResult::NoMoney);
    assert_eq!(s.place_structure(1, 20, 20), ToolResult::NoMoney);
    assert_eq!(s.total_funds, i64::from(park.cost) - 1);
    assert!(s.structures().is_empty());
}

#[test]
fn a_placed_building_is_listed_costs_money_and_covers_its_footprint() {
    let mut s = bare();
    for (genre, x, y) in [
        (GENRE_PARK, 20, 20),
        (GENRE_PLAZA, 30, 20),
        (GENRE_MONUMENT, 40, 20),
    ] {
        let k = kind(genre);
        let before = s.total_funds;
        assert_eq!(s.place_structure(genre, x, y), ToolResult::Ok);
        assert_eq!(s.total_funds, before - i64::from(k.cost));
        for dx in 0..k.width {
            for dy in 0..k.height {
                let t = s.tile(x + dx, y + dy).unwrap();
                assert_eq!(t, k.surface() | SURFACE_BITS);
                assert!(is_surface(t & LOMASK) && t & CONDBIT != 0);
            }
        }
        // the tile next to the footprint is untouched
        assert_eq!(s.tile(x + k.width, y), Some(DIRT));
        // a second one on the same spot, or overlapping it, wants a bulldozer
        assert_eq!(s.place_structure(genre, x, y), ToolResult::NeedBulldoze);
        assert_eq!(
            s.place_structure(GENRE_PLAZA, x + k.width - 1, y + k.height - 1),
            ToolResult::NeedBulldoze
        );
    }
    let views = s.structures();
    assert_eq!(views.len(), 3);
    let wh: Vec<_> = views
        .iter()
        .map(|v| (v.genre, v.x, v.y, v.width, v.height))
        .collect();
    assert_eq!(
        wh,
        [(1, 20, 20, 2, 2), (2, 30, 20, 1, 1), (3, 40, 20, 3, 3)]
    );
    assert_eq!(
        s.structures_upkeep(),
        CATALOG.iter().map(|k| k.upkeep).sum::<i32>()
    );
}

#[test]
fn the_classic_tools_refuse_the_surface_and_leave_it_alone() {
    let refused = [
        EditingTool::Residential,
        EditingTool::Commercial,
        EditingTool::Industrial,
        EditingTool::FireStation,
        EditingTool::PoliceStation,
        EditingTool::Wire,
        EditingTool::Railroad,
        EditingTool::Road,
        EditingTool::Stadium,
        EditingTool::Park,
        EditingTool::Seaport,
        EditingTool::CoalPower,
        EditingTool::NuclearPower,
        EditingTool::Airport,
        EditingTool::Network,
    ];
    let mut s = bare();
    assert_eq!(s.place_structure(GENRE_MONUMENT, 40, 30), ToolResult::Ok);
    let tiles = s.tiles.clone();
    for tool in refused {
        for (x, y) in [(40, 30), (41, 31), (42, 32), (41, 30)] {
            let p = s.tool_preview(tool, x, y);
            assert_ne!(p.result, ToolResult::Ok, "{tool:?} at {x},{y}");
            assert_ne!(s.do_tool(tool, x, y), ToolResult::Ok, "{tool:?} at {x},{y}");
        }
    }
    assert_eq!(s.tiles, tiles);
    assert_eq!(s.structures().len(), 1);
}

#[test]
fn the_bulldozer_removes_the_whole_building() {
    let mut s = bare();
    assert_eq!(s.place_structure(GENRE_MONUMENT, 40, 30), ToolResult::Ok);
    assert_eq!(s.do_tool(EditingTool::Bulldozer, 41, 31), ToolResult::Ok);
    // the whole footprint is bare land at once, with no manual repair
    assert!(s.structures().is_empty() && s.structures_upkeep() == 0);
    for x in 40..43 {
        for y in 30..33 {
            assert_eq!(s.tile(x, y), Some(DIRT));
        }
    }
    assert_eq!(
        s.structure_preview(GENRE_MONUMENT, 40, 30).result,
        ToolResult::Ok
    );
    assert!(!s.repair_structures());
    assert_eq!(s.place_structure(GENRE_MONUMENT, 40, 30), ToolResult::Ok);
}

#[test]
fn a_fire_destroys_the_building_and_the_valves_pass_repairs() {
    let mut s = bare();
    assert_eq!(s.place_structure(GENRE_PARK, 20, 20), ToolResult::Ok);
    s.set_tile(21, 20, FIRE);
    assert!(s.structures().is_empty());
    s.ext_valves();
    // the burnt tile stays (it is the fire's), the others are bare land again
    assert_eq!(s.tile(21, 20), Some(FIRE));
    assert_eq!(s.tile(20, 20), Some(DIRT));
    assert_eq!(s.tile(21, 21), Some(DIRT));
    assert!(s.extensions().structure_list.is_empty());
}

#[test]
fn removing_works_from_any_tile_for_free_and_a_miss_fails() {
    let mut s = bare();
    s.place_structure(GENRE_MONUMENT, 40, 30);
    let funds = s.total_funds;
    assert_eq!(s.remove_structure(39, 30), ToolResult::Failed);
    assert_eq!(s.remove_structure(42, 32), ToolResult::Ok);
    assert_eq!(s.total_funds, funds);
    assert!(s.structures().is_empty());
    assert_eq!(s.tile(40, 30), Some(DIRT));
    assert_eq!(s.remove_structure(42, 32), ToolResult::Failed);
}

#[test]
fn switching_the_rule_off_removes_everything_without_refund() {
    let mut s = bare();
    s.place_structure(GENRE_PARK, 20, 20);
    s.place_structure(GENRE_PLAZA, 30, 20);
    let funds = s.total_funds;
    s.set_structure_rules(false);
    assert!(s.structures().is_empty() && !s.needs_extension_block());
    assert_eq!(s.total_funds, funds);
    assert_eq!(s.tile(20, 20), Some(DIRT));
    assert_eq!(s.tile(30, 20), Some(DIRT));
}

#[test]
fn the_number_of_buildings_is_capped() {
    let mut s = bare();
    for i in 0..MAX_STRUCTURES as i32 {
        assert_eq!(
            s.place_structure(GENRE_PLAZA, 12 + i % 60, 2 + 2 * (i / 60)),
            ToolResult::Ok,
            "{i}"
        );
    }
    assert_eq!(s.structures().len(), MAX_STRUCTURES);
    assert_eq!(
        s.structure_preview(GENRE_PLAZA, 12, 40).result,
        ToolResult::Failed
    );
    assert_eq!(s.place_structure(GENRE_PLAZA, 12, 40), ToolResult::Failed);
    assert_eq!(s.tile(12, 40), Some(DIRT));
    assert_eq!(s.remove_structure(12, 2), ToolResult::Ok);
    assert_eq!(s.place_structure(GENRE_PLAZA, 12, 40), ToolResult::Ok);
}

#[test]
fn the_upkeep_is_paid_with_the_monthly_balance() {
    let mut s = bare();
    s.place_structure(GENRE_PARK, 20, 20);
    s.place_structure(GENRE_MONUMENT, 40, 30);
    let upkeep = kind(GENRE_PARK).upkeep + kind(GENRE_MONUMENT).upkeep;
    assert_eq!(s.structures_upkeep(), upkeep);
    let funds = s.total_funds;
    s.ext_monthly_balance();
    assert_eq!(s.total_funds, funds - i64::from(upkeep));
}

#[test]
fn the_monthly_balance_repairs_orphans_and_broken_buildings() {
    let mut s = bare();
    s.place_structure(GENRE_PARK, 20, 20);
    s.set_tile(20, 20, DIRT); // broken
    s.set_tile(50, 50, kind(GENRE_PLAZA).surface()); // owned by nobody
    s.ext_monthly_balance();
    assert!(s.extensions().structure_list.is_empty());
    assert_eq!(s.tile(21, 21), Some(DIRT));
    assert_eq!(s.tile(50, 50), Some(DIRT));
}

#[test]
fn power_reaches_a_building_through_a_wire_and_the_state_shows_it() {
    let mut s = bare();
    s.set_tile(10, 5, DIRT);
    assert_eq!(s.do_tool(EditingTool::CoalPower, 25, 40), ToolResult::Ok);
    // the plant occupies 24..=27 x 39..=42; a wire runs east from it to a public square
    s.tool_drag(EditingTool::Wire, 28, 40, 34, 40);
    assert_eq!(s.place_structure(GENRE_PLAZA, 35, 40), ToolResult::Ok);
    assert_eq!(s.place_structure(GENRE_PLAZA, 35, 50), ToolResult::Ok);
    run(&mut s, 200);
    let near = s.structures().into_iter().find(|v| v.y == 40).unwrap();
    let far = s.structures().into_iter().find(|v| v.y == 50).unwrap();
    assert_eq!(near.state & 1, 1, "wired plaza");
    assert_eq!(far.state & 1, 0, "isolated plaza");
}

#[test]
fn water_links_the_building_when_the_water_rules_are_on() {
    let mut s = bare();
    s.set_water_rules(true);
    assert_eq!(s.place_structure(GENRE_MONUMENT, 7, 30), ToolResult::Ok);
    assert_eq!(s.structures()[0].state & 2, 0, "no pump yet");
    // a pump on the shore, within reach of the monument (x 7..=9, y 30..=32)
    assert_eq!(s.place_pump(9, 33), ToolResult::Ok);
    assert_eq!(s.water().pipes.get(9, 33), PUMP);
    assert_eq!(s.structures()[0].state & 2, 2);
    s.set_water_rules(false);
    assert_eq!(
        s.structures()[0].state & 2,
        0,
        "no water without the water rules"
    );
}

/// Marks every tile of a building powered, as the power scan does.
fn power_up(s: &mut Simulation, x: i32, y: i32, w: i32, h: i32) {
    for dx in 0..w {
        for dy in 0..h {
            let t = s.tile(x + dx, y + dy).unwrap();
            s.set_tile(x + dx, y + dy, t | PWRBIT);
        }
    }
}

#[test]
fn the_land_value_bonus_falls_off_stops_at_the_radius_and_needs_power() {
    let mut s = bare();
    let park = kind(GENRE_PARK);
    s.place_structure(GENRE_PARK, 40, 30);
    let lv = |s: &Simulation, x: i32, y: i32| s.ext_land_value(x, y, 100) - 100;
    let at = lv(&s, 40, 30);
    assert_eq!(at, park.bonus);
    let mut last = at;
    for d in 1..=park.radius {
        let b = lv(&s, 41 + d, 30);
        assert!(b > 0 && b <= last, "distance {d}");
        last = b;
    }
    assert_eq!(lv(&s, 41 + park.radius + 1, 30), 0);
    assert_eq!(lv(&s, 5, 5), 0);
    // a plaza needs power: nothing until it is powered
    let plaza = kind(GENRE_PLAZA);
    s.place_structure(GENRE_PLAZA, 60, 50);
    assert_eq!(lv(&s, 60, 50), 0);
    power_up(&mut s, 60, 50, 1, 1);
    assert_eq!(lv(&s, 60, 50), plaza.bonus);
    // a broken building gives nothing
    s.set_tile(40, 30, DIRT);
    assert_eq!(lv(&s, 40, 30), 0);
}

#[test]
fn the_land_value_bonus_of_many_buildings_is_capped() {
    let mut s = bare();
    for i in 0..9 {
        s.place_structure(GENRE_PARK, 30 + 2 * (i % 3), 30 + 2 * (i / 3));
    }
    let bonus = s.ext_land_value(32, 32, 100) - 100;
    assert_eq!(bonus, LAND_VALUE_CAP);
    assert!(CATALOG[0].bonus * 9 > LAND_VALUE_CAP);
}

#[test]
fn the_hooks_draw_no_random_number() {
    let mut s = bare();
    s.place_structure(GENRE_PARK, 40, 30);
    let before = s.rng.clone();
    s.ext_land_value(40, 30, 100);
    s.ext_valves();
    s.ext_monthly_balance();
    let _ = s.structure_preview(1, 20, 20);
    assert_eq!(s.rng.clone().random16(), before.clone().random16());
}

#[test]
fn the_water_tool_dozes_a_tile_and_the_repair_removes_the_rest() {
    let mut s = bare();
    s.place_structure(GENRE_MONUMENT, 40, 30);
    assert_eq!(s.do_tool(EditingTool::Water, 41, 31), ToolResult::Ok);
    assert!(s.structures().is_empty());
    for x in 40..43 {
        for y in 30..33 {
            if (x, y) != (41, 31) {
                assert_eq!(s.tile(x, y), Some(DIRT), "{x},{y}");
            }
        }
    }
    assert!(!s.repair_structures());
}

#[test]
fn the_bulldozer_hook_is_off_with_the_rule_off() {
    let mut s = bare();
    s.place_structure(GENRE_MONUMENT, 40, 30);
    s.set_structure_rules(false);
    let before = s.tile(40, 30);
    let _ = s.do_tool(EditingTool::Bulldozer, 41, 31);
    assert_eq!(s.tile(40, 30), before);
}

#[test]
fn tool_drag_with_the_bulldozer_removes_the_building_at_once() {
    let mut s = bare();
    s.place_structure(GENRE_MONUMENT, 40, 30);
    assert_eq!(s.do_tool(EditingTool::Bulldozer, 42, 32), ToolResult::Ok);
    assert_eq!(s.tile(40, 30), Some(DIRT));
}

#[test]
fn the_simulation_leaves_the_buildings_alone() {
    let mut s = Simulation::new(120, 100);
    s.new_random_city(11);
    support::starter(&mut s);
    s.total_funds = MONEY;
    s.set_structure_rules(true);
    let mut placed = 0;
    for x in (2..110).step_by(9) {
        for y in (2..90).step_by(9) {
            if s.place_structure(1 + (placed % 3) as u8, x, y) == ToolResult::Ok {
                placed += 1;
            }
        }
    }
    assert!(placed >= 10, "only {placed} placed");
    run(&mut s, 600);
    assert_eq!(s.structures().len(), placed);
    assert!(s.structures_upkeep() > 0);
}
