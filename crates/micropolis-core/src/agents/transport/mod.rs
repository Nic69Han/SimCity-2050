//! Buses and taxis (docs/game-design-v05.md), on top of the simulated cars. Active only while
//! both rules are on: the simulated cars (`agents`) and the extended buildings (`structures`),
//! whose bus stops (genre 10), bus depots (11) and taxi depots (12) it reads.
//!
//! * [`net`]: the stops and depots, each with its road. * [`route`]: the bus loops.
//! * [`bus`], [`taxi`]: the vehicles. * [`riders`]: the riders and the counters.
//! * `demand`: creates riders and dispatches taxis. * `step`: one tick.
//!
//! Residents without a car (the residents of a zone minus the motorised ones) make trips from
//! their home zone to a job zone. With a stop within [`WALK_RADIUS`] tiles of the home and of
//! the job, served by a common bus loop, the rider waits at the home stop and a bus carries
//! him to the stop near the job; otherwise, if there is a taxi depot, he calls a taxi. Fares go
//! into the monthly balance. Everything is bounded by named constants and uses an own random
//! generator, so cars behave the same with or without buses. When the network (stops, depots,
//! roads) changes, the routes are rebuilt, the vehicles on the road are withdrawn and their
//! riders count as abandoned; riders waiting at a stop that still exists keep waiting.

mod api;
mod bus;
mod demand;
pub mod net;
pub mod riders;
pub mod route;
mod step;
pub mod taxi;

#[cfg(test)]
mod tests;

pub use crate::structures::{GENRE_BUS_DEPOT, GENRE_BUS_STOP, GENRE_TAXI_DEPOT};
pub use bus::Bus;
pub use riders::{Audit, Rider, TransportCounters};
pub use taxi::Taxi;

use super::graph::RoadGraph;
use super::path::PathFinder;
use super::rng::AgentRng;
use super::MOTORISED_PCT;
use crate::simulation::Simulation;
use net::Net;
use route::Route;

/// Tiles from a zone centre within which a stop can be walked to.
pub const WALK_RADIUS: i32 = 6;
/// Buses of one depot on the road at once.
pub const MAX_BUSES_PER_DEPOT: usize = 3;
/// Taxis of one depot on the road at once.
pub const MAX_TAXIS_PER_DEPOT: usize = 3;
/// Riders in a bus.
pub const BUS_CAPACITY: usize = 12;
/// Riders waiting at one stop.
pub const MAX_WAITING_PER_STOP: usize = 24;
/// Riders in the whole city (waiting and on board).
pub const MAX_RIDERS: usize = 512;
/// Riders waiting for a taxi in the whole city.
pub const MAX_TAXI_REQUESTS: usize = 64;
/// Stops on one bus loop.
pub const MAX_ROUTE_STOPS: usize = 24;
/// Stops tried by the tour of one loop (some may have no road path).
pub const MAX_ROUTE_SEARCHES: usize = 2 * MAX_ROUTE_STOPS;
/// Path searches of the taxi dispatcher in one tick (one taxi, three legs).
pub const MAX_TRANSPORT_SEARCHES_PER_TICK: usize = 3;
/// New riders started per tick (attempts).
pub const RIDER_SPAWNS_PER_TICK: usize = 1;
/// Ticks a bus waits for the next one of its depot to leave.
pub const BUS_SPAWN_INTERVAL: u64 = 40;
/// Ticks a bus stands at a stop.
pub const BUS_DWELL_TICKS: u32 = 4;
/// Ticks a rider waits (at a stop or for a taxi) before giving up.
pub const MAX_WAIT_TICKS: u64 = 1200;
/// Taxi dispatches without a path before the rider gives up.
pub const MAX_TAXI_FAILURES: u32 = 3;
/// Non-motorised residents per rider a zone may have in the system at once.
pub const RESIDENTS_PER_RIDER: i32 = 2;
/// Dollars paid by a bus rider on arrival.
pub const BUS_FARE: i32 = 3;
/// Dollars paid per tile driven with a rider in a taxi.
pub const TAXI_FARE_PER_TILE: i32 = 2;
/// Identifier of the first bus or taxi; cars count up from 1, so the two never meet.
pub const VEHICLE_ID_BASE: u32 = 1 << 30;

/// Riders a zone of `pop` residents may have in the system at once: a share of its residents
/// without a car, none if there are none.
pub fn zone_rider_cap(pop: i32) -> usize {
    let walkers = pop - pop * MOTORISED_PCT / 100;
    if walkers <= 0 {
        return 0;
    }
    (walkers / RESIDENTS_PER_RIDER).max(1) as usize
}

/// The state of the buses and taxis of one city.
#[derive(Debug, Clone)]
pub struct Transport {
    pub net: Net,
    /// The road tiles the routes were built on.
    roads: Vec<u32>,
    /// One loop per bus depot of the net (`None`: no stop can be reached).
    pub routes: Vec<Option<Route>>,
    /// Riders waiting at each stop of the net, longest wait first.
    pub queues: Vec<Vec<Rider>>,
    /// Riders waiting for a taxi, longest wait first.
    pub requests: Vec<Rider>,
    pub buses: Vec<Bus>,
    pub taxis: Vec<Taxi>,
    /// Transport tick from which each bus depot may send its next bus.
    next_spawn: Vec<u64>,
    rng: AgentRng,
    next_vehicle: u32,
    next_rider: u32,
    pub counters: TransportCounters,
}

impl Transport {
    pub fn new(seed: u64, time: u64) -> Transport {
        Transport {
            net: Net::default(),
            roads: Vec::new(),
            routes: Vec::new(),
            queues: Vec::new(),
            requests: Vec::new(),
            buses: Vec::new(),
            taxis: Vec::new(),
            next_spawn: Vec::new(),
            rng: AgentRng::seeded(seed, time, 0x5452_414E),
            next_vehicle: VEHICLE_ID_BASE,
            next_rider: 1,
            counters: TransportCounters::default(),
        }
    }

    /// Reads the stops and depots of `sim`; rebuilds the routes if they, or the roads, changed.
    pub fn refresh(
        &mut self,
        sim: &Simulation,
        g: &RoadGraph,
        finder: &mut PathFinder,
        load: &[u8],
        now: u64,
    ) {
        let net = Net::build(sim, g);
        if net == self.net && g.roads == self.roads {
            return;
        }
        // waiting riders stay at the stops that remain
        let mut old: Vec<(u32, Vec<Rider>)> = self
            .net
            .stops
            .iter()
            .map(|s| s.id)
            .zip(std::mem::take(&mut self.queues))
            .collect();
        self.queues = net
            .stops
            .iter()
            .map(|s| match old.iter().position(|(id, _)| *id == s.id) {
                Some(p) => old.swap_remove(p).1,
                None => Vec::new(),
            })
            .collect();
        let c = &mut self.counters;
        c.abandoned += old.iter().map(|(_, q)| q.len() as u64).sum::<u64>();
        c.abandoned += self
            .buses
            .drain(..)
            .map(|b| b.riders.len() as u64)
            .sum::<u64>();
        c.abandoned += self.taxis.drain(..).filter(|t| t.rider.is_some()).count() as u64;
        c.rebuilds += 1;
        self.routes = net
            .bus_depots
            .iter()
            .map(|d| route::build(g, &net, d, finder, load))
            .collect();
        self.next_spawn = vec![now; net.bus_depots.len()];
        self.roads = g.roads.clone();
        self.net = net;
    }

    /// Where the riders are, counted from the containers (the conservation law's two sides).
    pub fn audit(&self) -> Audit {
        let (fetching, riding) = self.taxis.iter().fold((0, 0), |(f, r), t| {
            (
                f + usize::from(t.is_fetching()),
                r + usize::from(t.picked && t.rider.is_some()),
            )
        });
        let queued: usize = self.queues.iter().map(Vec::len).sum();
        let waiting = queued + self.requests.len() + fetching;
        let on_board = self.buses.iter().map(|b| b.riders.len()).sum::<usize>() + riding;
        let c = &self.counters;
        Audit {
            waiting,
            on_board,
            arrived: c.arrived,
            abandoned: c.abandoned,
            created: c.created,
        }
    }

    /// `[buses, taxis, waiting, bus_trips_month, taxi_rides_month, income_month]`.
    pub fn stats(&self) -> [i32; 6] {
        let c = &self.counters;
        [
            self.buses.len() as i32,
            self.taxis.len() as i32,
            self.audit().waiting as i32,
            c.month_bus_trips,
            c.month_taxi_rides,
            c.month_income,
        ]
    }

    /// The buses then the taxis as `[id, kind, x16, y16, direction]` (kind 1 bus, 2 taxi).
    pub fn vehicles(&self, g: &RoadGraph) -> Vec<[i32; 5]> {
        let buses = self.buses.iter().filter_map(|b| {
            let r = self.routes.get(b.route)?.as_ref()?;
            Some(super::vehicle_record(
                g,
                b.id,
                1,
                b.tile(r),
                b.next_tile(r),
                b.progress,
            ))
        });
        let taxis = self.taxis.iter().filter(|t| !t.arrived()).map(|t| {
            let next = t.path[t.at + 1];
            super::vehicle_record(g, t.id, 2, t.tile(), next, t.progress)
        });
        buses.chain(taxis).collect()
    }

    /// The tiles the buses and taxis stand on (they load the road like cars).
    pub fn tiles(&self) -> impl Iterator<Item = u32> + Clone + '_ {
        let buses = self.buses.iter().filter_map(|b| {
            let r = self.routes.get(b.route)?.as_ref()?;
            Some(b.tile(r))
        });
        buses.chain(self.taxis.iter().map(Taxi::tile))
    }

    /// Feeds the riders, the vehicles and the counters to `mix` (determinism tests).
    pub fn fingerprint(&self, mix: &mut impl FnMut(u64)) {
        let c = &self.counters;
        for v in [c.created, c.arrived, c.abandoned, c.refused, c.rebuilds] {
            mix(v);
        }
        let mut riders = |rs: &[Rider]| {
            for r in rs {
                for v in [r.id, r.home, r.job, r.stop, r.failed] {
                    mix(u64::from(v));
                }
                mix(r.born);
            }
        };
        self.queues.iter().for_each(|q| riders(q));
        riders(&self.requests);
        for b in &self.buses {
            riders(&b.riders);
        }
        for t in &self.taxis {
            riders(t.rider.as_slice());
        }
        for b in &self.buses {
            for v in [
                b.id,
                b.depot,
                b.route as u32,
                b.at as u32,
                b.progress,
                b.dwell,
            ] {
                mix(u64::from(v));
            }
        }
        for t in &self.taxis {
            for v in [t.id, t.depot, t.at as u32, t.progress, u32::from(t.picked)] {
                mix(u64::from(v));
            }
        }
    }
}
