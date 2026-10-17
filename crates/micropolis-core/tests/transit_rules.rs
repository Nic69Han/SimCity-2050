//! The metro rules (docs/game-design-v02.md, "Métro"): rule off = the original engine; rule on =
//! less traffic around linked stations; the network is saved and loaded with the city.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::simulation::Simulation;
use micropolis_core::tool::ToolResult;
use micropolis_core::transit::{LAND_BONUS, STATION, STATION_RADIUS, TUNNEL};
use support::{file_of, run, state, HAIGHT};

fn haight() -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(HAIGHT, 1).expect("the sample city");
    s
}

/// Haight-Ashbury after a warm-up that fills the traffic map.
fn warm() -> Simulation {
    let mut s = haight();
    run(&mut s, 300);
    s
}

/// World position of the busiest traffic block.
fn hotspot(s: &Simulation) -> (i32, i32) {
    let bs = s.traffic_density_map.block_size();
    let (w, h) = s.world_size();
    let mut best = (0, (w / 2, h / 2));
    for x in (0..w).step_by(bs as usize) {
        for y in (0..h).step_by(bs as usize) {
            let d = i32::from(s.traffic_density_map.world_get(x, y));
            if d > best.0 {
                best = (d, (x, y));
            }
        }
    }
    best.1
}

/// Sum of the traffic density of the blocks within the station radius of `(cx, cy)`.
fn traffic_around(s: &Simulation, cx: i32, cy: i32) -> i64 {
    let bs = s.traffic_density_map.block_size();
    let (w, h) = s.world_size();
    let mut sum = 0;
    for x in (0..w).step_by(bs as usize) {
        for y in (0..h).step_by(bs as usize) {
            let (dx, dy) = (x - cx, y - cy);
            if dx * dx + dy * dy <= STATION_RADIUS * STATION_RADIUS {
                sum += i64::from(s.traffic_density_map.world_get(x, y));
            }
        }
    }
    sum
}

/// Two stations 4 tiles apart joined by tunnels, on the row of `(cx, cy)`.
fn build_line(s: &mut Simulation, cx: i32, cy: i32) {
    let (w, _) = s.world_size();
    let x0 = (cx - 2).clamp(0, w - 5);
    for x in x0..=x0 + 4 {
        s.place_tunnel(x, cy);
    }
    assert_eq!(s.place_station(x0, cy), ToolResult::Ok);
    assert_eq!(s.place_station(x0 + 4, cy), ToolResult::Ok);
    assert_eq!(s.transit_stats().lines, 1);
}

#[test]
fn rule_off_a_network_changes_nothing() {
    let mut plain = warm();
    let mut dug = warm();
    // the network exists in the layer (as a loaded file could carry it) but the rule is off
    let (cx, cy) = hotspot(&dug);
    for x in cx - 2..=cx + 2 {
        dug.transit_mut().underground.set(x, cy, TUNNEL);
    }
    dug.transit_mut().underground.set(cx - 2, cy, STATION);
    dug.transit_mut().underground.set(cx + 2, cy, STATION);
    dug.transit_mut().refresh();
    assert_eq!(dug.transit_stats().lines, 1);
    assert!(!dug.transit_rules() && !dug.extensions_active());
    run(&mut plain, 600);
    run(&mut dug, 600);
    assert_eq!(state(&plain), state(&dug));
    assert_eq!(plain.rng.random16(), dug.rng.random16());
    assert_eq!(plain.traffic_density_map, dug.traffic_density_map);
    assert_eq!(plain.land_value_map, dug.land_value_map);
}

#[test]
fn rule_on_without_a_network_changes_nothing() {
    let mut off = warm();
    let mut on = warm();
    on.set_transit_rules(true);
    run(&mut off, 600);
    run(&mut on, 600);
    assert_eq!(state(&off), state(&on));
    assert_eq!(off.traffic_density_map, on.traffic_density_map);
    assert_eq!(off.land_value_map, on.land_value_map);
}

#[test]
fn two_linked_stations_lower_the_traffic_of_a_busy_district() {
    let reference = warm();
    let (cx, cy) = hotspot(&reference);
    assert!(
        i32::from(reference.traffic_density_map.world_get(cx, cy)) > 24,
        "the hotspot is busy"
    );
    let mut without = warm();
    let mut with = warm();
    with.set_transit_rules(true);
    build_line(&mut with, cx, cy);
    let (mut sum_without, mut sum_with) = (0, 0);
    for _ in 0..300 {
        run(&mut without, 1);
        run(&mut with, 1);
        sum_without += traffic_around(&without, cx, cy);
        sum_with += traffic_around(&with, cx, cy);
    }
    assert!(sum_without > 0);
    assert!(
        sum_with < sum_without,
        "traffic around the stations: {sum_with} with the metro, {sum_without} without"
    );
    // determinism: the same inputs give the same city
    let mut again = warm();
    again.set_transit_rules(true);
    build_line(&mut again, cx, cy);
    run(&mut again, 300);
    assert_eq!(state(&again), state(&with));
}

#[test]
fn the_land_value_rises_by_the_bonus_around_a_working_line_only() {
    let reference = warm();
    let (cx, cy) = hotspot(&reference);
    // the same city three times, only the network differs; one land value scan each
    let mut without = warm();
    let mut with = warm();
    with.set_transit_rules(true);
    build_line(&mut with, cx, cy);
    let mut lone = warm();
    lone.set_transit_rules(true);
    assert_eq!(lone.place_station(cx, cy), ToolResult::Ok);
    for city in [&mut without, &mut with, &mut lone] {
        city.pollution_terrain_land_value_scan();
    }
    let (w, h) = without.land_value_map.size();
    let mut raised = 0;
    for x in 0..w {
        for y in 0..h {
            let base = i32::from(without.land_value_map.get(x, y));
            assert_eq!(
                lone.land_value_map.get(x, y),
                without.land_value_map.get(x, y)
            );
            let got = i32::from(with.land_value_map.get(x, y));
            if base == 0 {
                assert_eq!(got, 0, "a tile without land value stays without");
            } else if with.transit().is_covered(2 * x, 2 * y) {
                assert_eq!(got, (base + LAND_BONUS).clamp(1, 250));
                raised += i32::from(got > base);
            } else {
                assert_eq!(got, base);
            }
        }
    }
    assert!(raised > 0, "some land value rose");
}

#[test]
fn the_network_is_saved_and_loaded_with_the_city() {
    let mut s = warm();
    s.set_transit_rules(true);
    let (cx, cy) = hotspot(&s);
    build_line(&mut s, cx, cy);
    let file = file_of(&s);
    let mut back = Simulation::with_default_size();
    back.load_city(&file, 1).expect("a file this crate wrote");
    assert!(back.transit_rules());
    assert_eq!(back.transit(), s.transit());
    assert_eq!(back.transit_stats(), s.transit_stats());
    assert_eq!(back.transit_stats().lines, 1);
    assert_eq!(
        back.transit().underground.get(cx.clamp(2, 115) - 2, cy),
        STATION
    );
    // saved and loaded again, the network is still the same
    let again = file_of(&back);
    let mut twice = Simulation::with_default_size();
    twice.load_city(&again, 1).expect("a file this crate wrote");
    assert_eq!(twice.transit(), s.transit());
}
