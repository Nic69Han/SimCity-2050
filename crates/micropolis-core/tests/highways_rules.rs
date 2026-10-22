//! The highways (docs/game-design-v13.md): rule off = the original engine; on, tiles are laid on
//! classic roads for their cost, refused elsewhere, repaired when the road goes, the traffic of
//! their blocks is divided and the simulated cars drive twice as fast without breaking the
//! conservation of the trips.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::agents::MAX_VEHICLES;
use micropolis_core::highways::*;
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::{COMBASE, HBRIDGE, HRAILROAD, ROADS, RZB, ZONEBIT};
use micropolis_core::tool::{EditingTool, ToolResult};
use support::{file_of, run, state, HAIGHT};

const ROAD_Y: i32 = 12;

fn haight() -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(HAIGHT, 1).expect("the sample city");
    s.total_funds = 1_000_000;
    s
}

fn first_roads(s: &Simulation, n: usize) -> Vec<(i32, i32)> {
    let (w, h) = s.world_size();
    let all = (0..w).flat_map(|x| (0..h).map(move |y| (x, y)));
    all.filter(|&(x, y)| s.tile(x, y).is_some_and(is_highway_road))
        .take(n)
        .collect()
}

#[test]
fn rule_off_is_the_original_engine_for_600_steps() {
    let mut a = haight();
    let mut b = haight();
    b.set_highway_rules(true);
    for (x, y) in first_roads(&b, 5) {
        b.place_highway(x, y);
    }
    b.set_highway_rules(false);
    b.total_funds = a.total_funds;
    assert!(!b.extensions_active());
    run(&mut a, 600);
    run(&mut b, 600);
    assert_eq!(state(&a), state(&b));
    assert_eq!(a.traffic_density_map, b.traffic_density_map);
    assert_eq!(a.rng.clone().random16(), b.rng.clone().random16());
    assert_eq!(file_of(&a), file_of(&b));
}

#[test]
fn the_rule_on_with_no_tile_changes_nothing_but_the_flag() {
    let mut a = haight();
    let mut b = haight();
    b.set_highway_rules(true);
    run(&mut a, 600);
    run(&mut b, 600);
    assert_eq!(state(&a), state(&b));
    assert_eq!(a.traffic_density_map, b.traffic_density_map);
    assert_eq!(a.rng.clone().random16(), b.rng.clone().random16());
}

#[test]
fn a_highway_is_laid_on_a_road_of_the_sample_city() {
    let mut s = haight();
    s.set_highway_rules(true);
    let roads = first_roads(&s, 3);
    let funds = s.total_funds;
    for &(x, y) in &roads {
        assert_eq!(s.highway_preview(x, y).cost, HIGHWAY_COST);
        assert_eq!(s.place_highway(x, y), ToolResult::Ok);
    }
    assert_eq!(s.total_funds, funds - 3 * i64::from(HIGHWAY_COST));
    assert_eq!(s.highway_stats(), [3, 3 * HIGHWAY_UPKEEP]);
    assert_eq!(s.highway_layer().iter().filter(|&&b| b == 1).count(), 3);
    assert_eq!(
        s.place_highway(roads[0].0, roads[0].1),
        ToolResult::Failed,
        "twice"
    );
}

#[test]
fn a_bridge_a_rail_crossing_and_bare_ground_are_refused() {
    let mut s = Simulation::new(30, 30);
    s.total_funds = 10_000;
    s.set_highway_rules(true);
    s.set_tile(3, 3, HBRIDGE);
    s.set_tile(4, 3, HRAILROAD);
    s.set_tile(5, 3, ROADS);
    for (x, y) in [(3, 3), (4, 3), (6, 3), (-2, 3), (3, 99)] {
        assert_eq!(
            s.highway_preview(x, y).result,
            ToolResult::Failed,
            "{x},{y}"
        );
        assert_eq!(s.place_highway(x, y), ToolResult::Failed, "{x},{y}");
    }
    assert_eq!(s.total_funds, 10_000);
    assert_eq!(s.place_highway(5, 3), ToolResult::Ok);
}

#[test]
fn the_yearly_upkeep_is_paid_per_tile() {
    let mut s = Simulation::new(30, 30);
    for x in 5..15 {
        s.set_tile(x, 5, ROADS);
    }
    s.total_funds = 10_000;
    s.set_highway_rules(true);
    for x in 5..12 {
        s.place_highway(x, 5);
    }
    let funds = s.total_funds;
    s.ext_monthly_balance();
    assert_eq!(s.total_funds, funds - 7 * i64::from(HIGHWAY_UPKEEP));
}

#[test]
fn bulldozing_the_road_removes_the_highway_at_the_next_valves() {
    let mut s = haight();
    s.set_highway_rules(true);
    let roads = first_roads(&s, 4);
    for &(x, y) in &roads {
        s.place_highway(x, y);
    }
    let (x, y) = roads[1];
    s.tool_down(EditingTool::Bulldozer, x, y);
    assert!(
        !s.tile(x, y).is_some_and(is_highway_road),
        "the road is gone"
    );
    s.set_valves();
    assert!(!s.is_highway(x, y));
    assert_eq!(s.highway_stats()[0], 3);
    // the others stay
    assert!(roads
        .iter()
        .filter(|&&r| r != (x, y))
        .all(|&(a, b)| s.is_highway(a, b)));
}

#[test]
fn a_block_that_holds_a_highway_has_its_traffic_divided_the_others_not() {
    let mut s = haight();
    s.set_highway_rules(true);
    let (x, y) = first_roads(&s, 1)[0];
    let bs = s.traffic_density_map.block_size();
    let (bx, by) = (x - x % bs, y - y % bs);
    assert_eq!(s.ext_traffic(bx, by, 100), 100);
    s.place_highway(x, y);
    assert_eq!(s.ext_traffic(bx, by, 100), 100 / HIGHWAY_TRAFFIC_DIV);
    let other = (0..s.world_size().0)
        .step_by(bs as usize)
        .find(|&ox| ox != bx)
        .unwrap();
    assert_eq!(s.ext_traffic(other, by, 100), 100);
    s.set_highway_rules(false);
    assert_eq!(s.ext_traffic(bx, by, 100), 100);
}

#[test]
fn the_dec_traffic_map_applies_the_division() {
    let mut s = haight();
    s.set_highway_rules(true);
    let (x, y) = first_roads(&s, 1)[0];
    let bs = s.traffic_density_map.block_size();
    let (bx, by) = (x - x % bs, y - y % bs);
    s.place_highway(x, y);
    let mut plain = haight();
    for sim in [&mut s, &mut plain] {
        sim.traffic_density_map.world_set(bx, by, 150);
        sim.dec_traffic_map();
    }
    let decayed = plain.traffic_density_map.world_get(bx, by);
    assert_eq!(decayed, 150 - 24);
    assert_eq!(
        i32::from(s.traffic_density_map.world_get(bx, by)),
        i32::from(decayed) / HIGHWAY_TRAFFIC_DIV
    );
}

// ---- the cars --------------------------------------------------------------------------------

/// A road along `ROAD_Y`, homes at the west end and commercial zones at the east end.
fn corridor(len: i32, fast: bool) -> Simulation {
    let mut s = Simulation::new(len + 8, 24);
    for x in 2..=2 + len {
        s.set_tile(x, ROAD_Y, ROADS);
    }
    for i in 0..6 {
        let y = if i % 2 == 0 { ROAD_Y - 2 } else { ROAD_Y + 2 };
        s.set_tile(4 + 3 * (i / 2), y, (RZB + 27) | ZONEBIT);
    }
    for i in 0..4 {
        let y = if i % 2 == 0 { ROAD_Y - 2 } else { ROAD_Y + 2 };
        s.set_tile(len - 3 * (i / 2), y, COMBASE | ZONEBIT);
    }
    s.total_funds = 100_000;
    if fast {
        s.set_highway_rules(true);
        for x in 2..=2 + len {
            assert_eq!(s.place_highway(x, ROAD_Y), ToolResult::Ok);
        }
    }
    s.set_agent_rules(true);
    s
}

fn assert_conserved(s: &Simulation) {
    let (c, driving) = (s.agent_counters(), s.agent_stats()[0] as u64);
    let (parked, returning) = (c.parked as u64, c.returning as u64);
    assert_eq!(c.spawned, driving + parked + c.round_trips + c.abandoned);
    assert!(c.finished + c.abandoned >= 2 * c.round_trips + parked + returning);
    assert!(driving + parked <= MAX_VEHICLES as u64);
}

#[test]
fn cars_are_faster_on_a_highway_and_the_trips_stay_conserved() {
    let (mut slow, mut fast) = (corridor(60, false), corridor(60, true));
    for _ in 0..700 {
        slow.ext_agents_tick();
        fast.ext_agents_tick();
        assert_conserved(&slow);
        assert_conserved(&fast);
    }
    let (a, b) = (slow.agent_stats(), fast.agent_stats());
    assert!(a[1] > 0 && b[1] > 0, "trips finished: {a:?} {b:?}");
    assert!(
        b[2] < a[2],
        "mean trip ticks: highway {} vs road {}",
        b[2],
        a[2]
    );
    assert!(
        b[2] * 10 <= a[2] * 8,
        "clearly faster: highway {} vs road {}",
        b[2],
        a[2]
    );
}

#[test]
fn a_car_never_covers_more_than_a_tile_per_tick() {
    let mut s = corridor(60, true);
    let mut last: std::collections::HashMap<i32, (i32, i32)> = Default::default();
    for _ in 0..300 {
        s.ext_agents_tick();
        for v in s.agent_vehicles(MAX_VEHICLES) {
            if let Some(&(px, _)) = last.get(&v[0]) {
                assert!(
                    (v[2] - px).abs() <= 16,
                    "car {} jumped {} -> {}",
                    v[0],
                    px,
                    v[2]
                );
            }
            last.insert(v[0], (v[2], v[3]));
        }
    }
    assert!(!last.is_empty());
}

#[test]
fn the_fleet_with_highways_is_deterministic() {
    let (mut a, mut b) = (corridor(50, true), corridor(50, true));
    for _ in 0..400 {
        a.ext_agents_tick();
        b.ext_agents_tick();
    }
    assert_ne!(a.agent_fingerprint(), 0);
    assert_eq!(a.agent_fingerprint(), b.agent_fingerprint());
}

#[test]
fn highways_laid_while_the_cars_run_keep_them_conserved() {
    let mut s = corridor(60, false);
    s.set_highway_rules(true);
    for t in 0..600 {
        if t % 25 == 0 {
            let x = 2 + t / 10;
            s.place_highway(x, ROAD_Y);
        }
        if t == 400 {
            s.set_highway_rules(false); // all taken up at once
        }
        s.ext_agents_tick();
        assert_conserved(&s);
    }
    assert!(s.agent_counters().finished > 0);
}
