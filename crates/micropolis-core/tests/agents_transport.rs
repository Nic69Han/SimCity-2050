//! Buses and taxis (docs/game-design-v05.md) in a hand-built town, driven with `ext_agents_tick`:
//! when they run, who rides what, fares and the monthly balance, conservation of the riders every
//! tick, changes of the network, determinism and the rule off = the original engine.

#[path = "save_support/mod.rs"]
mod save;
#[path = "transport_support/mod.rs"]
mod support;

use micropolis_core::agents::transport::VEHICLE_ID_BASE;
use micropolis_core::agents::MAX_VEHICLES;
use micropolis_core::simulation::Simulation;
use micropolis_core::structures::{GENRE_BUS_DEPOT, GENRE_BUS_STOP, GENRE_TAXI_DEPOT};
use micropolis_core::tool::{EditingTool, ToolResult};
use std::collections::HashSet;
use support::*;

fn vehicles(s: &Simulation) -> Vec<[i32; 5]> {
    s.agent_vehicles(MAX_VEHICLES)
}

fn count_kind(s: &Simulation, kind: i32) -> usize {
    vehicles(s).iter().filter(|v| v[1] == kind).count()
}

/// Ticks one by one, asserting the conservation law and the stats against the audit.
fn run_checked(s: &mut Simulation, n: usize) {
    for _ in 0..n {
        ticks(s, 1);
        let a = s.transport_audit();
        assert!(a.balanced(), "{a:?}");
        assert_eq!(s.transport_stats()[2] as usize, a.waiting);
    }
}

#[test]
fn nothing_runs_unless_both_rules_are_on() {
    // structures only
    let mut s = town(2);
    with_buses(&mut s);
    with_taxis(&mut s);
    s.set_agent_rules(false);
    ticks(&mut s, 300);
    assert_eq!(s.transport_stats(), [0; 6]);
    assert!(vehicles(&s).is_empty() && s.transport_state().is_none());
    // cars only: the buildings are gone with the rule
    s.set_agent_rules(true);
    s.set_structure_rules(false);
    ticks(&mut s, 300);
    assert_eq!(s.transport_stats(), [0; 6]);
    assert!(s.transport_state().is_none());
    assert!(vehicles(&s).iter().all(|v| v[1] == 0));
    // both on but no building: nothing, and the cars are the same as with the rule off
    s.set_structure_rules(true);
    ticks(&mut s, 300);
    assert_eq!(s.transport_stats(), [0; 6]);
    assert_eq!(s.transport_counters().created, 0);
}

#[test]
fn turning_a_rule_off_drops_the_transport() {
    let mut s = town(4);
    with_buses(&mut s);
    with_taxis(&mut s);
    run_checked(&mut s, 800);
    assert!(s.transport_stats()[0] > 0 && s.transport_stats()[1] > 0);
    s.set_structure_rules(false);
    ticks(&mut s, 5);
    assert_eq!(s.transport_stats(), [0; 6]);
    assert_eq!(s.transport_audit().created, 0);
    s.set_structure_rules(true);
    with_buses(&mut s);
    run_checked(&mut s, 400);
    assert!(
        s.transport_counters().created > 0,
        "it starts again from nothing"
    );
}

#[test]
fn buses_carry_riders_between_two_stops_and_the_fares_add_up() {
    let mut s = town(1);
    with_buses(&mut s);
    run_checked(&mut s, 1800);
    let c = s.transport_counters();
    assert!(c.bus_trips > 10, "{c:?}");
    assert_eq!((c.taxi_rides, count_kind(&s, 2)), (0, 0));
    assert_eq!(c.arrived, c.bus_trips);
    assert_eq!(
        i64::from(c.month_income),
        c.bus_trips as i64 * i64::from(bus_fare())
    );
    assert_eq!(s.transport_stats()[3] as u64, c.bus_trips);
    // a bus is a vehicle of kind 1 on the road row, driving east or west
    let seen = (0..300).any(|_| {
        ticks(&mut s, 1);
        vehicles(&s).iter().any(|v| {
            v[1] == 1 && v[0] >= VEHICLE_ID_BASE as i32 && v[3] == ROAD_Y * 16 + 8 && v[4] % 2 == 1
        })
    });
    assert!(seen);
}

#[test]
fn taxis_drive_depot_home_job_depot_and_charge_per_tile() {
    let mut s = town(1);
    with_taxis(&mut s);
    let mut saw_taxi = false;
    for _ in 0..1500 {
        run_checked(&mut s, 1);
        saw_taxi |= count_kind(&s, 2) > 0;
        assert_eq!(count_kind(&s, 1), 0, "no bus without a depot");
    }
    let c = s.transport_counters();
    assert!(saw_taxi && c.taxi_rides > 5, "{c:?}");
    assert_eq!(c.bus_trips, 0);
    // the home road is x = 6 and the job road x = 57: 51 tiles per ride
    assert_eq!(c.month_income, c.taxi_rides as i32 * taxi_fare(51));
}

#[test]
fn a_bus_is_taken_only_with_a_stop_near_both_ends_otherwise_a_taxi() {
    // a stop only at home: everybody goes by taxi
    let mut s = town(1);
    put(&mut s, GENRE_BUS_STOP, HOME_X + 3, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_DEPOT, 28, ROAD_Y + 1);
    with_taxis(&mut s);
    run_checked(&mut s, 1500);
    let c = s.transport_counters();
    assert_eq!(c.bus_trips, 0);
    assert!(c.taxi_rides > 0);
    // add the job stop: buses now carry riders, and the taxi still serves nobody it need not
    put(&mut s, GENRE_BUS_STOP, JOB_X - 3, ROAD_Y + 1);
    run_checked(&mut s, 1500);
    assert!(s.transport_counters().bus_trips > 0);
}

#[test]
fn a_stop_beyond_the_walking_radius_is_not_used() {
    // the stop at 7 tiles (Manhattan) from the home centre: out of reach, so everybody takes a taxi
    let mut s = town(1);
    put(&mut s, GENRE_BUS_STOP, HOME_X + 4, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_STOP, JOB_X - 3, ROAD_Y + 1);
    put(&mut s, GENRE_BUS_DEPOT, 28, ROAD_Y + 1);
    with_taxis(&mut s);
    run_checked(&mut s, 1200);
    let c = s.transport_counters();
    assert_eq!(c.bus_trips, 0);
    assert!(c.taxi_rides > 0);
    // 6 tiles is in reach (the stop of `with_buses`)
    let mut t = town(1);
    with_buses(&mut t);
    run_checked(&mut t, 1200);
    assert!(t.transport_counters().bus_trips > 0);
}

#[test]
fn the_fares_reach_the_monthly_balance_with_the_upkeep() {
    let mut s = town(4);
    with_buses(&mut s);
    with_taxis(&mut s);
    run_checked(&mut s, 1200);
    let stats = s.transport_stats();
    assert!(stats[5] > 0 && stats[3] > 0 && stats[4] > 0);
    assert!(
        stats[5] > stats[3] * bus_fare(),
        "taxi fares come on top of the bus fares"
    );
    let (funds, upkeep) = (s.total_funds, i64::from(s.structures_upkeep()));
    s.ext_monthly_balance();
    assert_eq!(s.total_funds, funds - upkeep + i64::from(stats[5]));
    let after = s.transport_stats();
    assert_eq!(
        (after[3], after[4], after[5]),
        (0, 0, 0),
        "a new month starts"
    );
    let again = s.total_funds;
    s.ext_monthly_balance();
    assert_eq!(s.total_funds, again - upkeep, "fares are paid once");
}

#[test]
fn riders_are_conserved_every_tick_through_changes_of_the_network() {
    let mut s = town(3);
    with_buses(&mut s);
    with_taxis(&mut s);
    run_checked(&mut s, 700);
    put(&mut s, GENRE_BUS_STOP, 20, ROAD_Y + 1); // a new stop
    run_checked(&mut s, 400);
    assert_eq!(s.remove_structure(HOME_X + 3, ROAD_Y + 1), ToolResult::Ok);
    run_checked(&mut s, 400);
    assert_eq!(s.remove_structure(28, ROAD_Y + 1), ToolResult::Ok); // the bus depot
    run_checked(&mut s, 400);
    s.set_tile(40, ROAD_Y, 0); // a cut road
    run_checked(&mut s, 600);
    let c = s.transport_counters();
    assert!(c.rebuilds >= 5, "{c:?}");
    assert!(
        c.abandoned > 0,
        "riders on removed stops or vehicles are counted"
    );
    assert!(c.arrived > 0);
    assert!(s.transport_audit().balanced());
}

#[test]
fn a_cut_road_stops_the_bus_riders_to_the_far_stop() {
    let mut s = town(1);
    with_buses(&mut s);
    run_checked(&mut s, 600);
    s.set_tile(40, ROAD_Y, 0); // between the depot and the job stop
    ticks(&mut s, 40);
    let trips = s.transport_counters().bus_trips;
    run_checked(&mut s, 800);
    assert_eq!(
        s.transport_counters().bus_trips,
        trips,
        "the far stop is unreachable"
    );
    assert_eq!(
        count_kind(&s, 1),
        3,
        "the buses still serve what they can reach"
    );
}

#[test]
fn vehicle_ids_are_unique_and_max_truncates() {
    let mut s = town(3);
    with_buses(&mut s);
    with_taxis(&mut s);
    for _ in 0..600 {
        ticks(&mut s, 1);
        let all = vehicles(&s);
        let ids: HashSet<i32> = all.iter().map(|v| v[0]).collect();
        assert_eq!(ids.len(), all.len());
        assert!(all
            .iter()
            .all(|v| (0..=2).contains(&v[1]) && (0..4).contains(&v[4])));
        assert_eq!(s.agent_vehicles(2).len(), all.len().min(2));
    }
    let kinds: HashSet<i32> = vehicles(&s).iter().map(|v| v[1]).collect();
    assert!(kinds.contains(&1) || kinds.contains(&2));
}

/// The town with every kind of building, run for `n` ticks.
fn run_town(n: usize, extra_stop: bool) -> Simulation {
    let mut s = town(3);
    with_buses(&mut s);
    with_taxis(&mut s);
    if extra_stop {
        put(&mut s, GENRE_BUS_STOP, 40, ROAD_Y + 1);
    }
    ticks(&mut s, n);
    s
}

#[test]
fn two_runs_are_identical_and_the_fingerprint_covers_the_transport() {
    let (a, b) = (run_town(1500, false), run_town(1500, false));
    assert_eq!(a.agent_fingerprint(), b.agent_fingerprint());
    assert_eq!(a.transport_stats(), b.transport_stats());
    assert_eq!(vehicles(&a), vehicles(&b));
    assert_ne!(
        a.agent_fingerprint(),
        run_town(1500, true).agent_fingerprint()
    );
    // the fingerprint moves with every tick of a running transport
    let mut c = run_town(900, false);
    let mut seen = HashSet::new();
    for _ in 0..30 {
        ticks(&mut c, 1);
        seen.insert(c.agent_fingerprint());
    }
    assert_eq!(seen.len(), 30);
}

#[test]
fn the_buildings_rule_without_a_building_leaves_the_cars_and_the_city_alone() {
    let make = |structures: bool| {
        let mut s = Simulation::new(120, 100);
        s.new_random_city(7);
        save::starter(&mut s);
        s.set_agent_rules(true);
        s.set_structure_rules(structures);
        let mut views = Vec::new();
        for _ in 0..8 {
            save::run(&mut s, 50);
            views.push(vehicles(&s));
        }
        (s, views)
    };
    let (off, off_views) = make(false);
    let (on, on_views) = make(true);
    assert_eq!(off_views, on_views);
    assert_eq!(off.agent_counters(), on.agent_counters());
    assert_eq!(save::state(&off), save::state(&on));
}

/// Builds up to `want` buildings of `genre` on Haight, bulldozing what is in the way. Depots go
/// only where a stop could stand (a road next to the top-left tile) and not on a road.
fn build_on_haight(s: &mut Simulation, genre: u8, want: usize) -> usize {
    let size = if genre == GENRE_BUS_STOP { 1 } else { 2 };
    let mut n = 0;
    for y in (2..96).step_by(4) {
        for x in (2..116).step_by(4) {
            let roadside = s.structure_preview(GENRE_BUS_STOP, x, y).result != ToolResult::Failed;
            let free = (0..size * size).all(|i| {
                let t = s.tile(x + i % size, y + i / size).unwrap() & 0x3ff;
                !(64..=238).contains(&t)
            });
            if n >= want || !roadside || !free {
                continue;
            }
            for i in 0..size * size {
                s.do_tool(EditingTool::Bulldozer, x + i % size, y + i / size);
            }
            n += usize::from(s.place_structure(genre, x, y) == ToolResult::Ok);
        }
    }
    n
}

#[test]
fn the_transport_runs_on_the_sample_city_and_conserves_its_riders() {
    let mut s = Simulation::with_default_size();
    s.load_city(save::HAIGHT, 1).expect("the sample city");
    s.set_agent_rules(true);
    s.set_structure_rules(true);
    assert!(build_on_haight(&mut s, GENRE_BUS_STOP, 12) >= 6);
    assert!(build_on_haight(&mut s, GENRE_BUS_DEPOT, 2) >= 1);
    assert!(build_on_haight(&mut s, GENRE_TAXI_DEPOT, 2) >= 1);
    for _ in 0..80 {
        save::run(&mut s, 20);
        assert!(s.transport_audit().balanced());
    }
    let c = s.transport_counters();
    assert!(c.created > 0 && c.arrived > 0, "{c:?}");
    assert!(vehicles(&s).iter().all(|v| (0..=2).contains(&v[1])));
}

/// Cost of the transport on Haight (`cargo test --release -p micropolis-core --test
/// agents_transport -- --ignored --nocapture`): milliseconds per tick with and without the buildings.
#[test]
#[ignore]
fn transport_overhead_on_haight() {
    let per_tick = |buildings: bool| {
        let mut s = Simulation::with_default_size();
        s.load_city(save::HAIGHT, 1).unwrap();
        s.set_agent_rules(true);
        s.set_structure_rules(true);
        if buildings {
            build_on_haight(&mut s, GENRE_BUS_STOP, 20);
            build_on_haight(&mut s, GENRE_BUS_DEPOT, 3);
            build_on_haight(&mut s, GENRE_TAXI_DEPOT, 3);
        }
        save::run(&mut s, 500);
        let start = std::time::Instant::now();
        save::run(&mut s, 3000);
        start.elapsed().as_secs_f64() * 1000.0 / 3000.0
    };
    let (without, with) = (per_tick(false), per_tick(true));
    println!("ms/tick cars only {without:.4}, with transport {with:.4}");
}
