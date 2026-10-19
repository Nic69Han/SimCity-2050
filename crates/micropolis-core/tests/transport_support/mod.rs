//! A hand-built town for the bus and taxi tests: a road along `ROAD_Y`, residential zones north
//! of it (centres `(HOME_X + 4 i, ROAD_Y - 2)`), one job zone at the east end, and helpers to put
//! stops and depots next to the road.

#![allow(dead_code)]

use micropolis_core::agents::transport::{BUS_FARE, TAXI_FARE_PER_TILE};
use micropolis_core::simulation::Simulation;
use micropolis_core::structures::{GENRE_BUS_DEPOT, GENRE_BUS_STOP, GENRE_TAXI_DEPOT};
use micropolis_core::tile::{COMBASE, ROADBASE, RZB, ZONEBIT};
use micropolis_core::tool::ToolResult;

pub const ROAD_Y: i32 = 12;
pub const HOME_X: i32 = 5;
pub const WIDTH: i32 = 64;
pub const JOB_X: i32 = 56;
pub const MONEY: i64 = 5_000_000;

/// The map with `homes` residential zones of density 3 and one job zone; both rules on.
pub fn town(homes: i32) -> Simulation {
    let mut s = Simulation::new(WIDTH, 24);
    for x in 2..WIDTH - 2 {
        s.set_tile(x, ROAD_Y, ROADBASE);
    }
    for i in 0..homes {
        s.set_tile(HOME_X + 4 * i, ROAD_Y - 2, (RZB + 27) | ZONEBIT);
    }
    s.set_tile(JOB_X, ROAD_Y - 2, COMBASE | ZONEBIT);
    s.total_funds = MONEY;
    s.set_structure_rules(true);
    s.set_agent_rules(true);
    s
}

/// Puts a building of `genre` at `(x, y)`, which must succeed.
pub fn put(s: &mut Simulation, genre: u8, x: i32, y: i32) {
    assert_eq!(
        s.place_structure(genre, x, y),
        ToolResult::Ok,
        "{genre} at {x},{y}"
    );
}

/// A stop within walking distance of the first home and one of the job zone, a bus depot and
/// (when `taxi`) a taxi depot between them, all south of the road.
pub fn with_buses(s: &mut Simulation) {
    put(s, GENRE_BUS_STOP, HOME_X + 3, ROAD_Y + 1);
    put(s, GENRE_BUS_STOP, JOB_X - 3, ROAD_Y + 1);
    put(s, GENRE_BUS_DEPOT, 28, ROAD_Y + 1);
}

pub fn with_taxis(s: &mut Simulation) {
    put(s, GENRE_TAXI_DEPOT, 32, ROAD_Y + 1);
}

pub fn ticks(s: &mut Simulation, n: usize) {
    for _ in 0..n {
        s.ext_agents_tick();
    }
}

/// The fare of a taxi ride of `tiles` tiles and of a bus ride.
pub fn taxi_fare(tiles: i32) -> i32 {
    TAXI_FARE_PER_TILE * tiles
}

pub fn bus_fare() -> i32 {
    BUS_FARE
}
