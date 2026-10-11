//! Golden tests for `scan.rs`, produced by `reference/gold/scan_harness.cpp`
//! running the ORIGINAL C++ engine. See that file for how the golden text was
//! generated and for the injected inputs (they must match `inject` below).
//!
//! The scan input is the post-load tile map `scan_haight_tiles.txt`, dumped by
//! `scan_harness tiles`. Both sides load that dump instead of `load_cty`
//! (see the harness for why). Regenerate (from the repository root):
//!   reference/build-harness.sh reference/gold/scan_harness.cpp $OUT/scan_harness
//!   $OUT/scan_harness chain      > reference/gold/scan_haight.txt
//!   $OUT/scan_harness population > reference/gold/scan_population.txt
//!   $OUT/scan_harness empty      > reference/gold/scan_empty.txt
//! Regenerate `scan_haight_tiles.txt` (`scan_harness tiles`) only deliberately:
//! it changes the input of every golden file above.

use std::fmt::{Display, Write};

use micropolis_core::map::Map;
use micropolis_core::simulation::Simulation;

const GOLD_CHAIN: &str = include_str!("../../../reference/gold/scan_haight.txt");
const GOLD_EMPTY: &str = include_str!("../../../reference/gold/scan_empty.txt");
const GOLD_POPULATION: &str = include_str!("../../../reference/gold/scan_population.txt");
const GOLD_TILES: &str = include_str!("../../../reference/gold/scan_haight_tiles.txt");

/// Same deterministic formula as `pattern()` in the C++ harness.
fn pattern(x: i32, y: i32, salt: i32, modulus: i32) -> i32 {
    (x * 131 + y * 17 + salt * 29) % modulus
}

/// `MAP <name> <W> <H>` then the cluster values in column-major order.
fn dump_map<T: Copy + Display>(out: &mut String, name: &str, m: &Map<T>) {
    let (w, h) = m.size();
    writeln!(out, "MAP {name} {w} {h}").unwrap();
    let mut first = true;
    for x in 0..w {
        for y in 0..h {
            if !first {
                out.push(' ');
            }
            first = false;
            write!(out, "{}", m.get(x, y)).unwrap();
        }
    }
    out.push('\n');
}

fn scalar(out: &mut String, name: &str, v: impl Display) {
    writeln!(out, "SCALAR {name} {v}").unwrap();
}

/// Same hash as `fnvTiles` in the C++ harness.
fn tiles_hash(sim: &Simulation) -> u64 {
    let mut h: u64 = 1_469_598_103_934_665_603;
    for &p in &sim.tiles {
        h ^= u64::from(p & 0xff);
        h = h.wrapping_mul(1_099_511_628_211);
        h ^= u64::from(p >> 8);
        h = h.wrapping_mul(1_099_511_628_211);
    }
    h
}

/// The haight.cty post-load tile map, as dumped from the C++ engine by the
/// `tiles` mode of the harness. The scans only read tiles and the maps that
/// the test injects, so they are fed this dump directly. `load_cty` is not
/// used: the Rust loader does not yet run the `doSimInit` steps (power scan,
/// road/rail fix-ups), and the C++ load result itself varies between runs.
fn loaded_haight() -> Simulation {
    let mut sim = Simulation::with_default_size();
    let tokens: Vec<u16> = GOLD_TILES
        .split_whitespace()
        .map(|t| t.parse().expect("tile value"))
        .collect();
    assert_eq!(tokens.len(), sim.tiles.len());
    // Dump is column-major: one line per x, 100 values per line.
    sim.tiles.copy_from_slice(&tokens);
    sim
}

/// Injects the same deterministic values as `runChain` in the C++ harness.
fn inject(sim: &mut Simulation) {
    let (fw, fh) = sim.fire_station_map.size();
    for x in 0..fw {
        for y in 0..fh {
            sim.fire_station_map
                .set(x, y, pattern(x, y, 1, 1000) as i16);
            sim.police_station_map
                .set(x, y, pattern(x, y, 2, 1000) as i16);
        }
    }
    let (pw, ph) = sim.population_density_map.size();
    for x in 0..pw {
        for y in 0..ph {
            sim.population_density_map
                .set(x, y, pattern(x, y, 3, 255) as u8);
        }
    }
    let (cw, ch) = sim.crime_rate_map.size();
    for x in 0..cw {
        for y in 0..ch {
            sim.crime_rate_map.set(x, y, pattern(x, y, 5, 256) as u8);
        }
    }
    let (tw, th) = sim.terrain_density_map.size();
    for x in 0..tw {
        for y in 0..th {
            sim.terrain_density_map
                .set(x, y, pattern(x, y, 4, 256) as u8);
        }
    }
    let (dw, dh) = sim.pollution_density_map.size();
    for x in 0..dw {
        for y in 0..dh {
            sim.pollution_density_map
                .set(x, y, pattern(x, y, 6, 256) as u8);
        }
    }
}

/// One variant of the chain, in the same order as `runChain` in the C++ harness.
fn run_chain(dither: i64, seed: i32) -> String {
    let mut sim = loaded_haight();
    let mut out = String::new();
    writeln!(out, "RUN dither={dither} seed={seed}").unwrap();

    sim.don_dither = dither;
    sim.rng.seed(seed);
    sim.city_center_x = 55;
    sim.city_center_y = 47;
    inject(&mut sim);

    sim.fire_analysis();
    sim.pollution_terrain_land_value_scan();
    sim.crime_scan();
    sim.compute_com_rate_map();

    dump_map(&mut out, "fireStationMap", &sim.fire_station_map);
    dump_map(
        &mut out,
        "fireStationEffectMap",
        &sim.fire_station_effect_map,
    );
    dump_map(&mut out, "policeStationMap", &sim.police_station_map);
    dump_map(
        &mut out,
        "policeStationEffectMap",
        &sim.police_station_effect_map,
    );
    dump_map(
        &mut out,
        "populationDensityMap",
        &sim.population_density_map,
    );
    dump_map(&mut out, "comRateMap", &sim.com_rate_map);
    dump_map(&mut out, "landValueMap", &sim.land_value_map);
    dump_map(&mut out, "pollutionDensityMap", &sim.pollution_density_map);
    dump_map(&mut out, "crimeRateMap", &sim.crime_rate_map);
    dump_map(&mut out, "terrainDensityMap", &sim.terrain_density_map);
    dump_map(&mut out, "tempMap1", &sim.temp_map1);
    dump_map(&mut out, "tempMap2", &sim.temp_map2);
    dump_map(&mut out, "tempMap3", &sim.temp_map3);
    scalar(&mut out, "landValueAverage", sim.land_value_average);
    scalar(&mut out, "pollutionAverage", sim.pollution_average);
    scalar(&mut out, "crimeAverage", sim.crime_average);
    scalar(&mut out, "pollutionMaxX", sim.pollution_max_x);
    scalar(&mut out, "pollutionMaxY", sim.pollution_max_y);
    scalar(&mut out, "crimeMaxX", sim.crime_max_x);
    scalar(&mut out, "crimeMaxY", sim.crime_max_y);
    scalar(&mut out, "cityCenterX", sim.city_center_x);
    scalar(&mut out, "cityCenterY", sim.city_center_y);
    scalar(&mut out, "donDither", sim.don_dither);
    scalar(&mut out, "tiles_hash", tiles_hash(&sim));
    out
}

fn population_dump(sim: &Simulation) -> String {
    let mut out = String::new();
    dump_map(
        &mut out,
        "populationDensityMap",
        &sim.population_density_map,
    );
    dump_map(&mut out, "comRateMap", &sim.com_rate_map);
    dump_map(&mut out, "tempMap1", &sim.temp_map1);
    dump_map(&mut out, "tempMap2", &sim.temp_map2);
    scalar(&mut out, "cityCenterX", sim.city_center_x);
    scalar(&mut out, "cityCenterY", sim.city_center_y);
    scalar(&mut out, "tiles_hash", tiles_hash(sim));
    out
}

/// Each (donDither, seed) variant of the C++ chain, in harness order.
/// Dither 0 = none, 1 = terrain dither, 6 = both smoothing dithers, 7 = all.
#[test]
fn chain_matches_cpp_on_haight() {
    let variants = [(0, 42), (1, 42), (6, 7), (7, 1)];
    let mut actual = String::new();
    for (dither, seed) in variants {
        actual.push_str(&run_chain(dither, seed));
    }
    assert_eq!(actual, GOLD_CHAIN);
}

/// Blank map: `populationDensityScan` takes the no-zones branch, so this never
/// reaches the zone helpers and runs on the Rust side today.
#[test]
fn population_scan_matches_cpp_on_empty_map() {
    let mut sim = Simulation::with_default_size();
    let mut out = String::from("RUN population empty\n");
    sim.population_density_scan();
    out.push_str(&population_dump(&sim));
    assert_eq!(out, GOLD_EMPTY);
}

/// Needs the zone module: `get_population_density` calls `do_free_pop`,
/// `get_res_zone_pop`, `get_com_zone_pop` and `get_ind_zone_pop`, which are
/// `todo!()` in `shim_scan.rs` until zone.rs lands. Remove the `#[ignore]` then.
#[test]
#[ignore = "needs zone.rs (doFreePop, getResZonePop, getComZonePop, getIndZonePop)"]
fn population_scan_matches_cpp_on_haight() {
    let mut sim = loaded_haight();
    sim.population_density_scan();
    let out = format!("RUN population haight\n{}", population_dump(&sim));
    assert_eq!(out, GOLD_POPULATION);
}
