//! Reading the terrain relief must not change the simulation: two cities from the same seed,
//! one of which reads `relief()` before and during the run, stay identical tick by tick.

use micropolis_core::relief::{Relief, SEA_LEVEL};
use micropolis_core::simulation::Simulation;

/// The state the per-tick fingerprint of the oracle comparison is built from, plus the
/// next random number (so a changed random stream shows up too).
#[derive(Debug, PartialEq)]
struct Snapshot {
    time: i64,
    funds: i64,
    pop: i16,
    res_valve: i16,
    com_valve: i16,
    ind_valve: i16,
    map_hash: u64,
    next_random: i32,
}

fn snapshot(s: &Simulation) -> Snapshot {
    let mut h: u64 = 1_469_598_103_934_665_603;
    for &w in &s.tiles {
        h ^= u64::from(w);
        h = h.wrapping_mul(1_099_511_628_211);
    }
    let mut rng = s.rng.clone();
    Snapshot {
        time: s.city_time,
        funds: s.total_funds,
        pop: s.total_pop,
        res_valve: s.res_valve,
        com_valve: s.com_valve,
        ind_valve: s.ind_valve,
        map_hash: h,
        next_random: rng.random16(),
    }
}

#[test]
fn reading_relief_does_not_change_the_simulation() {
    for seed in [1, 42] {
        let mut plain = Simulation::with_default_size();
        let mut viewed = Simulation::with_default_size();
        plain.new_random_city(seed);
        viewed.new_random_city(seed);
        assert_eq!(snapshot(&plain), snapshot(&viewed));

        // The viewer reads the relief before the run, then every few ticks, as a 3D view would.
        let before = viewed.relief().clone();
        assert_eq!(before.as_slice().len(), viewed.tiles.len());
        assert_eq!(
            snapshot(&plain),
            snapshot(&viewed),
            "seed {seed}: relief() changed state"
        );

        for tick in 0..200 {
            plain.sim_tick();
            viewed.sim_tick();
            if tick % 7 == 0 {
                let _ = viewed.relief().height_at(10, 10);
            }
            assert_eq!(
                snapshot(&plain),
                snapshot(&viewed),
                "seed {seed}, tick {tick}"
            );
        }
    }
}

#[test]
fn relief_is_a_pure_view_of_the_map_and_the_seed() {
    let mut a = Simulation::with_default_size();
    a.new_random_city(9);
    let first = a.relief().clone();
    // The cached value is the one a fresh generation from the same map gives.
    let fresh = Relief::generate(&a.tiles, 120, 100, 9);
    assert_eq!(first, fresh);
    // Water, wherever the generated map has it, is at sea level.
    for (i, &t) in a.tiles.iter().enumerate() {
        let c = t & 0x03ff;
        if (2..=20).contains(&c) {
            assert_eq!(first.as_slice()[i], SEA_LEVEL);
        }
    }
}

#[test]
fn a_new_city_uses_its_own_seed_for_the_relief() {
    let mut a = Simulation::with_default_size();
    let mut b = Simulation::with_default_size();
    a.new_random_city(3);
    b.new_random_city(4);
    assert_ne!(a.relief().as_slice(), b.relief().as_slice());
}
