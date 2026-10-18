//! Simulated cars (docs/ia-simulation.md, stage A; docs/game-design-v03.md), behind the switch
//! `Extensions::agents`, off by default. Off, nothing here runs and the engine is the original.
//!
//! * [`graph`]: the road graph and the zones read from the map, rebuilt only when it changes.
//! * [`path`]: bounded A*. * [`vehicles`]: the cars. * [`load`]: the measured load per tile.
//! * [`rng`]: the agents' own generator, seeded from the city, never the simulation's.
//!
//! One [`Fleet::step`] per simulated phase (`Simulation::ext_agents_tick`): refresh the graph
//! every [`REFRESH_INTERVAL`] ticks, start at most [`MAX_PATH_SEARCHES_PER_TICK`] trips from
//! residential zones to job zones, move every car, then measure the load. Cars are not saved:
//! a loaded city starts a new fleet from the map.

pub mod graph;
pub mod load;
pub mod path;
pub mod rng;
pub mod vehicles;

use crate::map::Map;
use crate::simulation::Simulation;
use graph::RoadGraph;
use load::LoadMap;
use path::PathFinder;
use rng::AgentRng;
use vehicles::Car;

/// Most cars on the road at once.
pub const MAX_VEHICLES: usize = 1024;
/// Most path searches started in one tick.
pub const MAX_PATH_SEARCHES_PER_TICK: usize = 2;
/// Job zones looked at per trip; the nearest is the destination.
pub const DEST_SAMPLES: u32 = 3;
/// Ticks between two looks at the map for changes.
pub const REFRESH_INTERVAL: u64 = 16;
/// Percent of the residents of a zone who own a car.
pub const MOTORISED_PCT: i32 = 60;
/// Motorised residents per car a zone may have on the road at once.
pub const RESIDENTS_PER_CAR: i32 = 4;

/// What the fleet has done so far (tests and the stats read it).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counters {
    pub spawned: u64,
    pub finished: u64,
    /// Cars removed because the road under their path disappeared.
    pub abandoned: u64,
    pub trip_ticks: u64,
    pub failed_searches: u64,
    pub searches_in_last_tick: usize,
    pub max_searches_in_tick: usize,
    pub max_expansions: usize,
    pub max_path_len: usize,
    pub max_cars: usize,
}

#[derive(Debug, Clone)]
struct Run {
    graph: RoadGraph,
    cars: Vec<Car>,
    load: LoadMap,
    finder: PathFinder,
    rng: AgentRng,
    ticks: u64,
    next_id: u32,
    motorised: i32,
    counters: Counters,
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

/// Cars a zone of `pop` residents may have on the road at once.
pub fn zone_car_cap(pop: i32) -> usize {
    (pop * MOTORISED_PCT / 100 / RESIDENTS_PER_CAR).max(1) as usize
}

fn manhattan(g: &RoadGraph, a: u32, b: u32) -> u32 {
    let ((ax, ay), (bx, by)) = (g.xy(a), g.xy(b));
    (ax - bx).unsigned_abs() + (ay - by).unsigned_abs()
}

impl Run {
    fn new(sim: &Simulation) -> Run {
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
            finder: PathFinder::default(),
            ticks: 0,
            next_id: 1,
            motorised: 0,
            counters: Counters::default(),
        };
        run.motorised = run.count_motorised();
        run
    }

    fn count_motorised(&self) -> i32 {
        let pop: i32 = self.graph.zones.iter().map(|z| z.pop).sum();
        pop * MOTORISED_PCT / 100
    }

    fn step(&mut self, sim: &Simulation) {
        self.ticks += 1;
        if self.ticks.is_multiple_of(REFRESH_INTERVAL) {
            self.refresh(sim);
        }
        self.spawn();
        self.drive();
        let tiles = self.cars.iter().map(Car::tile);
        self.load.update(&self.graph, tiles);
        self.counters.max_cars = self.counters.max_cars.max(self.cars.len());
    }

    /// Adopts a new graph when the map changed and drops the cars whose road is gone.
    fn refresh(&mut self, sim: &Simulation) {
        let g = RoadGraph::scan(sim);
        if g == self.graph {
            return;
        }
        self.graph = g;
        self.motorised = self.count_motorised();
        let before = self.cars.len();
        let graph = &self.graph;
        self.cars
            .retain(|c| c.path[c.at..].iter().all(|&t| graph.is_road(t)));
        self.counters.abandoned += (before - self.cars.len()) as u64;
    }

    fn spawn(&mut self) {
        self.counters.searches_in_last_tick = 0;
        for _ in 0..MAX_PATH_SEARCHES_PER_TICK {
            if self.cars.len() >= MAX_VEHICLES
                || self.graph.residential.is_empty()
                || self.graph.jobs.is_empty()
            {
                break;
            }
            self.try_trip();
        }
        let c = &mut self.counters;
        c.max_searches_in_tick = c.max_searches_in_tick.max(c.searches_in_last_tick);
    }

    /// One trip attempt: a random residential zone with room for a car, the nearest of a few
    /// random job zones, one bounded search.
    fn try_trip(&mut self) {
        let g = &self.graph;
        let home =
            &g.zones[g.residential[self.rng.below(g.residential.len() as u32) as usize] as usize];
        let out = self.cars.iter().filter(|c| c.home == home.tile).count();
        let (Some(from), true) = (home.access, out < zone_car_cap(home.pop)) else {
            return;
        };
        let mut best: Option<(u32, u32)> = None;
        for _ in 0..DEST_SAMPLES {
            let job = &g.zones[g.jobs[self.rng.below(g.jobs.len() as u32) as usize] as usize];
            let Some(to) = job.access else { continue };
            let d = manhattan(g, from, to);
            if best.is_none_or(|(bd, _)| d < bd) {
                best = Some((d, to));
            }
        }
        let Some((_, to)) = best else { return };
        self.counters.searches_in_last_tick += 1;
        let found = self.finder.find(g, &self.load.tile, from, to);
        let c = &mut self.counters;
        c.max_expansions = c.max_expansions.max(self.finder.last_expansions);
        match found {
            Some(path) if path.len() >= 2 => {
                c.max_path_len = c.max_path_len.max(path.len());
                c.spawned += 1;
                self.cars.push(Car {
                    id: self.next_id,
                    home: home.tile,
                    path,
                    at: 0,
                    progress: 0,
                    born: self.ticks,
                });
                self.next_id += 1;
            }
            _ => c.failed_searches += 1,
        }
    }

    fn drive(&mut self) {
        let (load, now) = (&self.load.tile, self.ticks);
        let (mut done, mut trip) = (0, 0);
        self.cars.retain_mut(|c| {
            c.advance(load[c.tile() as usize]);
            if c.arrived() {
                done += 1;
                trip += now - c.born;
            }
            !c.arrived()
        });
        self.counters.finished += done;
        self.counters.trip_ticks += trip;
    }

    fn write_density(&self, map: &mut Map<u8>) {
        let (bw, bh) = map.size();
        for bx in 0..bw {
            for by in 0..bh {
                map.set(bx, by, self.load.block[(bx * bh + by) as usize]);
            }
        }
    }

    fn vehicle(&self, c: &Car) -> [i32; 5] {
        let (x, y) = self.graph.xy(c.tile());
        let (nx, ny) = self.graph.xy(c.path[c.at + 1]);
        let (dx, dy) = (nx - x, ny - y);
        let p = c.progress as i32;
        let dir = match (dx, dy) {
            (0, -1) => 0,
            (1, 0) => 1,
            (0, 1) => 2,
            _ => 3,
        };
        [
            c.id as i32,
            0,
            x * 16 + 8 + dx * p,
            y * 16 + 8 + dy * p,
            dir,
        ]
    }

    fn fingerprint(&self) -> u64 {
        let mut h: u64 = 1_469_598_103_934_665_603;
        let mut mix = |v: u64| {
            h ^= v;
            h = h.wrapping_mul(1_099_511_628_211);
        };
        for c in &self.cars {
            for v in [c.id, c.home, c.at as u32, c.progress, c.path.len() as u32] {
                mix(u64::from(v));
            }
        }
        for &l in &self.load.tile {
            mix(u64::from(l));
        }
        let c = &self.counters;
        for v in [
            c.spawned,
            c.finished,
            c.abandoned,
            c.trip_ticks,
            c.failed_searches,
        ] {
            mix(v);
        }
        h
    }
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

    fn agent_run(&self) -> Option<&Run> {
        self.extensions().fleet.run.as_deref()
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
        self.agent_run().map(|r| r.counters).unwrap_or_default()
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
