//! The SimCity 3000 disasters (docs/game-design-v13.md): rule off = the original engine (and its
//! generator's sequence); on demand and at random each disaster does what the contract says,
//! deterministic with the same seed, every cap and refusal.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::disasters2::*;
use micropolis_core::events::Event;
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::{
    ANIMBIT, BURNBIT, FIRE, HOUSE, LASTFIRE, LOMASK, RESBASE, RIVER, RUBBLE, ZONEBIT,
};
use support::{file_of, run, state, HAIGHT};

fn haight() -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(HAIGHT, 1).expect("the sample city");
    s.total_funds = 1_000_000;
    s
}

/// A plain 60 x 50 field with three rows of residential zone centres.
fn field() -> Simulation {
    let mut s = Simulation::new(60, 50);
    for x in (8..50).step_by(6) {
        for y in (10..40).step_by(6) {
            s.set_tile(x, y, (RESBASE + 4) | ZONEBIT | BURNBIT);
            for (dx, dy) in [
                (-1, -1),
                (0, -1),
                (1, -1),
                (-1, 0),
                (1, 0),
                (-1, 1),
                (0, 1),
                (1, 1),
            ] {
                s.set_tile(x + dx, y + dy, HOUSE | BURNBIT);
            }
        }
    }
    s.total_funds = 1_000_000;
    s
}

fn messages(s: &mut Simulation) -> Vec<(i16, i16, i16)> {
    s.drain_events()
        .into_iter()
        .filter_map(|e| match e {
            Event::Message { number, x, y, .. } => Some((number, x, y)),
            _ => None,
        })
        .collect()
}

fn is_fire(t: u16) -> bool {
    (FIRE..=LASTFIRE).contains(&(t & LOMASK))
}

fn on(mut s: Simulation) -> Simulation {
    s.set_disaster2_rules(true);
    s
}

// ---- rule off ------------------------------------------------------------------------------

#[test]
fn rule_off_is_the_original_engine_for_600_steps() {
    let mut a = haight();
    let mut b = haight();
    b.set_disaster2_rules(true);
    b.set_disaster2_rules(false); // touched, then off: still the original
    assert!(!b.extensions_active());
    run(&mut a, 600);
    run(&mut b, 600);
    assert_eq!(state(&a), state(&b));
    assert_eq!(a.rng.clone().random16(), b.rng.clone().random16());
    assert_eq!(file_of(&a), file_of(&b));
}

#[test]
fn the_rule_on_but_disasters_disabled_draws_nothing() {
    let mut a = haight();
    let mut b = on(haight());
    a.enable_disasters = false;
    b.enable_disasters = false;
    run(&mut a, 600);
    run(&mut b, 600);
    assert_eq!(state(&a), state(&b));
    assert_eq!(a.rng.clone().random16(), b.rng.clone().random16());
    assert_eq!(b.disaster2_stats(), [0, 0, -1, -1]);
}

#[test]
fn every_call_is_refused_while_the_rule_is_off() {
    let mut s = haight();
    for kind in -1..=6 {
        assert_eq!(s.trigger_disaster(kind), DisasterResult::RulesOff, "{kind}");
    }
    assert_eq!(s.disaster2_stats(), [0, 0, -1, -1]);
    let before = s.rng.clone().random16();
    for _ in 0..200 {
        s.ext_monthly_balance();
        s.ext_valves();
    }
    assert_eq!(s.rng.clone().random16(), before, "no draw while off");
    assert!(messages(&mut s).is_empty());
}

#[test]
fn an_unknown_kind_is_impossible() {
    let mut s = on(haight());
    for kind in [-1, 0, 5, 99, i32::MIN, i32::MAX] {
        assert_eq!(
            s.trigger_disaster(kind),
            DisasterResult::Impossible,
            "{kind}"
        );
    }
    assert_eq!(s.disaster2_stats(), [0, 0, -1, -1]);
}

// ---- riot ------------------------------------------------------------------------------------

#[test]
fn a_riot_without_residential_zone_is_impossible() {
    let mut s = on(Simulation::new(40, 30));
    assert_eq!(s.trigger_disaster(KIND_RIOT), DisasterResult::Impossible);
    assert!(messages(&mut s).is_empty());
}

#[test]
fn the_riot_starts_in_the_residential_zone_with_the_most_crime() {
    let mut s = on(field());
    // (8,10) has the most crime; (14,10) and (8,16) tie below it
    for (x, y, c) in [(8, 10, 10u8), (14, 10, 10), (8, 16, 10), (20, 22, 200)] {
        s.crime_rate_map.world_set(x, y, c);
    }
    assert_eq!(s.trigger_disaster(KIND_RIOT), DisasterResult::Done);
    assert_eq!(&s.disaster2_stats()[1..], &[1, 20, 22]);
    // the highest crime is shared by two zones: the smaller x, then the smaller y wins
    let mut t = on(field());
    for (x, y) in [(26, 22), (26, 16), (32, 10)] {
        t.crime_rate_map.world_set(x, y, 90);
    }
    t.trigger_disaster(KIND_RIOT);
    assert_eq!(&t.disaster2_stats()[2..], &[26, 16]);
}

#[test]
fn a_riot_lights_classic_fires_near_its_centre_and_says_so() {
    let mut s = on(field());
    s.crime_rate_map.world_set(26, 22, 250);
    assert_eq!(s.trigger_disaster(KIND_RIOT), DisasterResult::Done);
    let fires: Vec<(i32, i32)> = (0..60)
        .flat_map(|x| (0..50).map(move |y| (x, y)))
        .filter(|&(x, y)| is_fire(s.tile(x, y).unwrap()))
        .collect();
    assert!(!fires.is_empty() && fires.len() <= RIOT_FIRES, "{fires:?}");
    for &(x, y) in &fires {
        assert!((x - 26).abs() <= RIOT_RADIUS && (y - 22).abs() <= RIOT_RADIUS);
        assert!(s.tile(x, y).unwrap() & ANIMBIT != 0, "a classic fire tile");
    }
    assert_eq!(messages(&mut s), [(MESSAGE_RIOTS_REPORTED, 26, 22)]);
    assert_eq!(MESSAGE_RIOTS_REPORTED, 44);
}

#[test]
fn the_riot_condition_needs_crime_and_unhappiness() {
    let mut s = on(field());
    for (crime, yes, expected) in [
        (119, 10, false),
        (120, 39, true),
        (120, 40, false),
        (250, 0, true),
    ] {
        s.crime_average = crime;
        s.city_yes = yes;
        assert_eq!(riot::condition(&s), expected, "{crime} {yes}");
    }
}

// ---- UFO and meteor --------------------------------------------------------------------------

#[test]
fn a_ufo_destroys_a_strip_and_says_so() {
    let mut s = on(field());
    let before: Vec<u16> = s.tiles.clone();
    assert_eq!(s.trigger_disaster(KIND_UFO), DisasterResult::Done);
    let stats = s.disaster2_stats();
    assert_eq!(stats[1], 2);
    let changed: Vec<usize> = (0..before.len())
        .filter(|&i| before[i] != s.tiles[i])
        .collect();
    assert!(changed.len() <= UFO_LENGTH as usize, "{}", changed.len());
    let h = 50usize;
    let (sx, sy) = (stats[2], stats[3]);
    assert!((0..60).contains(&sx) && (0..50).contains(&sy));
    // every changed tile lies on a straight line from the start (same row or same column)
    for &i in &changed {
        let (x, y) = ((i / h) as i32, (i % h) as i32);
        assert!(x == sx || y == sy, "{x},{y} vs {sx},{sy}");
        assert!((x - sx).abs() + (y - sy).abs() < UFO_LENGTH);
    }
    assert_eq!(messages(&mut s), [(MESSAGE_UFO, sx as i16, sy as i16)]);
}

#[test]
fn a_ufo_spares_the_water_and_stops_at_the_edge() {
    for seed in 1..=12 {
        let mut s = Simulation::new(30, 30);
        for x in 0..30 {
            for y in 0..30 {
                s.set_tile(x, y, RIVER);
            }
        }
        s.set_disaster2_rules(true);
        s.rng = micropolis_core::rng::Rng::new(seed);
        assert_eq!(s.trigger_disaster(KIND_UFO), DisasterResult::Done);
        assert!(
            s.tiles.iter().all(|&t| t == RIVER),
            "water spared (seed {seed})"
        );
    }
}

#[test]
fn a_meteor_digs_a_crater_with_a_fire_in_the_middle() {
    let mut s = on(field());
    assert_eq!(s.trigger_disaster(KIND_METEOR), DisasterResult::Done);
    let [_, kind, cx, cy] = s.disaster2_stats();
    assert_eq!(kind, 3);
    assert!(
        (1..59).contains(&cx) && (1..49).contains(&cy),
        "crater fits the map"
    );
    for dx in -1..=1 {
        for dy in -1..=1 {
            let t = s.tile(cx + dx, cy + dy).unwrap();
            if (dx, dy) == (0, 0) {
                assert!(is_fire(t), "fire in the middle: {t}");
            } else {
                assert!(
                    (RUBBLE..RUBBLE + 4).contains(&(t & LOMASK)),
                    "rubble at {dx},{dy}: {t}"
                );
            }
        }
    }
    assert_eq!(messages(&mut s), [(MESSAGE_METEOR, cx as i16, cy as i16)]);
}

#[test]
fn a_meteor_spares_the_water_of_its_crater() {
    let mut s = Simulation::new(20, 20);
    for x in 0..20 {
        for y in 0..20 {
            s.set_tile(x, y, RIVER);
        }
    }
    s.set_disaster2_rules(true);
    assert_eq!(s.trigger_disaster(KIND_METEOR), DisasterResult::Done);
    assert!(s.tiles.iter().all(|&t| t == RIVER));
}

// ---- drought ---------------------------------------------------------------------------------

#[test]
fn a_drought_lasts_its_months_and_does_not_add_up() {
    let mut s = on(field());
    assert_eq!(s.trigger_disaster(KIND_DROUGHT), DisasterResult::Done);
    assert_eq!(s.disaster2_stats(), [i32::from(DROUGHT_MONTHS), 4, -1, -1]);
    assert_eq!(s.trigger_disaster(KIND_DROUGHT), DisasterResult::Done);
    assert_eq!(
        s.disaster2_stats()[0],
        i32::from(DROUGHT_MONTHS),
        "starts over"
    );
    assert_eq!(
        messages(&mut s)
            .iter()
            .filter(|m| m.0 == MESSAGE_DROUGHT)
            .count(),
        2
    );
    s.enable_disasters = false; // nothing new at the pass
    s.ext_monthly_balance();
    assert_eq!(s.disaster2_stats()[0], 0, "over after one pass");
    s.ext_monthly_balance();
    assert_eq!(s.disaster2_stats()[0], 0);
}

#[test]
fn a_drought_pulls_the_residential_valve_down_inside_its_range() {
    let mut dry = on(haight());
    let mut wet = on(haight());
    dry.trigger_disaster(KIND_DROUGHT);
    for v in [0i16, 100, -1000, 1990] {
        dry.res_valve = v;
        wet.res_valve = v;
        dry.ext_valves();
        wet.ext_valves();
        assert_eq!(wet.res_valve, v);
        assert_eq!(dry.res_valve, v - DROUGHT_VALVE);
    }
    dry.res_valve = -1990;
    dry.ext_valves();
    assert_eq!(dry.res_valve, -2000, "the floor of the valve");
    assert_eq!(
        (dry.com_valve, dry.ind_valve),
        (wet.com_valve, wet.ind_valve)
    );
}

#[test]
fn a_drought_halves_the_reach_of_the_pumps_then_restores_it() {
    let mut s = Simulation::new(120, 20);
    s.set_tile(0, 10, RIVER);
    s.set_water_rules(true);
    s.total_funds = 1_000_000;
    s.set_disaster2_rules(true);
    assert_eq!(s.place_pump(1, 10) as i32, 1);
    for x in 2..70 {
        s.place_pipe(x, 10);
    }
    let reach = |s: &Simulation| s.water().pump_range() as i32;
    assert_eq!(reach(&s), 64);
    assert!(s.water().is_fed(60, 10));
    s.trigger_disaster(KIND_DROUGHT);
    assert_eq!(reach(&s), 32);
    assert!(
        s.water().is_fed(30, 10) && !s.water().is_fed(60, 10),
        "weaker pumps"
    );
    s.enable_disasters = false;
    s.ext_monthly_balance(); // the drought ends
    assert_eq!(reach(&s), 64);
    assert!(s.water().is_fed(60, 10), "restored");
    // without the water rule the pumps are not touched
    let mut t = on(field());
    t.trigger_disaster(KIND_DROUGHT);
    assert!(!t.water().is_weak());
}

#[test]
fn turning_the_rule_off_ends_the_drought_at_once() {
    let mut s = Simulation::new(120, 20);
    s.set_water_rules(true);
    s.set_disaster2_rules(true);
    s.trigger_disaster(KIND_DROUGHT);
    assert!(s.water().is_weak());
    s.set_disaster2_rules(false);
    assert!(!s.water().is_weak());
    assert_eq!(s.disaster2_stats(), [0, 0, -1, -1]);
    assert!(s.extensions().disaster_state.is_empty());
}

// ---- at random -------------------------------------------------------------------------------

/// Runs yearly passes on a copy of the field until `limit`, collecting the kinds seen.
fn kinds_seen(seed: i32, passes: usize, angry: bool) -> (Vec<u8>, Simulation) {
    let mut s = on(field());
    s.rng = micropolis_core::rng::Rng::new(seed);
    if angry {
        s.crime_average = 200;
        s.city_yes = 10;
    }
    let mut seen = Vec::new();
    for _ in 0..passes {
        s.ext_monthly_balance();
        s.total_funds = 1_000_000;
        let kind = s.disaster2_stats()[1] as u8;
        if kind != 0 && !seen.contains(&kind) {
            seen.push(kind);
        }
        s.extensions_mut().disaster_report = Default::default();
        // the field must stay inhabited for the riot
        if s.tile(8, 10).map(|t| t & ZONEBIT) != Some(ZONEBIT) {
            s = on(field());
            if angry {
                s.crime_average = 200;
                s.city_yes = 10;
            }
        }
    }
    (seen, s)
}

#[test]
fn the_four_disasters_come_at_random_when_the_rule_and_the_permission_allow() {
    let (mut seen, _) = kinds_seen(7, 3000, true);
    seen.sort_unstable();
    assert_eq!(seen, [1, 2, 3, 4]);
}

#[test]
fn a_calm_city_has_no_riot() {
    let (seen, _) = kinds_seen(7, 3000, false);
    assert!(!seen.contains(&1), "{seen:?}");
    assert!(seen.contains(&2) && seen.contains(&3) && seen.contains(&4));
}

#[test]
fn nothing_happens_at_random_when_disasters_are_not_allowed() {
    let mut s = on(field());
    s.enable_disasters = false;
    s.crime_average = 200;
    s.city_yes = 10;
    let before = s.rng.clone().random16();
    let tiles = s.tiles.clone();
    for _ in 0..500 {
        s.ext_monthly_balance();
    }
    assert_eq!(s.rng.clone().random16(), before);
    assert_eq!(s.tiles, tiles);
    assert_eq!(s.disaster2_stats(), [0, 0, -1, -1]);
}

#[test]
fn random_disasters_are_deterministic_with_the_same_seed() {
    let (_, a) = kinds_seen(11, 600, true);
    let (_, b) = kinds_seen(11, 600, true);
    assert_eq!(a.tiles, b.tiles);
    assert_eq!(a.rng.clone().random16(), b.rng.clone().random16());
    assert_eq!(a.extensions().disaster_state, b.extensions().disaster_state);
    let (_, c) = kinds_seen(12, 600, true);
    assert_ne!(a.tiles, c.tiles, "another seed, another history");
}

#[test]
fn the_strip_and_the_fires_are_bounded() {
    assert_eq!(UFO_LENGTH, 20);
    assert_eq!(RIOT_FIRES * RIOT_TRIES_PER_FIRE, 48);
    let mut s = on(field());
    for kind in 1..=KIND_LAST {
        for _ in 0..50 {
            s.trigger_disaster(kind);
        }
    }
    assert!(messages(&mut s).len() >= 100);
}

#[test]
fn a_disaster_on_a_tiny_map_never_goes_off_it() {
    for (w, h) in [(5, 5), (3, 3), (4, 9)] {
        let mut s = Simulation::new(w, h);
        s.set_disaster2_rules(true);
        for kind in [KIND_UFO, KIND_METEOR, KIND_DROUGHT] {
            assert_eq!(
                s.trigger_disaster(kind),
                DisasterResult::Done,
                "{w}x{h} {kind}"
            );
        }
    }
}
