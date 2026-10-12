//! Native tests of the wasm adapter's map sizes on the real engine: `City::new_sized`, the
//! size limits, tools at the far corners of a big map, and the saveable rule (every size is
//! saveable since wave 6; `save_cty` still writes only 120x100).
//! Error paths build a `JsError` and can only run on the wasm target; they are covered by
//! the unit tests of `src/sizes.rs` and by web/test/wasm-sizes.test.mjs.

use micropolis_wasm::City;

#[test]
fn size_limits_are_the_engine_limits() {
    assert_eq!(City::size_limits(), vec![80, 67, 512, 512]);
}

#[test]
fn new_sized_builds_the_requested_map() {
    for (w, h) in [(80, 67), (97, 83), (160, 120), (300, 250), (90, 300)] {
        let city = City::new_sized(w, h, 1).expect("size in range");
        assert_eq!((city.width(), city.height()), (w, h), "{w}x{h}");
        assert_eq!(city.tiles().len(), (w * h) as usize, "{w}x{h}");
        assert_eq!(city.speed(), 3);
        assert_eq!(city.year(), 1900);
        assert!(city.is_saveable(), "{w}x{h}: every size is saveable");
    }
}

#[test]
fn new_sized_at_120x100_is_the_original_random_city() {
    let sized = City::new_sized(120, 100, 4).expect("size in range");
    let mut plain = City::new(1);
    plain.new_random_city(4);
    assert_eq!(sized.tiles(), plain.tiles());
    assert_eq!(sized.funds(), plain.funds());
    assert!(sized.is_saveable());
    assert_eq!(sized.save_checked().expect("saveable").len(), 27_120);
}

#[test]
fn tools_work_at_the_far_corners_of_a_big_map() {
    let mut city = City::new_sized(300, 250, 2).expect("size in range");
    // The page's preview and click must agree at every corner.
    for (x, y) in [(0, 0), (299, 0), (0, 249), (299, 249)] {
        let preview = city.tool_preview(9, x, y);
        let result = city.tool_down(9, x, y);
        assert_eq!(
            result, preview[0],
            "({x},{y}): the preview is what the click does"
        );
    }
    // Off the map: refused, as on the original size.
    assert_eq!(city.tool_down(9, 300, 0), 0);
    assert_eq!(city.tool_down(9, 0, 250), 0);
}

#[test]
fn a_sized_city_runs_and_is_deterministic() {
    let mut a = City::new_sized(240, 200, 7).expect("size in range");
    let mut b = City::new_sized(240, 200, 7).expect("size in range");
    for _ in 0..200 {
        a.tick();
        b.tick();
    }
    assert_eq!(a.tiles(), b.tiles());
    assert_eq!(a.funds(), b.funds());
    assert_eq!(a.population(), b.population());
}

#[test]
fn every_size_is_saveable_as_a_city_file() {
    for (w, h) in [(100, 80), (120, 101), (120, 100), (300, 250)] {
        let city = City::new_sized(w, h, 1).expect("size in range");
        assert!(city.is_saveable(), "{w}x{h}");
        let file = city.save_city().expect("saved");
        if (w, h) == (120, 100) {
            assert_eq!(file.len(), 27_120);
        } else {
            assert_eq!(&file[..4], b"MCTY", "{w}x{h}");
        }
    }
}

#[test]
fn adopt_replaces_the_city_in_place() {
    let mut city = City::new(1);
    let fresh = City::new_sized(160, 120, 2).expect("size in range");
    let expected = City::new_sized(160, 120, 2).expect("size in range").tiles();
    city.adopt(fresh);
    assert_eq!((city.width(), city.height()), (160, 120));
    assert_eq!(city.tiles(), expected);
    assert!(city.is_saveable());
}
