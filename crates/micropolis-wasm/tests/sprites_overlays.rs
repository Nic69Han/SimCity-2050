//! Native tests of the sprite records and the map overlays of the wasm `City`
//! (translation only: the engine's own sprites and maps, flattened).

use micropolis_wasm::City;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");
const KYOTO: &[u8] = include_bytes!("../../../assets/cities/kyoto.cty");
const YOKOHAMA: &[u8] = include_bytes!("../../../assets/cities/yokohama.cty");

const WORLD_W: i32 = 120;
const WORLD_H: i32 = 100;

fn loaded(bytes: &[u8]) -> City {
    let mut city = City::new(1);
    city.load_cty(bytes).expect("sample loads");
    city
}

/// Runs `ticks` ticks at speed 3 with disasters on: the sprites come from those.
fn run(city: &mut City, ticks: usize) {
    city.set_speed(3);
    city.enable_disasters(true);
    for _ in 0..ticks {
        city.tick();
    }
}

#[test]
fn a_fresh_city_has_no_sprites() {
    assert!(City::new(1).sprites().is_empty());
}

#[test]
fn sprite_records_are_whole_and_have_valid_kinds() {
    for bytes in [HAIGHT, KYOTO, YOKOHAMA] {
        let mut city = loaded(bytes);
        run(&mut city, 600);
        let flat = city.sprites();
        assert_eq!(flat.len() % 8, 0, "records of 8 integers");
        for rec in flat.chunks(8) {
            let [kind, frame, _x, _y, _xh, _yh, w, h] = rec else {
                unreachable!()
            };
            assert!((1..=8).contains(kind), "kind {kind} is a SpriteType");
            assert_ne!(*frame, 0, "inactive sprites are left out");
            assert!(*w > 0 && *h > 0, "a sprite has a size");
        }
    }
}

#[test]
fn sprites_show_up_in_a_city_that_runs() {
    // Trains, ships, planes, monsters and disasters all come from the simulation: a few
    // thousand ticks on the samples must produce at least one moving object.
    let mut seen = 0;
    for bytes in [HAIGHT, KYOTO, YOKOHAMA] {
        let mut city = loaded(bytes);
        for _ in 0..6 {
            run(&mut city, 500);
            seen += city.sprites().len() / 8;
        }
    }
    assert!(
        seen > 0,
        "no sprite in any sample after several thousand ticks"
    );
}

#[test]
fn overlay_layouts_match_the_engine_maps() {
    let mut city = loaded(HAIGHT);
    run(&mut city, 200);
    // (kind, block) as the engine's maps are declared: population 2, land value 2, crime 2,
    // pollution 2, traffic 2, power grid 1, fire and police coverage 8.
    let expected = [
        (0, 2),
        (1, 2),
        (2, 2),
        (3, 2),
        (4, 2),
        (5, 1),
        (6, 8),
        (7, 8),
    ];
    for (kind, block) in expected {
        let layout = city.overlay_layout(kind);
        assert_eq!(layout.len(), 3, "kind {kind}: [block, cols, rows]");
        assert_eq!(layout[0], block, "kind {kind} block size");
        let (cols, rows) = (layout[1], layout[2]);
        assert_eq!(cols, (WORLD_W + block - 1) / block, "kind {kind} cols");
        assert_eq!(rows, (WORLD_H + block - 1) / block, "kind {kind} rows");
        assert_eq!(
            city.overlay(kind).len(),
            (cols * rows) as usize,
            "kind {kind} cell count"
        );
    }
}

#[test]
fn unknown_overlay_kinds_are_empty() {
    let city = loaded(HAIGHT);
    for kind in [-1, 8, 99] {
        assert!(city.overlay_layout(kind).is_empty(), "kind {kind}");
        assert!(city.overlay(kind).is_empty(), "kind {kind}");
    }
}

#[test]
fn population_overlay_shows_the_city() {
    let mut city = loaded(HAIGHT);
    run(&mut city, 300);
    let cells = city.overlay(0);
    assert!(
        cells.iter().any(|&v| v > 0),
        "a populated city has population density somewhere"
    );
    assert!(cells.contains(&0), "and empty ground elsewhere");
}

#[test]
fn coverage_overlays_are_bytes_in_range() {
    let mut city = loaded(KYOTO);
    run(&mut city, 300);
    // Every byte is 0..=255 by construction; the coverage maps must at least exist.
    assert!(!city.overlay(6).is_empty());
    assert!(!city.overlay(7).is_empty());
}
