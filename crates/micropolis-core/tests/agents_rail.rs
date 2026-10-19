//! Trains and metro (docs/game-design-v06.md) in a hand-built town, driven with
//! `ext_agents_tick`: the gare's placement rule, when the lines exist, who rides what, fares and
//! the monthly balance, conservation of the riders every tick across all modes, determinism and
//! the rules off = the original engine.

#[path = "transport_support/mod.rs"]
mod support;

use micropolis_core::agents::transport::rail::{METRO_FARE, TRAIN_FARE};
use micropolis_core::agents::MAX_VEHICLES;
use micropolis_core::simulation::Simulation;
use micropolis_core::structures::{GENRE_BUS_DEPOT, GENRE_BUS_STOP, GENRE_STATION};
use micropolis_core::tile::{HRAIL, ROADBASE};
use micropolis_core::tool::ToolResult;
use support::*;

const RAIL_Y: i32 = 15;
const GARE_A: (i32, i32) = (10, 14);
const GARE_B: (i32, i32) = (53, 14);
const TUNNEL_Y: i32 = 14;

/// The support town (a road along `ROAD_Y` = 12, home at x = 5, job at x = 56) moved south: a
/// second road and zones would clash, so this one builds its own on the same map size.
fn rail_town() -> Simulation {
    let mut s = Simulation::new(WIDTH, 24);
    for x in 2..WIDTH - 2 {
        s.set_tile(x, 19, ROADBASE);
    }
    s.set_tile(
        9,
        17,
        (micropolis_core::tile::RZB + 27) | micropolis_core::tile::ZONEBIT,
    );
    s.set_tile(
        55,
        17,
        micropolis_core::tile::COMBASE | micropolis_core::tile::ZONEBIT,
    );
    s.total_funds = MONEY;
    s.set_structure_rules(true);
    s.set_agent_rules(true);
    s
}

fn with_rails(s: &mut Simulation) {
    for x in 12..53 {
        s.set_tile(x, RAIL_Y, HRAIL);
    }
    put(s, GENRE_STATION, GARE_A.0, GARE_A.1);
    put(s, GENRE_STATION, GARE_B.0, GARE_B.1);
}

fn with_metro(s: &mut Simulation) {
    s.set_transit_rules(true);
    for x in 9..=55 {
        s.place_tunnel(x, TUNNEL_Y);
    }
    assert_eq!(s.place_station(9, TUNNEL_Y), ToolResult::Ok);
    assert_eq!(s.place_station(55, TUNNEL_Y), ToolResult::Ok);
}

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
        let r = s.rail_stats();
        assert_eq!(r[0] as usize, count_kind(s, 3));
        assert_eq!(r[1] as usize, count_kind(s, 4));
    }
}

#[test]
fn a_gare_needs_a_classic_rail_tile_next_to_its_footprint() {
    let mut s = rail_town();
    let (x, y) = GARE_A;
    assert_eq!(
        s.structure_preview(GENRE_STATION, x, y).result,
        ToolResult::Failed
    );
    assert_eq!(s.place_structure(GENRE_STATION, x, y), ToolResult::Failed);
    // a road does not do, nor does a rail on a corner (diagonal)
    s.set_tile(x + 2, y, ROADBASE);
    s.set_tile(x + 2, y + 2, HRAIL);
    assert_eq!(s.place_structure(GENRE_STATION, x, y), ToolResult::Failed);
    // a rail on any of the eight side tiles does
    for (dx, dy) in [
        (2, 0),
        (2, 1),
        (-1, 0),
        (-1, 1),
        (0, -1),
        (1, -1),
        (0, 2),
        (1, 2),
    ] {
        let mut t = rail_town();
        t.set_tile(x + dx, y + dy, HRAIL);
        assert_eq!(
            t.place_structure(GENRE_STATION, x, y),
            ToolResult::Ok,
            "{dx},{dy}"
        );
    }
    // the rule is the structures rule: off, nothing is placed
    let mut off = rail_town();
    off.set_tile(x + 2, y, HRAIL);
    off.set_structure_rules(false);
    assert_eq!(off.place_structure(GENRE_STATION, x, y), ToolResult::Failed);
}

#[test]
fn nothing_runs_without_the_rules_and_the_stats_are_zero() {
    let mut s = rail_town();
    with_rails(&mut s);
    s.set_agent_rules(false);
    ticks(&mut s, 300);
    assert_eq!(s.rail_stats(), [0; 7]);
    assert!(s.transport_state().is_none());
    // the buildings rule without cars: the same
    s.set_agent_rules(true);
    s.set_structure_rules(false);
    ticks(&mut s, 300);
    assert_eq!(s.rail_stats(), [0; 7]);
    // a lone gare makes no line; a metro without the transit rule neither
    let mut t = rail_town();
    t.set_tile(12, RAIL_Y, HRAIL);
    put(&mut t, GENRE_STATION, 10, 14);
    with_metro(&mut t);
    t.set_transit_rules(false);
    ticks(&mut t, 300);
    assert_eq!(t.rail_stats(), [0; 7]);
}

#[test]
fn trains_carry_riders_between_two_gares_and_the_fares_add_up() {
    let mut s = rail_town();
    with_rails(&mut s);
    run_checked(&mut s, 2500);
    let c = s.transport_counters();
    let r = s.rail_stats();
    assert!(c.train_trips > 10, "{c:?}");
    assert_eq!(
        (c.bus_trips, c.taxi_rides, c.metro_trips, count_kind(&s, 4)),
        (0, 0, 0, 0)
    );
    assert_eq!(c.arrived, c.train_trips);
    assert_eq!(r[2] as u64, c.train_trips);
    assert_eq!(r[4], c.train_trips as i32 * TRAIN_FARE);
    assert_eq!((r[5], r[6]), (1, 0));
    assert!(r[0] >= 1 && r[0] <= 2);
    assert_eq!(
        s.transport_stats()[5],
        0,
        "transport_stats counts buses and taxis only"
    );
    // a train is a vehicle of kind 3 on the rail row
    let seen = (0..400).any(|_| {
        ticks(&mut s, 1);
        vehicles(&s)
            .iter()
            .any(|v| v[1] == 3 && v[3] == RAIL_Y * 16 + 8 && v[4] % 2 == 1)
    });
    assert!(seen);
}

#[test]
fn the_rail_fares_reach_the_monthly_balance_once() {
    let mut s = rail_town();
    with_rails(&mut s);
    run_checked(&mut s, 2500);
    let r = s.rail_stats();
    assert!(r[4] > 0);
    let (funds, upkeep) = (s.total_funds, i64::from(s.structures_upkeep()));
    s.ext_monthly_balance();
    assert_eq!(s.total_funds, funds - upkeep + i64::from(r[4]));
    let after = s.rail_stats();
    assert_eq!(
        (after[2], after[3], after[4]),
        (0, 0, 0),
        "a new month starts"
    );
    assert_eq!((after[5], after[6]), (r[5], r[6]), "the lines stay");
    let again = s.total_funds;
    s.ext_monthly_balance();
    assert_eq!(s.total_funds, again - upkeep, "fares are paid once");
}

#[test]
fn metro_cars_run_under_the_transit_rule_and_are_vehicles_of_kind_4() {
    let mut s = rail_town();
    with_metro(&mut s);
    run_checked(&mut s, 2500);
    let (c, r) = (s.transport_counters(), s.rail_stats());
    assert!(c.metro_trips > 10, "{c:?}");
    assert_eq!(c.arrived, c.metro_trips);
    assert_eq!(
        (r[3] as u64, r[4]),
        (c.metro_trips, c.metro_trips as i32 * METRO_FARE)
    );
    assert_eq!((r[5], r[6]), (0, 1));
    assert!(count_kind(&s, 4) >= 1 && count_kind(&s, 3) == 0);
    // the cars are below the surface rows' roads: on the tunnel row
    let on_tunnel = vehicles(&s)
        .iter()
        .any(|v| v[1] == 4 && v[3] == TUNNEL_Y * 16 + 8);
    assert!(on_tunnel);
    s.set_transit_rules(false);
    ticks(&mut s, 300);
    assert_eq!((s.rail_stats()[1], s.rail_stats()[6]), (0, 0));
    assert!(s.transport_audit().balanced());
}

#[test]
fn the_cheapest_mode_wins_and_riders_follow_when_it_disappears() {
    let mut s = rail_town();
    with_rails(&mut s);
    // a bus line over the same trip is dearer per tile than the train
    put(&mut s, GENRE_BUS_STOP, 12, 20);
    put(&mut s, GENRE_BUS_STOP, 52, 20);
    put(&mut s, GENRE_BUS_DEPOT, 30, 20);
    run_checked(&mut s, 2500);
    let c = s.transport_counters();
    assert!(c.train_trips > 5 && c.bus_trips == 0, "{c:?}");
    // the metro is cheaper still (81 against 84 for the train)
    with_metro(&mut s);
    run_checked(&mut s, 2500);
    let d = s.transport_counters();
    assert!(d.metro_trips > 5, "{d:?}");
    let trains = d.train_trips;
    run_checked(&mut s, 1500);
    assert_eq!(
        s.transport_counters().train_trips,
        trains,
        "nobody takes the dearer train"
    );
    // the metro goes: the train takes over again
    s.set_transit_rules(false);
    run_checked(&mut s, 2500);
    assert!(s.transport_counters().train_trips > trains);
}

#[test]
fn riders_are_conserved_every_tick_through_changes_of_every_network() {
    let mut s = rail_town();
    with_rails(&mut s);
    with_metro(&mut s);
    put(&mut s, GENRE_BUS_STOP, 12, 20);
    put(&mut s, GENRE_BUS_STOP, 52, 20);
    put(&mut s, GENRE_BUS_DEPOT, 30, 20);
    support::with_taxis(&mut s);
    run_checked(&mut s, 800);
    s.set_tile(30, RAIL_Y, 0); // a cut rail
    run_checked(&mut s, 500);
    s.set_tile(30, RAIL_Y, HRAIL);
    run_checked(&mut s, 500);
    s.remove_tunnel(30, TUNNEL_Y); // a cut tunnel
    run_checked(&mut s, 500);
    assert_eq!(s.remove_structure(GARE_B.0, GARE_B.1), ToolResult::Ok);
    run_checked(&mut s, 500);
    s.set_transit_rules(false);
    run_checked(&mut s, 500);
    let c = s.transport_counters();
    assert!(c.created > 0 && c.arrived > 0 && c.abandoned > 0, "{c:?}");
}

fn run_town(n: usize, extra_gare: bool) -> Simulation {
    let mut s = rail_town();
    with_rails(&mut s);
    with_metro(&mut s);
    if extra_gare {
        put(&mut s, GENRE_STATION, 30, 16);
    }
    ticks(&mut s, n);
    s
}

#[test]
fn two_runs_are_identical_and_the_fingerprint_covers_the_rail() {
    let (a, b) = (run_town(1500, false), run_town(1500, false));
    assert_eq!(a.agent_fingerprint(), b.agent_fingerprint());
    assert_eq!(a.rail_stats(), b.rail_stats());
    assert_eq!(vehicles(&a), vehicles(&b));
    assert_ne!(
        a.agent_fingerprint(),
        run_town(1500, true).agent_fingerprint()
    );
    let mut c = run_town(900, false);
    let mut seen = std::collections::HashSet::new();
    for _ in 0..30 {
        ticks(&mut c, 1);
        seen.insert(c.agent_fingerprint());
    }
    assert_eq!(seen.len(), 30);
}

#[test]
fn vehicle_ids_are_unique_and_kinds_are_known() {
    let mut s = run_town(0, false);
    for _ in 0..800 {
        ticks(&mut s, 1);
        let all = vehicles(&s);
        let ids: std::collections::HashSet<i32> = all.iter().map(|v| v[0]).collect();
        assert_eq!(ids.len(), all.len());
        assert!(all
            .iter()
            .all(|v| (0..=4).contains(&v[1]) && (0..4).contains(&v[4])));
    }
    assert!(count_kind(&s, 3) > 0 && count_kind(&s, 4) > 0);
}

#[test]
fn the_cars_are_the_same_with_or_without_the_rail() {
    let cars = |rail: bool| {
        let mut s = rail_town();
        if rail {
            with_rails(&mut s);
            with_metro(&mut s);
        }
        let mut seen = Vec::new();
        for _ in 0..20 {
            ticks(&mut s, 50);
            seen.push(
                vehicles(&s)
                    .into_iter()
                    .filter(|v| v[1] == 0)
                    .collect::<Vec<_>>(),
            );
        }
        seen
    };
    assert_eq!(cars(false), cars(true));
}
