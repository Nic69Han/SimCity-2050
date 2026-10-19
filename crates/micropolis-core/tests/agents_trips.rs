//! Round trips and congestion of the simulated cars (docs/game-design-v03b.md), on synthetic
//! cities whose tiles are built by hand and driven with `ext_agents_tick` alone.

use micropolis_core::agents::{Counters, MAX_VEHICLES, WORK_TICKS};
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::{COMBASE, FREEZ, ROADBASE, RZB, ZONEBIT};

const ROAD_Y: i32 = 12;

/// A road along `ROAD_Y` from `x = 2` to `x = 2 + len`; `homes` residential zones of density
/// `den` (0..=3) from `x = 4` on, in pairs north and south of the road; `jobs` pairs of
/// commercial zones at the east end.
fn corridor(len: i32, homes: i32, den: i32, jobs: i32) -> Simulation {
    let mut s = Simulation::new(len + 8, 24);
    for x in 2..=2 + len {
        s.set_tile(x, ROAD_Y, ROADBASE);
    }
    for i in 0..homes {
        let (x, y) = (
            4 + 3 * (i / 2),
            if i % 2 == 0 { ROAD_Y - 2 } else { ROAD_Y + 2 },
        );
        s.set_tile(x, y, (RZB + 9 * den as u16) | ZONEBIT);
    }
    for i in 0..jobs {
        let (x, y) = (
            len - 3 * (i / 2),
            if i % 2 == 0 { ROAD_Y - 2 } else { ROAD_Y + 2 },
        );
        s.set_tile(x, y, COMBASE | ZONEBIT);
    }
    s.set_agent_rules(true);
    s
}

fn ticks(s: &mut Simulation, n: usize) {
    for _ in 0..n {
        s.ext_agents_tick();
    }
}

/// `spawned = driving + parked + round_trips + abandoned` and, leg by leg,
/// `finished = 2 * round_trips + parked + returning`.
fn assert_conserved(s: &Simulation) {
    let (c, driving) = (s.agent_counters(), s.agent_stats()[0] as u64);
    let (parked, returning) = (c.parked as u64, c.returning as u64);
    assert_eq!(c.spawned, driving + parked + c.round_trips + c.abandoned);
    assert!(c.finished + c.abandoned >= 2 * c.round_trips + parked + returning);
    assert!(driving + parked <= MAX_VEHICLES as u64);
    assert!(returning <= driving);
}

fn ids(s: &Simulation) -> Vec<i32> {
    s.agent_vehicles(MAX_VEHICLES)
        .iter()
        .map(|v| v[0])
        .collect()
}

#[test]
fn a_car_goes_to_work_parks_then_comes_home() {
    let mut s = corridor(30, 1, 0, 1);
    s.set_tile(4, ROAD_Y - 2, FREEZ | ZONEBIT); // an empty low-density zone: room for one car
    ticks(&mut s, 1);
    assert_eq!(ids(&s), vec![1]);
    let out_dir = s.agent_vehicles(1)[0][4];
    // drive until it parks: it vanishes from the road and the load, and the leg is counted
    let mut t = 1;
    while s.agent_counters().parked == 0 {
        ticks(&mut s, 1);
        t += 1;
        assert!(t < 400, "the car never reached its job");
    }
    let c = s.agent_counters();
    assert_eq!((c.finished, c.round_trips), (1, 0));
    assert!(!ids(&s).contains(&1), "a parked car is not a vehicle");
    // park time: WORK_TICKS ticks exactly, then it drives home the other way
    let parked_at = t;
    while s.agent_counters().returning == 0 {
        ticks(&mut s, 1);
        t += 1;
        assert!(t < parked_at + WORK_TICKS as usize + 5);
    }
    assert_eq!(t - parked_at, WORK_TICKS as usize);
    let back = s.agent_vehicles(MAX_VEHICLES);
    let car = back.iter().find(|v| v[0] == 1).expect("driving home");
    assert_eq!(car[4], (out_dir + 2) % 4, "it goes back the way it came");
    // home: the car is gone and the round trip is counted once
    while s.agent_counters().round_trips == 0 {
        ticks(&mut s, 1);
        t += 1;
        assert!(t < 1000, "the car never came home");
    }
    assert!(!ids(&s).contains(&1));
    let c = s.agent_counters();
    assert!(c.finished >= 2 && c.round_trips == 1);
    assert_conserved(&s);
}

#[test]
fn parked_cars_add_no_load() {
    let mut s = corridor(30, 1, 0, 1);
    let mut max_parked_seen = 0;
    for _ in 0..300 {
        ticks(&mut s, 1);
        let c = s.agent_counters();
        max_parked_seen = max_parked_seen.max(c.parked);
        if c.parked > 0 && s.agent_stats()[0] == 0 {
            // only parked cars: the road empties out
            let load: u32 = s.agent_traffic_load().iter().map(|&l| u32::from(l)).sum();
            if load == 0 {
                return;
            }
        }
    }
    panic!("never saw an empty road with parked cars (parked max {max_parked_seen})");
}

#[test]
fn conservation_holds_every_tick_and_legs_add_up() {
    let mut s = corridor(40, 6, 3, 4);
    for _ in 0..600 {
        ticks(&mut s, 1);
        assert_conserved(&s);
    }
    let c = s.agent_counters();
    assert!(c.round_trips > 0 && c.parked > 0, "{c:?}");
    assert_eq!(s.agent_stats()[1] as u64, c.finished);
}

#[test]
fn a_cut_road_abandons_the_parked_cars_that_cannot_go_home() {
    let mut s = corridor(40, 2, 0, 1);
    ticks(&mut s, 100);
    assert!(s.agent_counters().parked > 0);
    s.set_tile(20, ROAD_Y, 0); // between the homes and the job
    ticks(&mut s, WORK_TICKS as usize * 3);
    let c = s.agent_counters();
    assert!(c.abandoned > 0, "{c:?}");
    assert_conserved(&s);
}

#[test]
fn the_fingerprint_covers_parked_cars() {
    let run = |n| {
        let mut s = corridor(40, 6, 2, 3);
        ticks(&mut s, n);
        s
    };
    let (a, b) = (run(300), run(300));
    assert!(a.agent_counters().parked > 0);
    assert_eq!(a.agent_fingerprint(), b.agent_fingerprint());
    // one more tick of parked time changes it even if no car moves on the road
    assert_ne!(run(301).agent_fingerprint(), a.agent_fingerprint());
}

const HOMES: i32 = 16;

fn measure(den: i32) -> (Counters, [i32; 5], i32) {
    let mut s = corridor(60, HOMES, den, 8);
    let mut peak_saturated = 0;
    for _ in 0..700 {
        ticks(&mut s, 1);
        peak_saturated = peak_saturated.max(s.agent_stats()[3]);
    }
    assert_conserved(&s);
    (s.agent_counters(), s.agent_stats(), peak_saturated)
}

#[test]
fn a_crowded_corridor_saturates_and_trips_take_longer_than_when_free() {
    let (_, free, free_peak) = measure(0);
    let (c, jam, jam_peak) = measure(3);
    eprintln!("free {free:?} peak {free_peak}; jam {jam:?} peak {jam_peak}; {c:?}");
    assert!(jam_peak >= 8, "tiles really saturate: peak {jam_peak}");
    assert!(
        free_peak <= 2,
        "the free version hardly saturates: peak {free_peak}"
    );
    assert!(free[2] > 0 && jam[1] > 0);
    // measurably longer: at least a quarter more than the free-flowing mean
    assert!(
        jam[2] * 4 >= free[2] * 5,
        "jam {} vs free {}",
        jam[2],
        free[2]
    );
}
