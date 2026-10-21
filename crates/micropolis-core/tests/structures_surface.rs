//! The surface tile is shared by every genre (docs/game-design-v05.md, « Contrainte technique »):
//! ownership is read from the list, v0.4 files (one tile per genre) load unchanged, and the bus
//! stop needs a road next to it.

use micropolis_core::simulation::Simulation;
use micropolis_core::structures::{
    is_surface, kind_of, CATALOG, GENRE_BUS_DEPOT, GENRE_BUS_STOP, GENRE_MONUMENT, GENRE_PARK,
    GENRE_PLAZA, GENRE_TAXI_DEPOT, LEGACY_SURFACE_LAST, SURFACE_BITS, SURFACE_TILE,
};
use micropolis_core::tile::{LOMASK, PWRBIT, RAILBASE};
use micropolis_core::tile_chars::{DIRT, RIVER, ROADS};
use micropolis_core::tool::{EditingTool, ToolResult};

const MONEY: i64 = 10_000_000;

fn bare() -> Simulation {
    let mut s = Simulation::new(90, 70);
    s.tiles.fill(DIRT);
    s.total_funds = MONEY;
    s.set_structure_rules(true);
    s.set_service_rules(true); // the service genres of the catalog need it
    s.set_energy_rules(true); // and the power plants
    s
}

fn tile(s: &Simulation, x: i32, y: i32) -> u16 {
    s.tile(x, y).unwrap() & LOMASK
}

#[test]
fn every_genre_leaves_the_same_surface_tile() {
    let mut s = bare();
    for (i, k) in CATALOG.iter().enumerate() {
        let (x, y) = (5 + 6 * (i % 12) as i32, 20 + 10 * (i / 12) as i32);
        s.set_tile(x, y - 1, ROADS); // a road for the bus stop
        s.set_tile(x - 1, y, RAILBASE); // a rail for the gare
        s.set_tile(x, y + k.height, RIVER); // water for the hydroelectric plant
        assert_eq!(
            s.place_structure(k.genre, x, y),
            ToolResult::Ok,
            "{}",
            k.genre
        );
        for dx in 0..k.width {
            for dy in 0..k.height {
                let t = s.tile(x + dx, y + dy).unwrap();
                assert_eq!(t, SURFACE_TILE | SURFACE_BITS, "genre {}", k.genre);
            }
        }
    }
    assert_eq!(s.structures().len(), CATALOG.len());
    assert!((1019..=1023).contains(&SURFACE_TILE));
}

#[test]
fn the_list_tells_the_genres_apart_not_the_tile() {
    let mut s = bare();
    s.set_tile(10, 19, ROADS);
    assert_eq!(s.place_structure(GENRE_BUS_STOP, 10, 20), ToolResult::Ok);
    assert_eq!(s.place_structure(GENRE_TAXI_DEPOT, 20, 20), ToolResult::Ok);
    assert_eq!(s.place_structure(GENRE_BUS_DEPOT, 30, 20), ToolResult::Ok);
    let genres: Vec<u8> = s.structures().iter().map(|v| v.genre).collect();
    assert_eq!(genres, [GENRE_BUS_STOP, GENRE_TAXI_DEPOT, GENRE_BUS_DEPOT]);
    // removing one leaves the others (same tile, other owner)
    assert_eq!(s.remove_structure(21, 21), ToolResult::Ok);
    let genres: Vec<u8> = s.structures().iter().map(|v| v.genre).collect();
    assert_eq!(genres, [GENRE_BUS_STOP, GENRE_BUS_DEPOT]);
    assert_eq!(tile(&s, 20, 20), DIRT);
    assert_eq!(tile(&s, 30, 20), SURFACE_TILE);
    // a loose surface tile that nobody owns is cleaned by the monthly check
    s.set_tile(50, 50, SURFACE_TILE);
    s.ext_monthly_balance();
    assert_eq!(tile(&s, 50, 50), DIRT);
    assert_eq!(s.structures().len(), 2);
}

#[test]
fn a_bus_stop_needs_a_road_on_one_of_its_four_sides() {
    let mut s = bare();
    let near = |s: &mut Simulation, (rx, ry): (i32, i32)| {
        s.set_tile(rx, ry, ROADS);
        let p = s.structure_preview(GENRE_BUS_STOP, 30, 30);
        s.set_tile(rx, ry, DIRT);
        p.result
    };
    assert_eq!(
        s.structure_preview(GENRE_BUS_STOP, 30, 30).result,
        ToolResult::Failed
    );
    assert_eq!(
        s.place_structure(GENRE_BUS_STOP, 30, 30),
        ToolResult::Failed
    );
    assert_eq!((s.structures().len(), s.total_funds), (0, MONEY));
    for side in [(30, 29), (31, 30), (30, 31), (29, 30)] {
        assert_eq!(near(&mut s, side), ToolResult::Ok, "{side:?}");
    }
    // a diagonal road does not count
    for corner in [(29, 29), (31, 29), (31, 31), (29, 31)] {
        assert_eq!(near(&mut s, corner), ToolResult::Failed, "{corner:?}");
    }
    // the preview and the cost
    s.set_tile(30, 29, ROADS);
    let p = s.structure_preview(GENRE_BUS_STOP, 30, 30);
    assert_eq!(
        (p.result, p.cost),
        (ToolResult::Ok, kind_of(GENRE_BUS_STOP).unwrap().cost)
    );
    // a 2 x 2 depot has no such rule
    assert_eq!(s.place_structure(GENRE_BUS_DEPOT, 60, 30), ToolResult::Ok);
    // a road on the stop's own tile is not bare land
    s.set_tile(31, 29, ROADS);
    assert_eq!(
        s.place_structure(GENRE_BUS_STOP, 30, 29),
        ToolResult::NeedBulldoze
    );
}

/// What a v0.4 city holds: the buildings with one tile character per genre (1019 + genre - 1).
fn v04_city() -> Simulation {
    let mut s = bare();
    for (g, x) in [(GENRE_PARK, 20), (GENRE_PLAZA, 30), (GENRE_MONUMENT, 40)] {
        assert_eq!(s.place_structure(g, x, 20), ToolResult::Ok);
        let k = kind_of(g).unwrap();
        for dx in 0..k.width {
            for dy in 0..k.height {
                s.set_tile(x + dx, 20 + dy, (1018 + u16::from(g)) | SURFACE_BITS);
            }
        }
    }
    s
}

#[test]
fn a_v04_file_with_one_tile_per_genre_loads_and_behaves_as_before() {
    let old = v04_city();
    assert_eq!(tile(&old, 30, 20), LEGACY_SURFACE_LAST - 1);
    let mut loaded = Simulation::with_default_size();
    loaded.load_city(&old.save_city(), 1).expect("a v0.4 file");
    assert_eq!(loaded.structures(), old.structures());
    assert_eq!(loaded.structures().len(), 3);
    for v in loaded.structures() {
        for dx in 0..v.width {
            for dy in 0..v.height {
                let t = tile(&loaded, v.x + dx, v.y + dy);
                assert_eq!(t, 1018 + u16::from(v.genre), "the map is kept as it was");
                assert!(is_surface(t));
            }
        }
    }
    assert_eq!(loaded.structures_upkeep(), old.structures_upkeep());
    for (x, y) in [(20, 20), (30, 20), (41, 21)] {
        assert_eq!(
            loaded.ext_land_value(x, y, 100),
            old.ext_land_value(x, y, 100)
        );
    }
    // the same rules as for new buildings: the bulldozer takes the whole building, a repair
    // keeps the intact ones, and the classic tools still refuse the tiles
    assert!(!loaded.repair_structures());
    assert_ne!(loaded.do_tool(EditingTool::Road, 41, 21), ToolResult::Ok);
    assert_eq!(
        loaded.do_tool(EditingTool::Bulldozer, 41, 21),
        ToolResult::Ok
    );
    let left: Vec<u8> = loaded.structures().iter().map(|v| v.genre).collect();
    assert_eq!(left, [GENRE_PARK, GENRE_PLAZA]);
    assert_eq!(tile(&loaded, 40, 20), DIRT);
    // power still reaches the old tiles through the same bit
    let t = loaded.tile(20, 20).unwrap();
    loaded.set_tile(20, 20, t | PWRBIT);
    assert_eq!(loaded.structures()[0].state & 1, 1);
}

#[test]
fn old_and_new_surface_tiles_can_sit_side_by_side() {
    let mut s = v04_city();
    s.set_tile(50, 29, ROADS);
    assert_eq!(s.place_structure(GENRE_BUS_STOP, 50, 30), ToolResult::Ok);
    assert_eq!(s.structures().len(), 4);
    let file = s.save_city();
    let mut back = Simulation::with_default_size();
    back.load_city(&file, 1).unwrap();
    assert_eq!(back.structures(), s.structures());
    assert_eq!(tile(&back, 50, 30), SURFACE_TILE);
    assert_eq!(tile(&back, 30, 20), 1018 + u16::from(GENRE_PLAZA));
}
