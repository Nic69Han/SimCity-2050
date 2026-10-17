//! Ordinances (docs/game-design-v02.md): off, the engine is the one without extensions; on, the
//! averages move the documented way, the cost is paid at the tax collection, and the active set
//! survives a save and a load.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::ordinances::ORDINANCE_COUNT;
use micropolis_core::simulation::Simulation;
use support::{run, starter, state, HAIGHT};

fn haight() -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(HAIGHT, 1).expect("the sample city loads");
    s
}

fn generated(seed: i32) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.new_random_city(seed);
    starter(&mut s);
    s
}

fn maps(s: &Simulation) -> [&[u8]; 4] {
    [
        s.crime_rate_map.as_slice(),
        s.land_value_map.as_slice(),
        s.pollution_density_map.as_slice(),
        s.traffic_density_map.as_slice(),
    ]
}

#[test]
fn all_ordinances_off_play_out_like_before() {
    for seed in [1, 2] {
        let mut plain = generated(seed);
        let mut toggled = generated(seed);
        // Turned on and off again before the first tick: the extension block is the only trace.
        for i in 0..ORDINANCE_COUNT {
            assert!(toggled.set_ordinance(i, true));
        }
        for i in 0..ORDINANCE_COUNT {
            assert!(toggled.set_ordinance(i, false));
        }
        assert!(!toggled.extensions_active());
        run(&mut plain, 2000);
        run(&mut toggled, 2000);
        assert_eq!(state(&plain), state(&toggled), "seed {seed}");
        assert_eq!(
            plain.rng.random16(),
            toggled.rng.random16(),
            "seed {seed}: rng"
        );
        assert_eq!(plain.save_cty(), toggled.save_cty(), "seed {seed}: file");
        assert_eq!(maps(&plain), maps(&toggled), "seed {seed}: maps");
    }
}

#[test]
fn turning_them_on_is_deterministic() {
    let play = || {
        let mut s = generated(3);
        for i in 0..ORDINANCE_COUNT {
            s.set_ordinance(i, true);
        }
        run(&mut s, 1500);
        (state(&s), s.rng.random16(), s.crime_rate_map.clone())
    };
    assert_eq!(play(), play());
}

/// Averages of the same city after `ticks` ticks, with `mask` ordinances on.
fn averages(mask: u32, ticks: usize) -> (i16, i16, i16, i64) {
    let mut s = haight();
    s.extensions_mut().ordinances = mask;
    run(&mut s, ticks);
    (
        s.crime_average,
        s.pollution_average,
        s.land_value_average,
        s.total_funds,
    )
}

#[test]
fn crime_pollution_and_land_value_move_in_the_documented_direction() {
    let ticks = 1200;
    let (crime0, pollution0, land0, _) = averages(0, ticks);
    assert!(
        crime0 > 0 && pollution0 > 0 && land0 > 0,
        "a live sample city"
    );

    let (crime, ..) = averages(1 << 0, ticks); // Police de proximité: crime -15 %
    assert!(crime < crime0, "crime {crime} < {crime0}");

    let (_, pollution, ..) = averages((1 << 1) | (1 << 2), ticks); // -23 % pollution
    assert!(
        pollution < pollution0,
        "pollution {pollution} < {pollution0}"
    );

    let (_, _, land, _) = averages(1 << 5, ticks); // Embellissement: land value +10 %
    assert!(land > land0, "land value {land} > {land0}");
}

#[test]
fn the_cost_is_paid_at_the_tax_collection() {
    let mut off = haight();
    let mut on = haight();
    run(&mut off, 300);
    run(&mut on, 300);
    assert_eq!(state(&off), state(&on));
    assert!(on.set_ordinance(0, true) && on.set_ordinance(7, true));
    let cost = on.ordinances_monthly_cost();
    let population = on.get_population();
    let expected = (200 + 30 * (population / 1000)) + (200 + 30 * (population / 1000));
    assert_eq!(i64::from(cost), expected);
    assert!(cost > 0);
    let (before_off, before_on) = (off.total_funds, on.total_funds);
    off.tax_flag = false;
    on.tax_flag = false;
    off.collect_tax();
    on.collect_tax();
    assert_eq!(
        (before_on - on.total_funds) - (before_off - off.total_funds),
        i64::from(cost),
        "the ordinances cost exactly their documented total on top of the same collection"
    );
}

#[test]
fn the_active_set_survives_save_and_load() {
    let mut s = generated(4);
    for i in [0, 3, 6] {
        s.set_ordinance(i, true);
    }
    run(&mut s, 50);
    let file = s.save_city();
    let mut back = Simulation::with_default_size();
    back.load_city(&file, 1).expect("a file this crate wrote");
    assert_eq!(back.extensions().ordinances, 0b100_1001);
    for i in 0..ORDINANCE_COUNT {
        assert_eq!(
            back.ordinance_active(i),
            s.ordinance_active(i),
            "ordinance {i}"
        );
    }
    assert_eq!(back.ordinances_monthly_cost(), s.ordinances_monthly_cost());
    // A file saved with none is the file saved before the feature existed.
    let mut none = generated(4);
    run(&mut none, 50);
    assert_eq!(none.save_city(), none.save_cty(), "no extension block");
    assert_ne!(
        s.save_city(),
        s.save_cty(),
        "the active set needs the extension block"
    );
}
