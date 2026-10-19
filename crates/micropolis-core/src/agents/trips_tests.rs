//! Caps and priorities of the trip planner on a tiny city: one home, one job, one road.

use super::run::Run;
use super::vehicles::{Car, Leg, Parked};
use super::*;
use crate::tile::{COMBASE, ROADBASE, RZB, ZONEBIT};

const ROAD_Y: i32 = 5;

/// A 30x10 map: a road along `ROAD_Y`, a home (16 residents, so 2 cars) on the left, a job
/// zone on the right.
fn small() -> Simulation {
    let mut s = Simulation::new(30, 10);
    for x in 2..=26 {
        s.set_tile(x, ROAD_Y, ROADBASE);
    }
    s.set_tile(4, 3, RZB | ZONEBIT);
    s.set_tile(24, 3, COMBASE | ZONEBIT);
    s
}

fn tiles(r: &Run) -> (u32, u32) {
    (r.graph.zones[0].tile, r.graph.zones[1].tile)
}

fn parked(r: &Run, id: u32, ready_at: u64) -> Parked {
    let (home, job) = tiles(r);
    Parked {
        id,
        home,
        job,
        ready_at,
        failed: 0,
    }
}

#[test]
fn the_tiny_city_has_a_home_and_a_job() {
    let r = Run::new(&small());
    assert_eq!((r.graph.residential.len(), r.graph.jobs.len()), (1, 1));
    assert_eq!(zone_car_cap(r.graph.zones[0].pop), 2);
}

#[test]
fn returns_come_before_departures() {
    let mut r = Run::new(&small());
    for id in 1..=5 {
        let p = parked(&r, id, 0);
        r.parked.push(p);
    }
    r.next_id = 6;
    r.plan();
    assert_eq!(r.counters.searches_in_last_tick, MAX_PATH_SEARCHES_PER_TICK);
    assert_eq!(r.counters.spawned, 0, "the whole budget went to returns");
    assert_eq!((r.cars.len(), r.parked.len()), (2, 3));
    assert!(r.cars.iter().all(|c| c.leg == Leg::Back));
    assert_eq!(r.cars[0].id, 1, "the one who waited longest leaves first");
}

#[test]
fn a_return_and_a_departure_share_the_budget() {
    let mut r = Run::new(&small());
    let p = parked(&r, 1, 0);
    r.parked.push(p);
    r.plan();
    assert_eq!(r.counters.searches_in_last_tick, MAX_PATH_SEARCHES_PER_TICK);
    assert_eq!(r.counters.spawned, 1);
    assert_eq!(r.cars.iter().filter(|c| c.leg == Leg::Back).count(), 1);
}

#[test]
fn a_car_not_yet_ready_stays_parked() {
    let mut r = Run::new(&small());
    let p = parked(&r, 1, 10);
    r.parked.push(p);
    r.ticks = 9;
    r.plan();
    assert!(r.cars.iter().all(|c| c.leg == Leg::Out));
    assert_eq!(r.parked.len(), 1);
}

#[test]
fn parked_cars_count_towards_the_home_cap() {
    let mut r = Run::new(&small());
    for id in 1..=2 {
        let p = parked(&r, id, u64::MAX);
        r.parked.push(p);
    }
    r.plan();
    assert_eq!((r.counters.spawned, r.cars.len()), (0, 0));
    assert_eq!(r.counters.searches_in_last_tick, 0);
}

#[test]
fn driving_and_parked_cars_never_pass_the_vehicle_cap() {
    let mut r = Run::new(&small());
    for id in 1..MAX_VEHICLES as u32 {
        let p = Parked {
            home: u32::MAX, // not a zone of this city: it takes no part in the home cap
            ..parked(&r, id, u64::MAX)
        };
        r.parked.push(p);
    }
    for _ in 0..10 {
        r.plan();
        assert!(r.present() <= MAX_VEHICLES);
    }
    assert_eq!(r.present(), MAX_VEHICLES, "one free place, then full");
    r.plan();
    assert_eq!(r.counters.spawned, 1);
}

#[test]
fn a_failing_return_search_retries_then_abandons() {
    let mut sim = small();
    let mut r = Run::new(&sim);
    sim.set_tile(14, ROAD_Y, 0); // the way home is cut
    r.graph = graph::RoadGraph::scan(&sim);
    let p = parked(&r, 1, 0);
    r.parked.push(p);
    for attempt in 1..MAX_RETURN_FAILURES {
        r.plan();
        assert_eq!(r.parked.len(), 1, "attempt {attempt}: still parked");
        assert_eq!(r.parked[0].failed, attempt);
        assert_eq!(r.counters.abandoned, 0);
    }
    r.plan();
    assert!(r.parked.is_empty());
    assert_eq!(r.counters.abandoned, 1);
    assert!(r.counters.failed_searches >= u64::from(MAX_RETURN_FAILURES));
}

#[test]
fn a_refresh_that_drops_a_zone_abandons_cars_driving_or_parked() {
    let mut sim = small();
    let mut r = Run::new(&sim);
    let (home, job) = tiles(&r);
    let path = vec![
        r.graph.zones[0].access.unwrap(),
        r.graph.zones[1].access.unwrap(),
    ];
    let car = |id, leg| Car {
        id,
        home,
        job,
        leg,
        path: path.clone(),
        at: 0,
        progress: 0,
        born: 0,
    };
    r.cars = vec![car(1, Leg::Out), car(2, Leg::Back)];
    let p = parked(&r, 3, 99);
    r.parked.push(p);
    sim.set_tile(24, 3, 0); // the job zone is gone
    r.ticks = REFRESH_INTERVAL - 1;
    r.step(&sim);
    assert_eq!((r.cars.len(), r.parked.len()), (0, 0));
    assert_eq!(r.counters.abandoned, 3);
}
