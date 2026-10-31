//! The running fleet of one city: the graph, the cars on the road, the parked cars, the load,
//! the generator and the counters; one [`Run::step`] per simulated phase.

use super::graph::{RoadGraph, CLASS_RES};
use super::load::LoadMap;
use super::path::PathFinder;
use super::rng::AgentRng;
use super::transport::Transport;
use super::trips::land;
use super::vehicle_record;
use super::vehicles::{Car, Parked};
use super::{Counters, MOTORISED_PCT, REFRESH_INTERVAL};
use crate::highways::HIGHWAY_SPEED_MUL;
use crate::map::Map;
use crate::simulation::Simulation;

#[derive(Debug, Clone)]
pub(super) struct Run {
    pub graph: RoadGraph,
    /// Cars on the road.
    pub cars: Vec<Car>,
    /// Cars parked at their job zone (not on the road, no load).
    pub parked: Vec<Parked>,
    pub load: LoadMap,
    pub finder: PathFinder,
    pub rng: AgentRng,
    pub ticks: u64,
    pub next_id: u32,
    pub motorised: i32,
    pub counters: Counters,
    /// Buses and taxis, while the structures rule is on too.
    pub transport: Option<Box<Transport>>,
}

/// Whether tile `tile` is still a zone of the wanted side (`home`: residential, else a job zone)
/// with an access road.
fn zone_still(g: &RoadGraph, tile: u32, home: bool) -> bool {
    g.zone_at(tile).is_some_and(|z| {
        let z = &g.zones[z];
        z.access.is_some() && (z.kind == CLASS_RES) == home
    })
}

fn zones_still(g: &RoadGraph, home: u32, job: u32) -> bool {
    zone_still(g, home, true) && zone_still(g, job, false)
}

impl Run {
    pub fn new(sim: &Simulation) -> Run {
        let graph = RoadGraph::scan(sim);
        let map = &sim.traffic_density_map;
        let (bw, bh) = map.size();
        let tiles = graph.class_len();
        let seed = (graph.w as u64) << 32 | graph.h as u64;
        let mut run = Run {
            rng: AgentRng::seeded(seed, sim.city_time as u64, tiles as u64),
            load: LoadMap::new(tiles, map.block_size(), bw, bh),
            graph,
            cars: Vec::new(),
            parked: Vec::new(),
            finder: PathFinder::default(),
            ticks: 0,
            next_id: 1,
            motorised: 0,
            counters: Counters::default(),
            transport: None,
        };
        run.motorised = run.count_motorised();
        run
    }

    fn count_motorised(&self) -> i32 {
        let pop: i32 = self.graph.zones.iter().map(|z| z.pop).sum();
        pop * MOTORISED_PCT / 100
    }

    pub fn step(&mut self, sim: &Simulation) {
        self.ticks += 1;
        if self.ticks.is_multiple_of(REFRESH_INTERVAL) {
            self.refresh(sim);
        }
        self.sync_transport(sim);
        self.plan();
        self.drive();
        if let Some(t) = self.transport.as_deref_mut() {
            t.step(&self.graph, &mut self.finder, &self.load.tile, self.ticks);
        }
        let tiles = self.cars.iter().map(Car::tile);
        let others = self.transport.iter().flat_map(|t| t.tiles());
        self.load.update(&self.graph, tiles.chain(others));
        let c = &mut self.counters;
        c.max_cars = c.max_cars.max(self.cars.len());
        c.max_present = c.max_present.max(self.cars.len() + self.parked.len());
        c.max_parked = c.max_parked.max(self.parked.len());
    }

    /// Starts the transport when the structures rule is on (dropping it when off) and reads the
    /// stops and depots at the start and every [`REFRESH_INTERVAL`] ticks.
    fn sync_transport(&mut self, sim: &Simulation) {
        if !sim.structure_rules() {
            self.transport = None;
            return;
        }
        if self.transport.is_some() && !self.ticks.is_multiple_of(REFRESH_INTERVAL) {
            return;
        }
        let seed = (self.graph.w as u64) << 32 | self.graph.h as u64;
        let t = self
            .transport
            .get_or_insert_with(|| Box::new(Transport::new(seed, sim.city_time as u64)));
        t.refresh(
            sim,
            &self.graph,
            &mut self.finder,
            &self.load.tile,
            self.ticks,
        );
    }

    /// Adopts a new graph when the map changed. Cars whose road is gone, or whose home or job
    /// zone is gone, are abandoned (driving ones and parked ones alike).
    fn refresh(&mut self, sim: &Simulation) {
        let g = RoadGraph::scan(sim);
        if g == self.graph {
            return;
        }
        // a tile that is no longer a road keeps no load (the load pass only visits roads)
        for (t, l) in self.load.tile.iter_mut().enumerate() {
            if !g.is_road(t as u32) {
                *l = 0;
            }
        }
        self.graph = g;
        self.motorised = self.count_motorised();
        let before = self.cars.len() + self.parked.len();
        let graph = &self.graph;
        self.cars.retain(|c| {
            zones_still(graph, c.home, c.job) && c.path[c.at..].iter().all(|&t| graph.is_road(t))
        });
        self.parked.retain(|p| zones_still(graph, p.home, p.job));
        self.counters.abandoned += (before - self.cars.len() - self.parked.len()) as u64;
    }

    /// Moves every car; a car that arrives parks (outward leg) or is home (return leg).
    fn drive(&mut self) {
        let (load, now) = (&self.load.tile, self.ticks);
        let (parked, counters) = (&mut self.parked, &mut self.counters);
        let graph = &self.graph;
        self.cars.retain_mut(|c| {
            let tile = c.tile();
            let mul = if graph.is_fast(tile) {
                HIGHWAY_SPEED_MUL
            } else {
                1
            };
            c.advance_scaled(load[tile as usize], mul);
            if c.arrived() {
                land(c, now, parked, counters);
            }
            !c.arrived()
        });
    }

    pub fn write_density(&self, map: &mut Map<u8>) {
        let (bw, bh) = map.size();
        for bx in 0..bw {
            for by in 0..bh {
                map.set(bx, by, self.load.block[(bx * bh + by) as usize]);
            }
        }
    }

    pub fn vehicle(&self, c: &Car) -> [i32; 5] {
        vehicle_record(&self.graph, c.id, 0, c.tile(), c.path[c.at + 1], c.progress)
    }

    pub fn fingerprint(&self) -> u64 {
        let mut h: u64 = 1_469_598_103_934_665_603;
        let mut mix = |v: u64| {
            h ^= v;
            h = h.wrapping_mul(1_099_511_628_211);
        };
        for c in &self.cars {
            let leg = c.leg as u32;
            for v in [c.id, c.home, c.job, leg, c.at as u32, c.progress] {
                mix(u64::from(v));
            }
            mix(c.path.len() as u64);
        }
        for p in &self.parked {
            for v in [p.id, p.home, p.job, p.failed] {
                mix(u64::from(v));
            }
            mix(p.ready_at);
        }
        for &l in &self.load.tile {
            mix(u64::from(l));
        }
        if let Some(t) = &self.transport {
            t.fingerprint(&mut mix);
        }
        let c = &self.counters;
        for v in [
            c.spawned,
            c.finished,
            c.round_trips,
            c.abandoned,
            c.trip_ticks,
            c.failed_searches,
        ] {
            mix(v);
        }
        h
    }
}
