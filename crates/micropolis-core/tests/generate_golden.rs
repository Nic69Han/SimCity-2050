//! Terrain generator (`generate.cpp`) against the original C++ engine.
//!
//! `data/generate_maps.txt` was produced by `reference/gold/generate_maps.cpp`
//! (built with `reference/build-harness.sh`, run with a dump directory). Each
//! line: `seed tree lake curve island hash sample`, where `hash` is the FNV
//! hash of the 12000 tile values in storage order and `sample` is row y=50 at
//! x = 0, 10, ..., 110.

use micropolis_core::simulation::Simulation;

/// Same hash as `fnv()` in `reference/gold/generate_maps.cpp`.
fn fnv(tiles: &[u16]) -> u64 {
    let mut h: u64 = 1469598103934665603;
    for &p in tiles {
        h ^= u64::from(p & 0xff);
        h = h.wrapping_mul(1099511628211);
        h ^= u64::from(p >> 8);
        h = h.wrapping_mul(1099511628211);
    }
    h
}

#[test]
fn map_hashes_match_cpp_for_all_option_combinations() {
    let golden = include_str!("data/generate_maps.txt");
    let mut checked = 0;
    for line in golden.lines() {
        let f: Vec<i64> = line
            .split_whitespace()
            .take(5)
            .map(|v| v.parse().unwrap())
            .collect();
        let hash = u64::from_str_radix(line.split_whitespace().nth(5).unwrap(), 16).unwrap();
        let sample: Vec<u16> = line
            .split_whitespace()
            .skip(6)
            .map(|v| v.parse().unwrap())
            .collect();
        let (seed, tree, lake, curve, island) = (
            f[0] as i32,
            f[1] as i32,
            f[2] as i32,
            f[3] as i32,
            f[4] as i32,
        );

        let mut s = Simulation::with_default_size();
        s.terrain_tree_level = tree;
        s.terrain_lake_level = lake;
        s.terrain_curve_level = curve;
        s.terrain_create_island = island;
        s.generate_map_seed(seed);

        let ctx = format!("seed={seed} tree={tree} lake={lake} curve={curve} island={island}");
        assert_eq!(fnv(&s.tiles), hash, "map hash differs: {ctx}");
        let row: Vec<u16> = (0..120)
            .step_by(10)
            .map(|x| s.tile(x, 50).unwrap())
            .collect();
        assert_eq!(row, sample, "sample row differs: {ctx}");
        checked += 1;
    }
    assert_eq!(checked, 5 * 3 * 3 * 3 * 3, "golden file is incomplete");
}

/// Full 12000-tile equality with the original for two seeds (default options).
fn assert_full_map_matches(seed: i32, golden: &str) {
    let mut s = Simulation::with_default_size();
    s.generate_map_seed(seed);
    let expected: Vec<u16> = golden
        .split_whitespace()
        .map(|v| v.parse().unwrap())
        .collect();
    assert_eq!(expected.len(), 12_000);
    let first_diff = s.tiles.iter().zip(&expected).position(|(a, b)| a != b);
    assert_eq!(first_diff, None, "seed {seed}: first differing tile index");
}

#[test]
fn full_map_matches_cpp_seed_42() {
    assert_full_map_matches(42, include_str!("data/generate_full_seed42.txt"));
}

#[test]
fn full_map_matches_cpp_seed_1234() {
    assert_full_map_matches(1234, include_str!("data/generate_full_seed1234.txt"));
}

#[test]
fn larger_world_generates_deterministically() {
    let make = || {
        let mut s = Simulation::new(200, 150);
        s.generate_map_seed(77);
        s.tiles
    };
    let a = make();
    assert_eq!(a.len(), 30_000);
    assert_eq!(a, make());
}
