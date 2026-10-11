//! Golden tests for `connect.rs` (port of `connect.cpp`).
//!
//! Expected values come from the ORIGINAL C++ engine through `reference/gold/connect_golden.cpp`
//! (`reference/build/connect_golden named|random|random_noauto`). The harness drives the real
//! `ToolEffects` of tool.cpp; these tests use a minimal `Effects` implementation with the same
//! read/write semantics (a flat copy of the map, updated in place).

use micropolis_core::connect::{ConnectTileCommand as Cmd, Effects, ToolResult};
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::{Tile, BULLBIT, BURNBIT, CONDBIT};
use micropolis_core::tile_chars::*;

const W: i32 = 120;
const H: i32 = 100;

/// Flat, column-major copy of the map, as the tool sees it.
struct Fx {
    map: Vec<Tile>,
    cost: i32,
}

impl Fx {
    fn new(map: Vec<Tile>) -> Self {
        Self { map, cost: 0 }
    }
    fn idx(x: i32, y: i32) -> usize {
        (x * H + y) as usize
    }
}

impl Effects for Fx {
    fn get_map_value(&self, x: i32, y: i32) -> Tile {
        self.map[Self::idx(x, y)]
    }
    fn set_map_value(&mut self, x: i32, y: i32, value: Tile) {
        self.map[Self::idx(x, y)] = value;
    }
    fn add_cost(&mut self, amount: i32) {
        assert!(amount >= 0);
        self.cost += amount;
    }
}

/// FNV step over one 64-bit value, byte by byte (as in the harness).
fn fnv_step(mut h: u64, v: u64) -> u64 {
    for i in 0..8 {
        h ^= (v >> (8 * i)) & 0xff;
        h = h.wrapping_mul(1099511628211);
    }
    h
}

fn fnv_map(map: &[Tile]) -> u64 {
    map.iter()
        .fold(1469598103934665603u64, |h, &t| fnv_step(h, t as u64))
}

fn cmd_from(c: i32) -> Cmd {
    match c {
        0 => Cmd::Fix,
        1 => Cmd::Bulldoze,
        2 => Cmd::Road,
        3 => Cmd::Railroad,
        4 => Cmd::Wire,
        _ => unreachable!(),
    }
}

/// Apply one operation and fold (result, cost delta) into the running hash.
fn apply(
    sim: &Simulation,
    fx: &mut Fx,
    x: i32,
    y: i32,
    cmd: i32,
    hash: &mut u64,
) -> (ToolResult, i32) {
    let before = fx.cost;
    let r = sim.connect_tile(x, y, cmd_from(cmd), fx);
    let delta = fx.cost - before;
    *hash = fnv_step(*hash, (r as i32) as i64 as u64);
    *hash = fnv_step(*hash, delta as i64 as u64);
    (r, delta)
}

fn sim_with_auto(auto: bool) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.auto_bulldoze = auto;
    s
}

#[test]
fn named_scenario_matches_cpp() {
    let mut init = vec![DIRT; (W * H) as usize];
    let set = |m: &mut Vec<Tile>, x: i32, y: i32, t: Tile| m[Fx::idx(x, y)] = t;
    for x in 20..=24 {
        set(&mut init, x, 30, RIVER);
    }
    set(&mut init, 19, 30, ROADS | BULLBIT | BURNBIT);
    set(&mut init, 25, 30, LHRAIL | BULLBIT | BURNBIT);
    set(&mut init, 5, 5, LHPOWER | CONDBIT | BULLBIT | BURNBIT);
    set(&mut init, 50, 50, TINYEXP | BULLBIT);
    set(&mut init, 60, 60, ROADS2 | BULLBIT | BURNBIT);

    let sim = sim_with_auto(true);
    let mut fx = Fx::new(init.clone());
    let mut hash = 0u64;

    // (x, y, cmd): cmd 0 FIX, 1 BULLDOZE, 2 ROAD, 3 RAILROAD, 4 WIRE
    let ops: [(i32, i32, i32); 42] = [
        (10, 10, 2),
        (11, 10, 2),
        (12, 10, 2),
        (12, 11, 2),
        (12, 12, 2),
        (12, 9, 2),
        (10, 11, 4),
        (11, 11, 4),
        (13, 10, 4),
        (10, 13, 3),
        (11, 13, 3),
        (12, 13, 3),
        (12, 10, 3),
        (11, 12, 1),
        (12, 11, 1),
        (10, 10, 0),
        (14, 14, 1),
        (9, 9, 2),
        (20, 30, 2),
        (21, 30, 2),
        (22, 30, 3),
        (23, 30, 4),
        (24, 30, 4),
        (25, 30, 2),
        (19, 31, 2),
        (19, 29, 3),
        (20, 29, 4),
        (5, 5, 2),
        (5, 4, 4),
        (5, 6, 3),
        (50, 50, 2),
        (50, 51, 1),
        (51, 50, 4),
        (60, 60, 3),
        (60, 61, 3),
        (61, 60, 4),
        (-1, 0, 2),
        (0, 100, 4),
        (120, 5, 0),
        (0, 0, 0),
        (119, 99, 2),
        (118, 99, 3),
    ];
    // Results and cost deltas, as printed by the C++ harness.
    let expected: [(i32, i32); 42] = [
        (1, 10),
        (1, 10),
        (1, 10),
        (1, 10),
        (1, 10),
        (1, 10),
        (1, 5),
        (1, 5),
        (1, 5),
        (1, 20),
        (1, 20),
        (1, 20),
        (0, 0),
        (0, 0),
        (1, 1),
        (1, 0),
        (0, 0),
        (1, 10),
        (1, 50),
        (1, 50),
        (0, 0),
        (0, 0),
        (0, 0),
        (1, 10),
        (1, 10),
        (1, 20),
        (1, 5),
        (1, 10),
        (1, 5),
        (1, 20),
        (1, 11),
        (0, 0),
        (1, 5),
        (1, 20),
        (1, 20),
        (1, 5),
        (0, 0),
        (0, 0),
        (0, 0),
        (1, 0),
        (1, 10),
        (1, 20),
    ];
    for (i, &(x, y, cmd)) in ops.iter().enumerate() {
        let (r, d) = apply(&sim, &mut fx, x, y, cmd, &mut hash);
        assert_eq!((r as i32, d), expected[i], "op {i} ({x},{y}) cmd {cmd}");
    }
    assert_eq!(fx.cost, 417, "total cost");
    assert_eq!(hash, 0x4003_1832_a487_95a5, "result hash");
    assert_eq!(fnv_map(&fx.map), 0x262e_434b_69c1_d5ed, "final map hash");

    // Every tile that differs from the initial map, as printed by the harness.
    let changed: [(i32, i32, Tile); 29] = [
        (5, 4, 28882),
        (5, 5, 28750),
        (5, 6, 12514),
        (9, 9, 12354),
        (10, 10, 12354),
        (10, 11, 28882),
        (10, 13, 12514),
        (11, 10, 12354),
        (11, 11, 28882),
        (11, 13, 12514),
        (12, 9, 12355),
        (12, 10, 12359),
        (12, 12, 12354),
        (12, 13, 12514),
        (13, 10, 28882),
        (19, 29, 12514),
        (19, 30, 12357),
        (19, 31, 12355),
        (20, 29, 28882),
        (20, 30, 4160),
        (21, 30, 4160),
        (25, 30, 12525),
        (50, 50, 12354),
        (51, 50, 28882),
        (60, 60, 12525),
        (60, 61, 12514),
        (61, 60, 28882),
        (118, 99, 12514),
        (119, 99, 12354),
    ];
    let mut actual = Vec::new();
    for x in 0..W {
        for y in 0..H {
            let now = fx.map[Fx::idx(x, y)];
            if now != init[Fx::idx(x, y)] {
                actual.push((x, y, now));
            }
        }
    }
    assert_eq!(actual, changed.to_vec());
}

#[test]
fn random_scenario_matches_cpp() {
    random_check(true, 0x79e0_90ef_d421_c45b, 0xa5e6_8679_1bf8_9221);
}

#[test]
fn random_scenario_without_auto_bulldoze_matches_cpp() {
    random_check(false, 0x80cd_3c57_707e_0e98, 0x7177_8532_db40_17b2);
}

/// Replays `reference/gold/connect_golden.cpp` `random` / `random_noauto`.
fn random_check(auto: bool, want_hash: u64, want_map: u64) {
    let mut lcg: u64 = 12345;
    let mut next = move || {
        lcg = lcg
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        lcg >> 33
    };

    // Initial map: dirt, with a random 40x40 corner (same draws as random_map in the harness).
    const BASE_TABLE: [Tile; 16] = [
        DIRT, DIRT, DIRT, RIVER, REDGE, CHANNEL, ROADS, ROADS2, LHRAIL, LVRAIL, LHPOWER, LVPOWER,
        HBRIDGE, VBRIDGE, TINYEXP, VPOWER,
    ];
    let mut map = vec![DIRT; (W * H) as usize];
    for x in 0..40 {
        for y in 0..40 {
            let base = BASE_TABLE[(next() % 16) as usize];
            let mut v = base;
            if base == LHPOWER || base == LVPOWER || base == VPOWER {
                v |= CONDBIT;
            }
            if next() % 2 == 1 {
                v |= BULLBIT | BURNBIT;
            }
            map[Fx::idx(x, y)] = v;
        }
    }

    let sim = sim_with_auto(auto);
    let mut fx = Fx::new(map);
    let mut hash = 0u64;
    for _ in 0..3000 {
        let x = (next() % 44) as i32 - 2;
        let y = (next() % 44) as i32 - 2;
        let cmd = (next() % 5) as i32;
        apply(&sim, &mut fx, x, y, cmd, &mut hash);
    }
    assert_eq!(hash, want_hash, "result hash");
    assert_eq!(fnv_map(&fx.map), want_map, "final map hash");
}
