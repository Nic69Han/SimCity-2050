//! One tick of the transport: riders appear and give up, a taxi may leave, buses leave their
//! depots, every vehicle moves and serves its stops.

use super::taxi::Event;
use super::{Bus, Transport};
use super::{BUS_SPAWN_INTERVAL, MAX_BUSES_PER_DEPOT, RIDER_SPAWNS_PER_TICK, TAXI_FARE_PER_TILE};
use crate::agents::graph::RoadGraph;
use crate::agents::path::PathFinder;

impl Transport {
    /// Advances the transport one tick at transport time `now` over the roads of `g`, whose
    /// measured load is `load`.
    pub fn step(&mut self, g: &RoadGraph, finder: &mut PathFinder, load: &[u8], now: u64) {
        self.counters.searches_in_last_tick = 0;
        self.expire(now);
        for _ in 0..RIDER_SPAWNS_PER_TICK {
            self.try_rider(g, now);
        }
        self.dispatch_taxi(g, finder, load);
        self.spawn_buses(now);
        self.drive_buses(load);
        self.drive_taxis(load);
        let c = &mut self.counters;
        c.max_searches_in_tick = c.max_searches_in_tick.max(c.searches_in_last_tick);
    }

    /// Each depot with a route sends a bus every [`BUS_SPAWN_INTERVAL`] ticks, up to
    /// [`MAX_BUSES_PER_DEPOT`] on the road.
    fn spawn_buses(&mut self, now: u64) {
        let Transport {
            net,
            routes,
            queues,
            buses,
            next_spawn,
            counters,
            next_vehicle,
            ..
        } = self;
        for (d, depot) in net.bus_depots.iter().enumerate() {
            let Some(route) = &routes[d] else { continue };
            let out = buses.iter().filter(|b| b.depot == depot.id).count();
            if now < next_spawn[d] || out >= MAX_BUSES_PER_DEPOT {
                continue;
            }
            let mut bus = Bus::new(*next_vehicle, depot.id, d);
            *next_vehicle += 1;
            bus.serve(route, net, queues, counters);
            buses.push(bus);
            next_spawn[d] = now + BUS_SPAWN_INTERVAL;
        }
    }

    fn drive_buses(&mut self, load: &[u8]) {
        let Transport {
            net,
            routes,
            queues,
            buses,
            counters,
            ..
        } = self;
        for b in buses.iter_mut() {
            let Some(route) = &routes[b.route] else {
                continue;
            };
            if b.advance(route, load[b.tile(route) as usize]) {
                b.serve(route, net, queues, counters);
            }
        }
    }

    fn drive_taxis(&mut self, load: &[u8]) {
        let counters = &mut self.counters;
        for t in self.taxis.iter_mut() {
            if !t.advance(load[t.tile() as usize]) {
                continue;
            }
            if let Some(Event::DroppedOff(tiles)) = t.event() {
                t.rider = None;
                counters.taxi_arrival(TAXI_FARE_PER_TILE.saturating_mul(tiles));
            }
        }
        self.taxis.retain(|t| !t.arrived());
    }
}
