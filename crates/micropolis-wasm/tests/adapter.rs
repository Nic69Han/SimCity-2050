//! Native tests of the wasm adapter's `City` on the real engine (no JavaScript).
//! They check the translation: the tool table, previews against `tool_down`,
//! footprints, invalid ids, queries, new cities and save/load.

use micropolis_core::tile::{LOMASK, ZONEBIT};
use micropolis_core::tile_chars::DIRT;
use micropolis_core::tool::{EditingTool, TOOL_COUNT};
use micropolis_wasm::City;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");

const OK: i32 = 1;
const FAILED: i32 = 0;

fn haight() -> City {
    let mut city = City::new(1);
    if city.load_cty(HAIGHT).is_err() {
        panic!("haight.cty must load");
    }
    city
}

/// The first on-map tile where `tool` would succeed.
fn free_tile(city: &City, tool: EditingTool) -> (i32, i32) {
    for x in 0..city.width() {
        for y in 0..city.height() {
            if city.tool_preview(tool as i32, x, y)[0] == OK {
                return (x, y);
            }
        }
    }
    panic!("no free tile for {tool:?}");
}

#[test]
fn tool_table_matches_the_core() {
    let city = City::new(1);
    assert_eq!(city.tool_count(), 20);
    assert_eq!(city.tool_count() as usize, TOOL_COUNT);
    for (i, tool) in EditingTool::ALL.iter().enumerate() {
        let i = i as u32;
        assert_eq!(
            city.tool_info(i),
            vec![*tool as i32, tool.cost(), tool.size()],
            "tool {i}"
        );
        assert_eq!(city.tool_key(i), tool.key(), "tool {i}");
    }
    assert_eq!(city.tool_info(0), vec![0, 100, 3], "residential");
    assert_eq!(city.tool_info(9), vec![9, 10, 1], "road");
}

#[test]
fn tool_table_out_of_range_is_empty() {
    let city = City::new(1);
    assert!(city.tool_info(20).is_empty());
    assert!(city.tool_info(u32::MAX).is_empty());
    assert_eq!(city.tool_key(20), "");
    assert_eq!(city.tool_key(u32::MAX), "");
}

#[test]
fn preview_matches_what_tool_down_does() {
    let mut city = haight();
    let mut checked_ok = 0;
    for id in 0..TOOL_COUNT as i32 {
        for x in (0..city.width()).step_by(9) {
            for y in (0..city.height()).step_by(11) {
                let funds_before = city.funds();
                let tiles_before = city.tiles();
                let preview = city.tool_preview(id, x, y);
                assert_eq!(city.funds(), funds_before, "preview must not spend");
                assert_eq!(city.tiles(), tiles_before, "preview must not build");

                let result = city.tool_down(id, x, y);
                assert_eq!(result, preview[0], "tool {id} at ({x}, {y})");
                let spent = funds_before - city.funds();
                if result == OK {
                    assert_eq!(spent, f64::from(preview[1]), "tool {id} at ({x}, {y})");
                    checked_ok += 1;
                } else {
                    assert_eq!(spent, 0.0, "failed tool {id} must not spend");
                    assert_eq!(preview[1], 0, "failed preview has no cost");
                }
            }
        }
    }
    assert!(checked_ok > 10, "too few successful tools: {checked_ok}");
}

#[test]
fn footprints_are_the_tool_rectangles() {
    let city = City::new(1);
    for (i, tool) in EditingTool::ALL.iter().enumerate() {
        let id = i as i32;
        let (x, y) = (30, 40);
        let size = tool.size();
        let expected = if size > 1 {
            vec![x - 1, y - 1, size, size]
        } else {
            vec![x, y, 1, 1]
        };
        assert_eq!(city.tool_footprint(id, x, y), expected, "tool {id}");
    }
    // Residential is a 3x3 zone centred on the clicked tile.
    assert_eq!(City::new(1).tool_footprint(0, 10, 10), vec![9, 9, 3, 3]);
    // Road covers the clicked tile only.
    assert_eq!(City::new(1).tool_footprint(9, 10, 10), vec![10, 10, 1, 1]);
}

#[test]
fn invalid_tool_ids_do_nothing_and_do_not_panic() {
    let mut city = haight();
    let funds = city.funds();
    let tiles = city.tiles();

    for id in [-1, 20, 99, i32::MAX, i32::MIN] {
        assert_eq!(city.tool_down(id, 10, 10), FAILED, "id {id}");
        city.tool_drag(id, 10, 10, 20, 10);
        assert_eq!(city.tool_preview(id, 10, 10), vec![FAILED, 0], "id {id}");
        assert_eq!(
            city.tool_footprint(id, 10, 10),
            vec![10, 10, 1, 1],
            "id {id}"
        );
    }
    assert_eq!(city.funds(), funds);
    assert_eq!(city.tiles(), tiles);
}

#[test]
fn off_map_positions_do_not_panic() {
    let mut city = haight();
    let (w, h) = (city.width(), city.height());
    let points = [(-5, -5), (w, h), (w + 100, -3), (-1, h + 1)];
    let funds = city.funds();
    for tool in EditingTool::ALL {
        let id = tool as i32;
        for (x, y) in points {
            assert_eq!(city.tool_preview(id, x, y).len(), 2);
            assert_eq!(city.tool_footprint(id, x, y).len(), 4);
            let _ = city.tool_down(id, x, y);
            city.tool_drag(id, x, y, x + 1, y + 1);
        }
    }
    assert!(city.query(-1, 0).is_empty());
    assert!(city.query(w, h).is_empty());
    assert_eq!(city.tool_down(EditingTool::Road as i32, -5, -5), FAILED);
    assert!(city.funds() <= funds, "off-map tools never add funds");
}

#[test]
fn query_reports_zone_and_empty_ground() {
    let mut city = haight();

    // Bare ground: a dirt tile of the city (tiles are column-major).
    let height = city.height() as usize;
    let dirt = city
        .tiles()
        .iter()
        .position(|&t| t & LOMASK == DIRT)
        .expect("haight has dirt");
    let (dx, dy) = ((dirt / height) as i32, (dirt % height) as i32);
    let ground = city.query(dx, dy);
    assert_eq!(ground.len(), 6);

    // A residential zone built on free ground.
    let (x, y) = free_tile(&city, EditingTool::Residential);
    assert_eq!(city.tool_down(EditingTool::Residential as i32, x, y), OK);
    let zone = city.query(x, y);
    assert_eq!(zone.len(), 6);
    assert!(zone[1..].iter().all(|v| (1..=20).contains(v)), "{zone:?}");
    assert_ne!(
        zone[0], ground[0],
        "zone and bare ground have different categories"
    );
}

#[test]
fn new_random_city_is_deterministic_per_seed() {
    let mut a = City::new(1);
    let mut b = City::new(99);
    a.new_random_city(7);
    b.new_random_city(7);
    assert_eq!(a.tiles(), b.tiles());

    let mut c = City::new(1);
    c.new_random_city(8);
    assert_ne!(
        a.tiles(),
        c.tiles(),
        "different seeds give different cities"
    );
}

#[test]
fn new_random_city_starts_the_oracle_state() {
    let mut city = haight();
    city.take_events();
    city.new_random_city(3);
    assert_eq!(city.funds(), 20_000.0);
    assert_eq!(city.year(), 1900);
    assert_eq!(city.month(), 0);
    assert_eq!(city.speed(), 3);
    assert_eq!(city.take_events(), 1, "a new city announces itself once");
    assert_eq!(city.take_events(), 0);
}

#[test]
fn events_still_drain_after_tools() {
    let mut city = City::new(1);
    city.take_events();
    let (x, y) = free_tile(&city, EditingTool::Road);
    assert_eq!(city.tool_down(EditingTool::Road as i32, x, y), OK);
    city.tool_drag(EditingTool::Road as i32, x, y, x + 3, y);
    // Tools raise funds events, not new-city events.
    assert_eq!(city.take_events(), 0);
    city.new_random_city(5);
    assert_eq!(city.take_events(), 1);
}

#[test]
fn save_and_load_round_trip_after_tools() {
    let mut city = haight();
    let (rx, ry) = free_tile(&city, EditingTool::Road);
    assert_eq!(city.tool_down(EditingTool::Road as i32, rx, ry), OK);
    let (zx, zy) = free_tile(&city, EditingTool::Residential);
    assert_eq!(city.tool_down(EditingTool::Residential as i32, zx, zy), OK);
    city.tool_drag(EditingTool::Wire as i32, rx, ry, rx + 4, ry);
    let zone_before = city.query(zx, zy);
    let funds = city.funds();

    let saved = city.save_cty();
    let mut loaded = City::new(1);
    if loaded.load_cty(&saved).is_err() {
        panic!("saved city must load");
    }
    assert_eq!(loaded.funds(), funds);
    assert_eq!(
        loaded.query(zx, zy)[0],
        zone_before[0],
        "the zone is still a zone"
    );

    // `load_cty` runs the engine's load initialisation, which changes animation
    // frames of some tiles (the same as the page's load), so the tiles are not
    // compared one by one. The city, its funds and its zones survive the round trip.
    assert_eq!(
        (loaded.width(), loaded.height()),
        (city.width(), city.height())
    );
    let zones = |t: &[u16]| t.iter().filter(|&&v| v & ZONEBIT != 0).count();
    assert_eq!(zones(&loaded.tiles()), zones(&city.tiles()));
    assert!(zones(&loaded.tiles()) > 0);
}

#[test]
fn loading_a_city_does_not_depend_on_the_previous_one() {
    const KYOTO: &[u8] = include_bytes!("../../../assets/cities/kyoto.cty");

    let mut fresh = City::new(1);
    fresh.load_cty(KYOTO).unwrap();

    let mut used = haight();
    for _ in 0..200 {
        used.tick();
    }
    used.load_cty(KYOTO).unwrap();

    assert_eq!(used.tiles(), fresh.tiles());
    assert_eq!(used.funds(), fresh.funds());
    assert_eq!(used.save_cty(), fresh.save_cty());
}
