//! The simulated cars (docs/game-design-v03.md): rule off = the original engine; rule on =
//! deterministic, conserving, capped cars whose measured load replaces the traffic density.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::agents::path::{PathFinder, MAX_EXPANSIONS, MAX_PATH_LEN};
use micropolis_core::agents::{
    graph::RoadGraph, MAX_PATH_SEARCHES_PER_TICK, MAX_VEHICLES, REFRESH_INTERVAL,
};
use micropolis_core::simulation::Simulation;
use micropolis_core::tool::EditingTool;
use support::{file_of, run, state, HAIGHT};

fn haight(agents: bool) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(HAIGHT, 1).expect("the sample city");
    s.set_agent_rules(agents);
    s
}

#[test]
fn rule_off_is_the_original_engine() {
    let mut a = haight(false);
    let mut b = haight(false);
    run(&mut a, 400);
    run(&mut b, 400);
    assert_eq!(state(&a), state(&b));
    assert_eq!(a.agent_stats(), [0; 5]);
    assert!(a.agent_vehicles(10).is_empty());
    assert!(a.agent_traffic_load().iter().all(|&l| l == 0));
    assert_eq!(a.agent_traffic_load().len(), a.tiles.len());
    assert_eq!(a.agent_fingerprint(), 0);
}

#[test]
fn the_agents_never_draw_the_simulation_generator() {
    let mut s = haight(true);
    run(&mut s, 50);
    let before = s.rng.clone().random16();
    for _ in 0..500 {
        s.ext_agents_tick();
    }
    assert!(s.agent_stats()[0] > 0);
    assert_eq!(s.rng.clone().random16(), before);
}

#[test]
fn two_runs_give_the_same_fingerprint() {
    let (mut a, mut b) = (haight(true), haight(true));
    run(&mut a, 600);
    run(&mut b, 600);
    assert_ne!(a.agent_fingerprint(), 0);
    assert_eq!(a.agent_fingerprint(), b.agent_fingerprint());
    assert_eq!(
        a.agent_vehicles(MAX_VEHICLES),
        b.agent_vehicles(MAX_VEHICLES)
    );
    assert_eq!(state(&a), state(&b));
}

#[test]
fn cars_drive_and_finish_trips() {
    let mut s = haight(true);
    run(&mut s, 800);
    let st = s.agent_stats();
    assert!(st[0] > 0, "cars on the road");
    assert!(st[1] > 0, "trips finished");
    assert!(st[2] > 0, "a trip takes time");
    assert!(st[4] > 0, "motorised residents");
    let (w, h) = s.world_size();
    for v in s.agent_vehicles(MAX_VEHICLES) {
        assert_eq!(v[1], 0);
        assert!((0..w * 16).contains(&v[2]) && (0..h * 16).contains(&v[3]));
        assert!((0..4).contains(&v[4]));
    }
    assert!(s.agent_vehicles(3).len() <= 3);
}

#[test]
fn no_car_is_lost_or_duplicated() {
    let mut s = haight(true);
    for _ in 0..40 {
        run(&mut s, 25);
        let c = s.agent_counters();
        let active = s.agent_stats()[0] as u64;
        assert_eq!(
            c.spawned,
            active + c.parked as u64 + c.round_trips + c.abandoned
        );
        let mut ids: Vec<i32> = s
            .agent_vehicles(MAX_VEHICLES)
            .iter()
            .map(|v| v[0])
            .collect();
        let n = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), n, "ids are unique");
    }
}

#[test]
fn caps_hold() {
    let mut s = haight(true);
    run(&mut s, 1500);
    let c = s.agent_counters();
    assert!(c.max_cars <= MAX_VEHICLES && c.max_present <= MAX_VEHICLES);
    assert!(c.max_searches_in_tick <= MAX_PATH_SEARCHES_PER_TICK);
    assert!(c.max_expansions <= MAX_EXPANSIONS + 1);
    assert!(c.max_path_len <= MAX_PATH_LEN);
}

#[test]
fn a_search_stops_at_its_expansion_cap() {
    // a long straight road: the goal is farther than the path cap allows
    let mut s = Simulation::new(400, 10);
    s.total_funds = 1_000_000;
    s.tool_drag(EditingTool::Road, 0, 5, 399, 5);
    let g = RoadGraph::scan(&s);
    let load = vec![0u8; g.class_len()];
    let mut f = PathFinder::default();
    assert_eq!(g.roads.len(), 400, "the whole road is built");
    let (a, b) = (g.index(0, 5).unwrap(), g.index(399, 5).unwrap());
    assert!(f.find(&g, &load, a, b).is_none());
    assert!(f.last_expansions <= MAX_EXPANSIONS + 1);
    let near = g.index(MAX_PATH_LEN as i32 - 1, 5).unwrap();
    let p = f
        .find(&g, &load, a, near)
        .expect("a path of the maximum length");
    assert_eq!(p.len(), MAX_PATH_LEN);
}

#[test]
fn paths_are_valid_on_the_graph() {
    let s = haight(false);
    let g = RoadGraph::scan(&s);
    let load = vec![0u8; g.class_len()];
    let mut f = PathFinder::default();
    let mut found = 0;
    for r in g.residential.iter().take(20) {
        for j in g.jobs.iter().take(20) {
            let (a, b) = (
                g.zones[*r as usize].access.unwrap(),
                g.zones[*j as usize].access.unwrap(),
            );
            if let Some(p) = f.find(&g, &load, a, b) {
                found += 1;
                assert_eq!((p[0], *p.last().unwrap()), (a, b));
                assert!(p
                    .windows(2)
                    .all(|w| g.road_neighbours(w[0]).contains(&Some(w[1]))));
            }
        }
    }
    assert!(found > 0);
}

#[test]
fn measured_load_replaces_the_density_map() {
    let mut s = haight(true);
    run(&mut s, 400);
    let load = s.agent_traffic_load();
    assert!(load.iter().any(|&l| l > 0));
    let (w, h) = s.world_size();
    // each density block is the strongest road load it holds
    let bs = s.traffic_density_map.block_size();
    for x in (0..w).step_by(bs as usize) {
        for y in (0..h).step_by(bs as usize) {
            let mut best = 0u8;
            for dx in 0..bs {
                for dy in 0..bs {
                    if x + dx < w && y + dy < h {
                        best = best.max(load[((x + dx) * h + y + dy) as usize]);
                    }
                }
            }
            let d = s.traffic_density_map.world_get(x, y);
            // the map is rewritten each tick, then decayed once per cycle (the hook keeps it)
            assert_eq!(d, best, "block ({x},{y})");
        }
    }
}

#[test]
fn a_cut_road_removes_the_cars_that_needed_it() {
    let mut s = haight(true);
    run(&mut s, 300);
    let before = s.agent_counters().abandoned;
    let (w, h) = s.world_size();
    for x in 0..w {
        for y in 0..h {
            let t = s.tiles[(x * h + y) as usize];
            if (64..208).contains(&(t & 0x3ff)) {
                s.set_tile(x, y, 0);
            }
        }
    }
    run(&mut s, REFRESH_INTERVAL as usize + 1);
    let c = s.agent_counters();
    assert!(c.abandoned > before);
    assert_eq!(
        c.spawned,
        s.agent_stats()[0] as u64 + c.parked as u64 + c.round_trips + c.abandoned
    );
    assert_eq!(c.parked, 0, "parked cars lost their zones' roads too");
    assert_eq!(s.agent_stats()[0], 0);
    // a tile that is no longer a road reports no load (the 2D layer would tint it)
    let g = RoadGraph::scan(&s);
    for (t, &l) in s.agent_traffic_load().iter().enumerate() {
        assert!(l == 0 || g.is_road(t as u32), "tile {t} kept load {l}");
    }
}

#[test]
fn rail_crossings_are_roads() {
    use micropolis_core::agents::graph::{classify, CLASS_ROAD};
    use micropolis_core::tile::{HRAILROAD, VRAILROAD};
    assert_eq!(classify(HRAILROAD), CLASS_ROAD);
    assert_eq!(classify(VRAILROAD), CLASS_ROAD);
}

#[test]
fn a_low_density_neighbourhood_is_a_home_with_its_houses_as_residents() {
    use micropolis_core::agents::graph::{classify, CLASS_RES};
    use micropolis_core::tile::{FREEZ, LHTHR, ROADBASE, ZONEBIT};
    assert_eq!(classify(FREEZ | ZONEBIT), CLASS_RES);
    // a FREEZ centre with two houses and a road on its ring
    let mut s = Simulation::new(20, 20);
    s.set_tile(10, 10, FREEZ | ZONEBIT);
    s.set_tile(9, 9, LHTHR);
    s.set_tile(11, 11, LHTHR);
    s.set_tile(10, 12, ROADBASE + 1);
    let g = RoadGraph::scan(&s);
    assert_eq!(g.residential.len(), 1);
    assert_eq!(g.zones[g.residential[0] as usize].pop, 2);
}

#[test]
fn a_new_city_starts_a_new_fleet() {
    use micropolis_core::simulation::GameLevel;
    let mut s = haight(true);
    run(&mut s, 300);
    assert!(s.agent_stats()[0] > 0);
    s.new_city(GameLevel::Easy, 7);
    assert!(
        s.agent_rules(),
        "the switch stays as it was, like the other rules"
    );
    assert_eq!(s.agent_stats(), [0; 5], "nothing from the old city");
    assert!(s.agent_vehicles(10).is_empty());
}

#[test]
fn a_fleet_left_by_a_direct_write_is_not_reported() {
    let mut s = haight(true);
    run(&mut s, 300);
    assert!(s.agent_stats()[0] > 0);
    s.extensions_mut().agents = false;
    assert_eq!(s.agent_stats(), [0; 5]);
    assert!(s.agent_vehicles(10).is_empty());
    assert!(s.agent_traffic_load().iter().all(|&l| l == 0));
    assert_eq!(s.agent_fingerprint(), 0);
}

#[test]
fn only_the_switch_is_saved() {
    let off = haight(false);
    let plain = file_of(&off);
    let mut on = haight(true);
    run(&mut on, 200);
    let bytes = on.save_city();
    assert_ne!(bytes, plain);
    let mut back = Simulation::with_default_size();
    back.load_city(&bytes, 1).unwrap();
    assert!(back.agent_rules());
    assert_eq!(back.agent_stats()[0], 0, "cars restart from the city");
    // switching off gives the file of today again
    on.set_agent_rules(false);
    assert_eq!(on.agent_stats(), [0; 5]);
}

#[test]
fn a_file_with_the_rule_off_is_unchanged() {
    let mut s = haight(true);
    s.set_agent_rules(false);
    assert_eq!(file_of(&s), file_of(&haight(false)));
}

#[test]
#[ignore = "measurement: cargo test --release -p micropolis-core --test agents_rules -- --ignored --nocapture"]
fn cost_of_a_tick() {
    let time = |agents: bool| {
        let mut s = haight(agents);
        run(&mut s, 500);
        let t = std::time::Instant::now();
        run(&mut s, 3000);
        let ms = t.elapsed().as_secs_f64() * 1000.0 / 3000.0;
        (ms, s.agent_stats(), s.agent_counters())
    };
    let (off, ..) = time(false);
    let (on, st, c) = time(true);
    println!("ms/tick off {off:.4} on {on:.4} stats {st:?}");
    println!(
        "parked {} returning {} round trips {} max present {}",
        c.parked, c.returning, c.round_trips, c.max_present
    );
}
