//! The metro and the choice of the mode, on the small hand-built towns of `tests`.

use super::tests::{town, Rig};
use super::*;
use crate::agents::transport::choice::{cheapest, price, ride_cost, trip_cost, Mode, Offer};
use crate::tool::ToolResult;

#[test]
fn the_trip_cost_is_walk_wait_ride_and_price() {
    use crate::agents::transport::choice::{WAIT_COST, WALK_COST};
    for mode in [Mode::Bus, Mode::Metro, Mode::Train, Mode::Taxi] {
        let want = WALK_COST * 3 + WAIT_COST + ride_cost(mode) * 10 + price(mode, 10);
        assert_eq!(trip_cost(mode, 3, 10), want);
    }
    assert_eq!(price(Mode::Train, 99), TRAIN_FARE);
    assert_eq!(price(Mode::Metro, 99), METRO_FARE);
    assert_eq!(
        price(Mode::Taxi, 10),
        10 * crate::agents::transport::TAXI_FARE_PER_TILE
    );
}

#[test]
fn the_cheapest_mode_wins_and_a_tie_goes_bus_metro_train_taxi() {
    let offer = |mode, cost| Offer {
        mode,
        cost,
        line: 0,
        from: 0,
        to: 0,
    };
    assert_eq!(cheapest(&[]), None);
    let all = [
        offer(Mode::Taxi, 50),
        offer(Mode::Train, 40),
        offer(Mode::Metro, 45),
        offer(Mode::Bus, 60),
    ];
    assert_eq!(cheapest(&all).unwrap().mode, Mode::Train);
    let tie = |a: Mode, b: Mode, c: Mode, d: Mode| {
        [offer(a, 30), offer(b, 30), offer(c, 30), offer(d, 30)]
    };
    let orders = [
        tie(Mode::Taxi, Mode::Train, Mode::Metro, Mode::Bus),
        tie(Mode::Train, Mode::Bus, Mode::Taxi, Mode::Metro),
        tie(Mode::Metro, Mode::Taxi, Mode::Bus, Mode::Train),
    ];
    for o in orders {
        assert_eq!(cheapest(&o).unwrap().mode, Mode::Bus);
    }
    let no_bus = [
        offer(Mode::Taxi, 30),
        offer(Mode::Train, 30),
        offer(Mode::Metro, 30),
    ];
    assert_eq!(cheapest(&no_bus).unwrap().mode, Mode::Metro);
    let rail = [offer(Mode::Taxi, 30), offer(Mode::Train, 30)];
    assert_eq!(cheapest(&rail).unwrap().mode, Mode::Train);
}

/// A tunnel row with a station every `gap` tiles from x = 0, on a 70 x 24 map.
fn metro_town(stations: i32, gap: i32) -> Simulation {
    let mut s = town(12..13);
    s.set_transit_rules(true);
    let y = 3;
    for x in 0..=(stations - 1) * gap {
        s.place_tunnel(x, y);
    }
    for i in 0..stations {
        assert_eq!(s.place_station(i * gap, y), ToolResult::Ok);
    }
    s
}

#[test]
fn a_working_metro_line_gets_a_line_of_its_stations_only_with_the_transit_rule() {
    let mut s = metro_town(2, 4);
    let rig = Rig::new(&s);
    let l = &rig.t.rail.lines[0];
    assert_eq!(
        (l.kind, l.stops.len(), l.path.len()),
        (LineKind::Metro, 2, 5)
    );
    assert_eq!(rig.t.rail.line_count(LineKind::Metro), 1);
    s.set_transit_rules(false);
    assert!(Rig::new(&s).t.rail.lines.is_empty());
}

#[test]
fn a_tunnel_without_two_stations_is_no_line() {
    let mut s = town(12..13);
    s.set_transit_rules(true);
    for x in 0..5 {
        s.place_tunnel(x, 3);
    }
    s.place_station(0, 3);
    assert!(Rig::new(&s).t.rail.lines.is_empty());
}

#[test]
fn metro_cars_per_line_and_riders_per_car_are_capped() {
    let sim = metro_town(2, 4);
    let mut rig = Rig::new(&sim);
    rig.step(1);
    let (mut most, mut fullest) = (0, 0);
    for _ in 0..80 {
        rig.crowd(40, 0, 1);
        rig.step(10);
        most = most.max(rig.t.rail.count(LineKind::Metro));
        fullest = fullest.max(
            rig.t
                .rail
                .shuttles
                .iter()
                .map(|s| s.riders.len())
                .max()
                .unwrap_or(0),
        );
        assert!(rig.t.rail.count(LineKind::Metro) <= MAX_RAMES_PER_LINE);
    }
    assert_eq!((most, fullest), (MAX_RAMES_PER_LINE, METRO_CAPACITY));
    let c = &rig.t.counters;
    assert_eq!(c.metro_trips, c.arrived);
    assert_eq!(
        i64::from(c.month_rail_income),
        c.metro_trips as i64 * i64::from(METRO_FARE)
    );
    let kinds: Vec<i32> = rig.t.rail.vehicles(&rig.g).iter().map(|v| v[1]).collect();
    assert!(kinds.iter().all(|&k| k == 4));
}

#[test]
fn a_metro_line_has_at_most_max_line_stops_and_the_rest_start_another_line() {
    let sim = metro_town(MAX_LINE_STOPS as i32 + 8, 2);
    let rig = Rig::new(&sim);
    let lines = &rig.t.rail.lines;
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].stops.len(), MAX_LINE_STOPS);
    assert_eq!(lines[1].stops.len(), 8);
    assert!(lines.iter().all(|l| l.path.len() <= MAX_LINE_PATH_LEN));
}

#[test]
fn at_most_max_metro_lines_exist() {
    let mut s = town(12..13);
    s.set_transit_rules(true);
    // MAX_METRO_LINES + 2 separate pairs of stations, one row of tunnels each
    for row in 0..(MAX_METRO_LINES as i32 + 2) {
        let y = 1 + row;
        for x in 0..=4 {
            s.place_tunnel(x, y);
        }
        s.place_station(0, y);
        s.place_station(4, y);
    }
    let rig = Rig::new(&s);
    assert!(rig.t.rail.line_count(LineKind::Metro) <= MAX_METRO_LINES);
    assert!(rig.t.rail.line_count(LineKind::Metro) >= 1);
}
