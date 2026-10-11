//! Golden tests for `power.rs` (port of `power.cpp`).
//!
//! The expected values come from the ORIGINAL C++ engine, via
//! `reference/gold/power_scan.cpp` (build: `reference/build-harness.sh`, run with
//! `MICROPOLIS_SEED=1 reference/build/power_scan haight` and `... custom`).
//! The harness output for `haight` is the source of the seed stack and of the
//! `power_count` / `power_hash` values below.

use micropolis_core::position::Position;
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::{Tile, BULLBIT, BURNBIT, CONDBIT};
use micropolis_core::tile_chars::*;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");

/// FNV-1a over bytes (same as `fnv_bytes` in the harness).
fn fnv_bytes(bytes: &[u8]) -> u64 {
    let mut h: u64 = 1469598103934665603;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    h
}

/// Hash of the CONDBIT plane (one byte per tile, column-major).
fn condbit_hash(tiles: &[Tile]) -> u64 {
    let plane: Vec<u8> = tiles.iter().map(|&t| u8::from(t & CONDBIT != 0)).collect();
    fnv_bytes(&plane)
}

/// Power-plant seeds, in stack order (stack entries 1..=6 from the C++ mapScan).
const HAIGHT_SEEDS: [(i32, i32); 6] = [(93, 2), (97, 2), (102, 2), (106, 2), (112, 2), (116, 2)];

// NOTE: the C++ `loadFile` also runs `doSimInit` (mapScan etc.), which the Rust `load_cty`
// does not do yet, so the full Rust tile array differs from the C++ one after load. Only the
// CONDBIT plane, which is identical, is compared here.
#[test]
fn haight_loaded_condbit_plane_matches_cpp() {
    let mut s = Simulation::with_default_size();
    s.load_cty(HAIGHT).expect("haight.cty loads");
    assert_eq!(
        condbit_hash(&s.tiles),
        0x81a4_a60c_d6ed_3d28,
        "CONDBIT plane"
    );
}

#[test]
fn haight_power_scan_matches_cpp() {
    let mut s = Simulation::with_default_size();
    s.load_cty(HAIGHT).expect("haight.cty loads");
    // The plant counts and the power stack are what mapScan produces in the C++ run
    // (doSpecialZone counts and pushes POWERPLANT/NUCLEAR tiles). mapScan is not ported
    // yet, so they are set here explicitly. The CONDBIT plane is already identical (see above).
    s.coal_power_pop = 0;
    s.nuclear_power_pop = 6;
    s.power_stack_pointer = 0;
    for (x, y) in HAIGHT_SEEDS {
        s.push_power_stack(Position::new(x, y));
    }
    assert_eq!(s.power_stack_pointer, 6);

    s.do_power_scan();

    let grid = s.power_grid_map.as_slice();
    let powered = grid.iter().filter(|&&v| v != 0).count();
    assert_eq!(powered, 6253, "powered tile count");
    assert_eq!(fnv_bytes(grid), 0x81a4_a60c_d6ed_3d28, "powerGridMap hash");
    assert_eq!(s.power_stack_pointer, 0, "stack drained");
}

#[test]
fn hand_built_grid_matches_cpp() {
    // Same grid as custom_grid() in reference/gold/power_scan.cpp.
    let mut s = Simulation::with_default_size();
    for x in 0..120 {
        for y in 0..100 {
            s.set_tile(x, y, DIRT);
        }
    }
    let wire = CONDBIT | BURNBIT | BULLBIT;
    for x in 10..=40 {
        s.set_tile(x, 10, LHPOWER | wire);
    }
    for y in 11..=30 {
        s.set_tile(25, y, LVPOWER | wire);
    }
    for x in 5..=9 {
        s.set_tile(x, 50, LHPOWER | wire); // unseeded island
    }
    s.set_tile(60, 60, HROADPOWER | wire);
    s.set_tile(61, 60, HROADPOWER | wire);
    s.set_tile(60, 61, VROADPOWER | wire);
    s.set_tile(61, 61, VROADPOWER | wire);
    s.set_tile(70, 70, HPOWER | wire); // diagonal-only neighbour
    s.set_tile(41, 10, ROADS); // non-conductive, next to the row end

    s.coal_power_pop = 1;
    s.nuclear_power_pop = 0;
    s.power_stack_pointer = 0;
    s.push_power_stack(Position::new(10, 10));
    s.push_power_stack(Position::new(60, 60));

    s.do_power_scan();

    let grid = s.power_grid_map.as_slice();
    assert_eq!(grid.iter().filter(|&&v| v != 0).count(), 55);
    assert_eq!(fnv_bytes(grid), 0x7f90_31de_7453_1622);
    assert_eq!(s.power_stack_pointer, 0);

    // Spot checks that document the expected behaviour.
    let at = |x: i32, y: i32| s.power_grid_map.world_get(x, y) != 0;
    assert!(at(10, 10) && at(40, 10), "wire row is powered end to end");
    assert!(at(25, 30), "branch reaches its far end");
    assert!(at(61, 61), "cycle is fully powered");
    assert!(!at(5, 50), "unseeded island stays dark");
    assert!(!at(41, 10), "road is not conductive");
    assert!(!at(70, 70), "diagonal-only tile is not reached");
    assert!(!at(25, 31), "dirt just past the branch end stays dark");
}

#[test]
fn push_and_pull_respect_stack_room() {
    let mut s = Simulation::with_default_size();
    let cap = s.power_stack.len();
    // The original keeps two entries free: pushes stop once pointer >= size - 2.
    for i in 0..cap {
        s.push_power_stack(Position::new((i % 120) as i32, (i / 120) as i32));
    }
    assert_eq!(s.power_stack_pointer, cap - 2);
    let top = s.pull_power_stack();
    assert_eq!(
        top,
        Position::new(((cap - 3) % 120) as i32, ((cap - 3) / 120) as i32)
    );
    assert_eq!(s.power_stack_pointer, cap - 3);
}
