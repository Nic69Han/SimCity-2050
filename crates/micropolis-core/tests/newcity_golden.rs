//! `Simulation::new_random_city` against the original C++ engine.
//!
//! `reference/gold/newcity_rng.out` was produced by `reference/gold/newcity_rng.cpp`
//! (the original `generateSomeCity(seed)` and `generateMap()`, with the oracle's
//! `MICROPOLIS_SEED` patch). Per line: entry (`some` or `map`), seed, number of DIRT
//! tiles, funds, city time, tax, and the next six `getRandom16()` values after generation. The random stream is not visible in
//! the per-tick fingerprints of an empty new city, so it is checked here.

use micropolis_core::simulation::Simulation;
use micropolis_core::tile_chars::DIRT;

#[test]
fn new_random_city_matches_cpp_generate_some_city() {
    let golden = include_str!("../../../reference/gold/newcity_rng.out");
    let mut checked = 0;
    for line in golden.lines() {
        let mut entry = None;
        let mut seed = None;
        let mut dirt = None;
        let mut funds = None;
        let mut time = None;
        let mut tax = None;
        let mut rands = Vec::new();
        for field in line.split_whitespace() {
            let (k, v) = field.split_once('=').expect("key=value");
            match k {
                "entry" => entry = Some(v.to_string()),
                "seed" => seed = Some(v.parse::<i32>().unwrap()),
                "dirt" => dirt = Some(v.parse::<usize>().unwrap()),
                "totalFunds" => funds = Some(v.parse::<i64>().unwrap()),
                "cityTime" => time = Some(v.parse::<i64>().unwrap()),
                "tax" => tax = Some(v.parse::<i16>().unwrap()),
                "r" => rands.push(v.parse::<i32>().unwrap()),
                other => panic!("unknown field {other}"),
            }
        }
        let seed = seed.unwrap();
        let mut s = Simulation::with_default_size();
        if entry.as_deref() == Some("map") {
            s.sim_init();
            s.rng.seed(seed);
            s.generate_map();
        } else {
            s.new_random_city(seed);
        }
        assert_eq!(
            s.tiles.iter().filter(|&&t| t == DIRT).count(),
            dirt.unwrap(),
            "dirt tiles, seed {seed}"
        );
        assert_eq!(s.total_funds, funds.unwrap(), "funds, seed {seed}");
        assert_eq!(s.city_time, time.unwrap(), "city time, seed {seed}");
        assert_eq!(s.city_tax, tax.unwrap(), "tax, seed {seed}");
        for (i, r) in rands.iter().enumerate() {
            assert_eq!(s.rng.random16(), *r, "random draw {i}, seed {seed}");
        }
        checked += 1;
    }
    assert_eq!(checked, 12);
}
