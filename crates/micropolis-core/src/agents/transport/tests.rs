//! Caps and the inside of the transport on small hand-built towns, driven without the fleet.

use super::*;
use crate::agents::graph::RoadGraph;
use crate::agents::path::PathFinder;
use crate::tile::{COMBASE, ROADBASE, RZB, ZONEBIT};
use crate::tool::ToolResult;

const ROAD_Y: i32 = 12;

/// A 70 x 24 map with a road along `ROAD_Y` for `x` in `road`, `homes` residential zones north
/// of it (every 4 tiles from x = 5) and a job zone at x = 60; both rules on.
fn town(road: std::ops::Range<i32>, homes: i32) -> Simulation {
    let mut s = Simulation::new(70, 24);
    for x in road {
        s.set_tile(x, ROAD_Y, ROADBASE);
    }
    for i in 0..homes {
        s.set_tile(5 + 4 * i, ROAD_Y - 2, (RZB + 27) | ZONEBIT);
    }
    s.set_tile(60, ROAD_Y - 2, COMBASE | ZONEBIT);
    s.total_funds = 5_000_000;
    s.set_structure_rules(true);
    s.set_agent_rules(true);
    s
}

fn put(s: &mut Simulation, genre: u8, x: i32, y: i32) {
    assert_eq!(
        s.place_structure(genre, x, y),
        ToolResult::Ok,
        "{genre} {x},{y}"
    );
}

/// The transport of a map with the loads at zero, stepped by hand.
struct Rig {
    g: RoadGraph,
    finder: PathFinder,
    load: Vec<u8>,
    t: Transport,
    now: u64,
}

impl Rig {
    fn new(sim: &Simulation) -> Rig {
        let g = RoadGraph::scan(sim);
        let mut rig = Rig {
            load: vec![0; g.class_len()],
            g,
            finder: PathFinder::default(),
            t: Transport::new(1, 0),
            now: 0,
        };
        rig.t.refresh(sim, &rig.g, &mut rig.finder, &rig.load, 0);
        rig
    }

    fn step(&mut self, n: usize) {
        for _ in 0..n {
            self.now += 1;
            self.t.step(&self.g, &mut self.finder, &self.load, self.now);
            assert!(self.t.audit().balanced(), "tick {}", self.now);
        }
    }

    fn rider(&mut self, home_zone: usize, stop: u32) -> Rider {
        self.t.counters.created += 1;
        let z = &self.g.zones;
        Rider {
            id: self.t.counters.created as u32,
            home: z[home_zone].tile,
            job: z[z.len() - 1].tile,
            stop,
            born: self.now,
            failed: 0,
        }
    }
}

fn stop_ids(rig: &Rig) -> Vec<u32> {
    rig.t.net.stops.iter().map(|s| s.id).collect()
}

#[test]
fn the_tour_visits_the_nearest_stop_first_and_closes_the_loop() {
    let mut s = town(2..68, 1);
    put(&mut s, GENRE_BUS_DEPOT, 20, ROAD_Y + 1);
    for x in [10, 30, 24] {
        put(&mut s, GENRE_BUS_STOP, x, ROAD_Y + 1);
    }
    let rig = Rig::new(&s);
    let route = rig.t.routes[0].as_ref().unwrap();
    let xs: Vec<i32> = route
        .stops
        .iter()
        .map(|r| rig.g.xy(rig.t.net.stops[r.stop].id).0)
        .collect();
    assert_eq!(xs, [24, 30, 10]);
    for rs in &route.stops {
        assert_eq!(route.path[rs.at], rig.t.net.stops[rs.stop].access);
    }
    let (first, last) = (route.path[0], *route.path.last().unwrap());
    assert_eq!(
        rig.g.distance(first, last),
        1,
        "the loop wraps onto the depot road"
    );
    assert!(route
        .path
        .windows(2)
        .all(|w| rig.g.distance(w[0], w[1]) == 1));
}

#[test]
fn a_stop_with_no_road_path_is_not_on_the_route() {
    let mut s = town(2..68, 1);
    put(&mut s, GENRE_BUS_DEPOT, 20, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_STOP, 10, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_STOP, 50, ROAD_Y + 1);
    s.set_tile(35, ROAD_Y, 0); // cuts the road between the depot and the stop at 50
    let rig = Rig::new(&s);
    let route = rig.t.routes[0].as_ref().unwrap();
    assert_eq!(route.stops.len(), 1);
    assert!(route.serves(0) && !route.serves(1));
}

#[test]
fn a_route_visits_at_most_max_route_stops() {
    let mut s = town(2..68, 1);
    put(&mut s, GENRE_BUS_DEPOT, 40, ROAD_Y + 1);
    for x in 4..4 + MAX_ROUTE_STOPS as i32 + 8 {
        put(&mut s, GENRE_BUS_STOP, x, ROAD_Y + 1);
    }
    let rig = Rig::new(&s);
    let route = rig.t.routes[0].as_ref().unwrap();
    assert_eq!(route.stops.len(), MAX_ROUTE_STOPS);
}

#[test]
fn a_depot_with_no_road_or_no_stop_has_no_route() {
    let mut s = town(2..68, 1);
    put(&mut s, GENRE_BUS_DEPOT, 20, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_DEPOT, 20, 3); // far from any road: not even in the net
    let rig = Rig::new(&s);
    assert_eq!(rig.t.net.bus_depots.len(), 1);
    assert_eq!(rig.t.routes, vec![None]);
}

/// Homes `homes` zones, a stop near all of them and a far stop, one bus depot.
fn busy_town(homes: i32) -> Simulation {
    let mut s = town(2..68, homes);
    put(&mut s, GENRE_BUS_STOP, 6, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_STOP, 57, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_DEPOT, 30, ROAD_Y + 1);
    s
}

/// Five homes around the stop at `(8, 13)` (three north of the road, two south), a far stop and a
/// bus depot: 5 x the zone share is more than a stop may hold.
fn crowd_town() -> Simulation {
    let mut s = town(2..68, 0);
    for (x, y) in [(5, 10), (8, 10), (11, 10), (5, 14), (11, 14)] {
        s.set_tile(x, y, (RZB + 27) | ZONEBIT);
    }
    put(&mut s, GENRE_BUS_STOP, 8, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_STOP, 57, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_DEPOT, 30, ROAD_Y + 1);
    s
}

#[test]
fn a_stop_holds_at_most_max_waiting_riders_and_refuses_the_rest() {
    let mut rig = Rig::new(&crowd_town());
    let share = zone_rider_cap(rig.g.zones[0].pop);
    assert!(5 * share > MAX_WAITING_PER_STOP);
    let mut most = 0;
    for _ in 0..8000 {
        rig.now += 1;
        rig.t.try_rider(&rig.g, rig.now);
        most = most.max(rig.t.queues[0].len());
        assert!(rig.t.queues.iter().all(|q| q.len() <= MAX_WAITING_PER_STOP));
    }
    assert_eq!(most, MAX_WAITING_PER_STOP);
    assert_eq!(rig.t.counters.created as usize, MAX_WAITING_PER_STOP);
    assert!(rig.t.counters.refused > 0);
}

#[test]
fn a_zone_never_has_more_riders_than_its_share() {
    let s = busy_town(1);
    let mut rig = Rig::new(&s);
    let cap = zone_rider_cap(rig.g.zones[0].pop);
    assert!(cap > 0 && cap < MAX_WAITING_PER_STOP);
    for _ in 0..2000 {
        rig.now += 1;
        rig.t.try_rider(&rig.g, rig.now);
    }
    assert_eq!(rig.t.queues[0].len(), cap);
    assert_eq!(zone_rider_cap(0), 0);
    assert_eq!(
        zone_rider_cap(40),
        ((40 - 40 * MOTORISED_PCT / 100) / RESIDENTS_PER_RIDER) as usize
    );
}

#[test]
fn taxi_requests_and_the_whole_city_are_capped() {
    let mut s = town(2..68, 12);
    put(&mut s, GENRE_TAXI_DEPOT, 30, ROAD_Y + 1);
    let mut rig = Rig::new(&s);
    for _ in 0..8000 {
        rig.now += 1;
        rig.t.try_rider(&rig.g, rig.now);
        assert!(rig.t.requests.len() <= MAX_TAXI_REQUESTS);
    }
    assert_eq!(rig.t.requests.len(), MAX_TAXI_REQUESTS);
    // fill the city with riders from outside the caps, then nobody new is created
    let stop = rig.t.net.stops.first().map_or(0, |s| s.id);
    while rig.t.audit().waiting < MAX_RIDERS {
        let r = rig.rider(0, stop);
        rig.t.requests.push(r);
    }
    let created = rig.t.counters.created;
    for _ in 0..500 {
        rig.t.try_rider(&rig.g, rig.now);
    }
    assert_eq!(rig.t.counters.created, created);
    assert_eq!(rig.t.audit().waiting, MAX_RIDERS);
}

#[test]
fn a_bus_carries_at_most_its_capacity_and_everybody_arrives() {
    let s = busy_town(1);
    let mut rig = Rig::new(&s);
    let (home_stop, far_stop) = (rig.t.net.stops[0].id, rig.t.net.stops[1].id);
    for _ in 0..MAX_WAITING_PER_STOP {
        let r = rig.rider(0, far_stop);
        rig.t.queues[0].push(r);
    }
    let _ = home_stop;
    let mut fullest = 0;
    for _ in 0..3000 {
        rig.step(1);
        for b in &rig.t.buses {
            assert!(b.riders.len() <= BUS_CAPACITY);
            fullest = fullest.max(b.riders.len());
        }
    }
    assert_eq!(fullest, BUS_CAPACITY);
    let c = rig.t.counters;
    assert_eq!(
        c.bus_trips, c.arrived,
        "no taxi depot: every arrival came by bus"
    );
    assert!(c.bus_trips as usize >= MAX_WAITING_PER_STOP);
    assert_eq!(c.month_income, c.bus_trips as i32 * BUS_FARE);
}

#[test]
fn buses_and_taxis_per_depot_are_capped() {
    let mut s = busy_town(1);
    put(&mut s, GENRE_TAXI_DEPOT, 40, ROAD_Y + 1);
    let mut rig = Rig::new(&s);
    let (mut most_buses, mut most_taxis) = (0, 0);
    for t in 0..2500 {
        if t % 3 == 0 && rig.t.requests.len() < 30 {
            let r = rig.rider(0, 0);
            rig.t.requests.push(r);
        }
        rig.step(1);
        most_buses = most_buses.max(rig.t.buses.len());
        most_taxis = most_taxis.max(rig.t.taxis.len());
        assert!(rig.t.buses.len() <= MAX_BUSES_PER_DEPOT);
        assert!(rig.t.taxis.len() <= MAX_TAXIS_PER_DEPOT);
        assert!(rig.t.counters.searches_in_last_tick <= MAX_TRANSPORT_SEARCHES_PER_TICK);
    }
    assert_eq!(
        (most_buses, most_taxis),
        (MAX_BUSES_PER_DEPOT, MAX_TAXIS_PER_DEPOT)
    );
    assert!(rig.t.counters.max_searches_in_tick >= 1);
}

#[test]
fn buses_leave_one_by_one_at_the_spawn_interval() {
    let s = busy_town(1);
    let mut rig = Rig::new(&s);
    let mut seen = Vec::new();
    for _ in 0..3 * BUS_SPAWN_INTERVAL {
        rig.step(1);
        if seen.last() != Some(&rig.t.buses.len()) {
            seen.push(rig.t.buses.len());
        }
    }
    assert_eq!(seen, [1, 2, 3]);
}

#[test]
fn riders_who_wait_too_long_give_up() {
    let s = busy_town(1);
    let mut rig = Rig::new(&s);
    let far = rig.t.net.stops[1].id;
    let r = rig.rider(0, far);
    rig.t.queues[0].push(r);
    let r = rig.rider(0, 0);
    rig.t.requests.push(r);
    rig.t.expire(MAX_WAIT_TICKS);
    assert_eq!(rig.t.audit().waiting, 2, "not yet");
    rig.t.expire(MAX_WAIT_TICKS + 1);
    assert_eq!((rig.t.audit().waiting, rig.t.counters.abandoned), (0, 2));
    assert!(rig.t.audit().balanced());
}

#[test]
fn a_rider_with_no_taxi_path_gives_up_after_the_failures() {
    let mut s = town(2..68, 1);
    put(&mut s, GENRE_TAXI_DEPOT, 20, ROAD_Y + 1);
    s.set_tile(40, ROAD_Y, 0); // the job zone is on the other side of the cut
    let mut rig = Rig::new(&s);
    let r = rig.rider(0, 0);
    rig.t.requests.push(r);
    for failures in 1..=MAX_TAXI_FAILURES {
        rig.t.counters.searches_in_last_tick = 0;
        rig.t.dispatch_taxi(&rig.g, &mut rig.finder, &rig.load);
        let left = usize::from(failures < MAX_TAXI_FAILURES);
        assert_eq!(rig.t.requests.len(), left, "after {failures}");
        assert!(rig.t.counters.searches_in_last_tick <= MAX_TRANSPORT_SEARCHES_PER_TICK);
    }
    assert_eq!(rig.t.counters.abandoned, 1);
    assert!(rig.t.taxis.is_empty() && rig.t.audit().balanced());
}

#[test]
fn a_changed_network_withdraws_the_vehicles_and_keeps_waiting_riders_at_surviving_stops() {
    let mut s = busy_town(1);
    put(&mut s, GENRE_TAXI_DEPOT, 40, ROAD_Y + 1);
    let mut rig = Rig::new(&s);
    for _ in 0..30 {
        let r = rig.rider(0, 0);
        rig.t.requests.push(r);
    }
    rig.step(200);
    assert!(!rig.t.buses.is_empty() && !rig.t.taxis.is_empty());
    let waiting_at_home_stop = rig.t.queues[0].len();
    let rebuilds = rig.t.counters.rebuilds;
    // a new stop: stops keep their identity, the vehicles are withdrawn
    put(&mut s, GENRE_BUS_STOP, 20, ROAD_Y + 1);
    rig.g = RoadGraph::scan(&s);
    rig.t
        .refresh(&s, &rig.g, &mut rig.finder, &rig.load, rig.now);
    assert_eq!(rig.t.counters.rebuilds, rebuilds + 1);
    assert!(rig.t.buses.is_empty() && rig.t.taxis.is_empty());
    assert_eq!(rig.t.queues.len(), 3);
    assert_eq!(
        rig.t.queues.iter().map(Vec::len).sum::<usize>(),
        waiting_at_home_stop + rig.t.queues[1].len() + rig.t.queues[2].len()
    );
    assert!(rig.t.audit().balanced());
    // removing the stop where riders wait abandons them
    let before = rig.t.counters.abandoned;
    assert_eq!(s.remove_structure(6, ROAD_Y + 1), ToolResult::Ok);
    rig.g = RoadGraph::scan(&s);
    rig.t
        .refresh(&s, &rig.g, &mut rig.finder, &rig.load, rig.now);
    assert_eq!(
        rig.t.counters.abandoned,
        before + waiting_at_home_stop as u64
    );
    assert!(rig.t.audit().balanced());
    assert_eq!(stop_ids(&rig).len(), 2);
}
