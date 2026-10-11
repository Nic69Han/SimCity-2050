//! Golden test for `animate.cpp`: compares `get_next_animated_tile` for every
//! index and `animate_tiles` on a synthetic map and on the Haight city with the
//! values printed by the ORIGINAL C++ engine.
//!
//! Produced by `reference/gold/animate_tiles.cpp` (see `reference/gold/animate_tiles.out`):
//!   reference/build-harness.sh reference/gold/animate_tiles.cpp reference/build/animate_tiles
//!   reference/build/animate_tiles > reference/gold/animate_tiles.out

use micropolis_core::simulation::Simulation;

fn fnv(tiles: &[u16]) -> u64 {
    let mut h: u64 = 1469598103934665603;
    for &t in tiles {
        h ^= (t & 0xff) as u64;
        h = h.wrapping_mul(1099511628211);
        h ^= (t >> 8) as u64;
        h = h.wrapping_mul(1099511628211);
    }
    h
}

fn golden() -> Vec<(String, String)> {
    let text = include_str!("../../../reference/gold/animate_tiles.out");
    text.lines()
        .map(|l| {
            let mut it = l.splitn(2, ' ');
            (
                it.next().unwrap().to_string(),
                it.next().unwrap_or("").to_string(),
            )
        })
        .collect()
}

#[test]
fn next_animated_tile_matches_cpp_for_every_index() {
    let s = Simulation::with_default_size();
    let mut checked = 0;
    for line in include_str!("../../../reference/gold/animate_tiles.out").lines() {
        let mut it = line.split_whitespace();
        if it.next() != Some("next") {
            continue;
        }
        let i: i32 = it.next().unwrap().parse().unwrap();
        let want: i32 = it.next().unwrap().parse().unwrap();
        assert_eq!(s.get_next_animated_tile(i), want, "index {i}");
        checked += 1;
    }
    assert_eq!(checked, 1028);
}

#[test]
fn animate_tiles_matches_cpp_on_synthetic_and_city_maps() {
    let g = golden();
    let get = |key: &str| -> String {
        g.iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_else(|| panic!("missing {key}"))
    };
    let n = 120 * 100;

    // Synthetic map, same formula as the C++ harness.
    let mut s = Simulation::with_default_size();
    for i in 0..n {
        s.tiles[i] = ((i as u32 * 37 + i as u32 / 3) & 0xffff) as u16;
    }
    assert_eq!(format!("{:016x}", fnv(&s.tiles)), get("synth_before"));
    s.animate_tiles();
    assert_eq!(format!("{:016x}", fnv(&s.tiles)), get("synth_after"));

    // Real city.
    let bytes = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../assets/cities/haight.cty"
    ))
    .unwrap();
    let mut c = Simulation::with_default_size();
    c.load_cty_data(&bytes).unwrap();
    assert_eq!(format!("{:016x}", fnv(&c.tiles)), get("city_before"));
    c.animate_tiles();
    assert_eq!(format!("{:016x}", fnv(&c.tiles)), get("city_after"));
}
