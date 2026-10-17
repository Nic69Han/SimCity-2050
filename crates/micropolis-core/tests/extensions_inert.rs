//! The extension hooks themselves are inert (docs/game-design-v02.md, phase A): with the
//! extensions active but no rule that acts (only an ordinance bit beyond the table, which the
//! engine ignores), a city plays out exactly like the same city with every switch off. Each rule
//! proves its own effect in its own tests; the `compare-*.sh` scripts prove the switches off.

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
fn active_extensions_without_an_acting_rule_change_nothing() {
    for seed in [1, 2, 3] {
        let mut off = city(seed);
        let mut on = city(seed);
        let e = on.extensions_mut();
        e.ordinances = 1 << 31; // beyond the ordinance table: active, but no rule acts
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
