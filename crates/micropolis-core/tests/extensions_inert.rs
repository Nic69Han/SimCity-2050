//! The extension hooks are inert (docs/game-design-v02.md, phase A): with every switch on but
//! the feature modules empty, a city plays out exactly like the same city with every switch off.
//! This is the Rust-side counterpart of the `compare-*.sh` scripts, which prove the switches off.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::simulation::Simulation;
use support::{run, starter, state};

fn city(seed: i32) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.new_random_city(seed);
    starter(&mut s);
    s
}

#[test]
fn all_switches_on_change_nothing_while_the_modules_are_empty() {
    for seed in [1, 2, 3] {
        let mut off = city(seed);
        let mut on = city(seed);
        let e = on.extensions_mut();
        e.ordinances = u32::MAX;
        e.water_rules = true;
        e.transit_rules = true;
        assert!(on.extensions_active() && !off.extensions_active());
        // 2000 ticks cross several tax collections, scans and census.
        run(&mut off, 2000);
        run(&mut on, 2000);
        assert_eq!(state(&off), state(&on), "seed {seed}");
        assert_eq!(off.rng.random16(), on.rng.random16(), "seed {seed}: rng");
        assert_eq!(off.save_cty(), on.save_cty(), "seed {seed}: payload");
        assert_eq!(off.crime_rate_map, on.crime_rate_map);
        assert_eq!(off.land_value_map, on.land_value_map);
        assert_eq!(off.pollution_density_map, on.pollution_density_map);
        assert_eq!(off.traffic_density_map, on.traffic_density_map);
    }
}
