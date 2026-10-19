//! Simulated cars (docs/ia-simulation.md, stage A; docs/game-design-v03.md), behind the switch
//! `Extensions::agents`, off by default. Off, nothing here runs and the engine is the original.
//!
//! * [`graph`]: the road graph and the zones read from the map, rebuilt only when it changes.
//! * [`path`]: bounded A*. * [`vehicles`]: the cars. * [`load`]: the measured load per tile.
//! * [`rng`]: the agents' own generator, seeded from the city, never the simulation's.
//!
//! * [`run`]: the running fleet. * [`trips`]: departures, returns and arrivals.
//!
//! One step per simulated phase (`Simulation::ext_agents_tick`): refresh the graph every
//! [`REFRESH_INTERVAL`] ticks, start at most [`MAX_PATH_SEARCHES_PER_TICK`] searches (return
//! trips of parked cars first, then new trips from residential zones to job zones), move every
//! car, then measure the load. A car that reaches its job parks for [`WORK_TICKS`] ticks, then
//! drives home. Cars are not saved: a loaded city starts a new fleet from the map.

pub mod graph;
pub mod load;
pub mod path;
pub mod rng;
mod run;
mod trips;
pub mod vehicles;

#[cfg(test)]
mod trips_tests;

use crate::simulation::Simulation;
use run::Run;
use vehicles::Leg;

/// Most cars at once, driving and parked together.
pub const MAX_VEHICLES: usize = 1024;
/// Most path searches started in one tick.
pub const MAX_PATH_SEARCHES_PER_TICK: usize = 2;
/// Job zones looked at per trip; the nearest is the destination.
pub const DEST_SAMPLES: u32 = 3;
/// Ticks between two looks at the map for changes.
pub const REFRESH_INTERVAL: u64 = 16;
/// Fleet ticks a car stays parked at its job zone before driving home.
pub const WORK_TICKS: u64 = 120;
/// Return searches that may find no path before the parked car is counted abandoned.
pub const MAX_RETURN_FAILURES: u32 = 8;
/// Percent of the residents of a zone who own a car.
pub const MOTORISED_PCT: i32 = 60;
/// Motorised residents per car a zone may have out at once (driving or parked).
pub const RESIDENTS_PER_CAR: i32 = 4;

/// What the fleet has done so far (tests and the stats read it).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counters {
    /// Round trips begun (cars created).
    pub spawned: u64,
    /// Legs arrived, outward and return alike.
    pub finished: u64,
    /// Round trips completed: the car came home and disappeared.
    pub round_trips: u64,
    /// Cars removed: road, home or job zone gone, or too many failed return searches.
    pub abandoned: u64,
    pub trip_ticks: u64,
    pub failed_searches: u64,
    pub searches_in_last_tick: usize,
    pub max_searches_in_tick: usize,
    pub max_expansions: usize,
    pub max_path_len: usize,
    /// Most cars driving at once.
    pub max_cars: usize,
    /// Most parked cars at once.
    pub max_parked: usize,
    /// Most cars driving plus parked at once (bounded by [`MAX_VEHICLES`]).
    pub max_present: usize,
    /// Cars parked now (a snapshot, not a total).
    pub parked: usize,
    /// Cars driving home now (a snapshot).
    pub returning: usize,
}

/// The cars of a city. Runtime state: it takes no part in comparing two [`Extensions`]
/// (`PartialEq` is always true) and is not saved.
///
/// [`Extensions`]: crate::extensions::Extensions
#[derive(Debug, Clone, Default)]
pub struct Fleet {
    run: Option<Box<Run>>,
}

impl PartialEq for Fleet {
    fn eq(&self, _: &Fleet) -> bool {
        true
    }
}
impl Eq for Fleet {}

/// Cars a zone of `pop` residents may have out (driving or parked) at once.
pub fn zone_car_cap(pop: i32) -> usize {
    (pop * MOTORISED_PCT / 100 / RESIDENTS_PER_CAR).max(1) as usize
}

impl Simulation {
    /// Whether the simulated cars are on.
    pub fn agent_rules(&self) -> bool {
        self.extensions().agents
    }

    /// Turns the cars on or off. Off drops the fleet (free of charge); on starts it from the
    /// map at the next tick.
    pub fn set_agent_rules(&mut self, on: bool) {
        let ext = self.extensions_mut();
        ext.agents = on;
        if !on {
            ext.fleet = Fleet::default();
        }
    }

    /// The running fleet, only while the rule is on (a fleet left behind by a direct write to
    /// `Extensions::agents` is never reported).
    fn agent_run(&self) -> Option<&Run> {
        let ext = self.extensions();
        if !ext.agents {
            return None;
        }
        ext.fleet.run.as_deref()
    }

    /// `[active_cars, finished_trips, mean_trip_ticks, saturated_tiles, motorised_residents]`.
    pub fn agent_stats(&self) -> [i32; 5] {
        let Some(r) = self.agent_run() else {
            return [0; 5];
        };
        let c = &r.counters;
        let mean = c.trip_ticks.checked_div(c.finished).unwrap_or(0);
        let clamp = |v: u64| v.min(i32::MAX as u64) as i32;
        [
            r.cars.len() as i32,
            clamp(c.finished),
            clamp(mean),
            r.load.saturated,
            r.motorised,
        ]
    }

    /// At most `max` cars as `[id, kind, x16, y16, direction]` (centre of the car in sixteenths of
    /// a tile from the top-left corner of the map; kind 0 = car; direction 0 N, 1 E, 2 S, 3 W).
    pub fn agent_vehicles(&self, max: usize) -> Vec<[i32; 5]> {
        self.agent_run()
            .map(|r| r.cars.iter().take(max).map(|c| r.vehicle(c)).collect())
            .unwrap_or_default()
    }

    /// Measured load (0..=255) of every tile, in tile order (`x * height + y`); zeros when the
    /// cars are off.
    pub fn agent_traffic_load(&self) -> Vec<u8> {
        match self.agent_run() {
            Some(r) => r.load.tile.clone(),
            None => vec![0; self.tiles.len()],
        }
    }

    /// What the fleet did so far (all zero while off).
    pub fn agent_counters(&self) -> Counters {
        self.agent_run()
            .map_or_else(Counters::default, |r| Counters {
                parked: r.parked.len(),
                returning: r.cars.iter().filter(|c| c.leg == Leg::Back).count(),
                ..r.counters
            })
    }

    /// A fingerprint of the cars, the load and the counters (determinism tests).
    pub fn agent_fingerprint(&self) -> u64 {
        self.agent_run().map_or(0, Run::fingerprint)
    }
}

/// One tick of the fleet (called by `Simulation::ext_agents_tick`).
pub(crate) fn tick(sim: &mut Simulation) {
    let mut fleet = std::mem::take(&mut sim.extensions.fleet);
    let (w, h) = sim.world_size();
    if fleet
        .run
        .as_ref()
        .is_none_or(|r| (r.graph.w, r.graph.h) != (w, h))
    {
        fleet.run = Some(Box::new(Run::new(sim)));
    }
    if let Some(run) = fleet.run.as_deref_mut() {
        run.step(sim);
        run.write_density(&mut sim.traffic_density_map);
    }
    sim.extensions.fleet = fleet;
}

/// Traffic density of block `(x, y)` while the cars are on: the measured load replaces `t`.
pub(crate) fn traffic(sim: &Simulation, x: i32, y: i32, t: i32) -> i32 {
    match sim.agent_run() {
        Some(r) => i32::from(r.load.block_load(x, y)),
        None => t,
    }
}
