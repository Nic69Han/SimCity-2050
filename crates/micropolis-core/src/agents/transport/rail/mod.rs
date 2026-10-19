//! Trains and metro (docs/game-design-v06.md), a part of the transport.
//!
//! * [`grid`]: the rail tiles and the tunnels as grids, and a bounded A*.
//! * [`lines`]: the train lines (two gares joined by rails) and the metro lines (the working
//!   lines of the transit network, toured station by station).
//! * [`shuttle`]: the vehicles, forth and back along a line. `step`: one tick.
//!
//! The lines are rebuilt, on the same refresh as the road graph, only when their inputs (the
//! rail tiles, the gares, the tunnels and stations, the transit rule) changed. A vehicle or a
//! waiting rider of a line that no longer exists is withdrawn and counted abandoned; those of a
//! line that is unchanged carry on.

pub mod grid;
pub mod lines;
pub mod shuttle;
mod step;

#[cfg(test)]
mod tests;

pub use grid::{is_rail, Grid, GridFinder, MAX_RAIL_EXPANSIONS, MAX_RAIL_PATH_LEN};
pub use lines::{Line, LineKind, LineStop};
pub use shuttle::Shuttle;

use super::net::Site;
use super::riders::{Rider, TransportCounters};
use crate::simulation::Simulation;
use crate::structures::GENRE_STATION;
use crate::transit::{STATION, TUNNEL};

/// Trains of one line on the road at once.
pub const MAX_TRAINS_PER_LINE: usize = 2;
/// Riders in a train.
pub const TRAIN_CAPACITY: usize = 40;
/// Sixteenths of a tile a train covers per tick.
pub const TRAIN_SPEED: u32 = 12;
/// Ticks a train stands at a gare.
pub const TRAIN_DWELL_TICKS: u32 = 6;
/// Ticks before a line sends its next train.
pub const TRAIN_SPAWN_INTERVAL: u64 = 60;
/// Dollars paid by a train rider on arrival.
pub const TRAIN_FARE: i32 = 4;
/// Train lines in the city.
pub const MAX_TRAIN_LINES: usize = 8;
/// Gares the lines are made of (the first ones of the list).
pub const MAX_GARES: usize = 16;
/// Path searches made to build the train lines.
pub const MAX_TRAIN_SEARCHES: usize = 64;
/// Metro cars of one line on the road at once.
pub const MAX_RAMES_PER_LINE: usize = 3;
/// Riders in a metro car.
pub const METRO_CAPACITY: usize = 60;
/// Sixteenths of a tile a metro car covers per tick.
pub const METRO_SPEED: u32 = 12;
/// Ticks a metro car stands at a station.
pub const METRO_DWELL_TICKS: u32 = 4;
/// Ticks before a line sends its next metro car.
pub const METRO_SPAWN_INTERVAL: u64 = 40;
/// Dollars paid by a metro rider on arrival.
pub const METRO_FARE: i32 = 3;
/// Metro lines in the city.
pub const MAX_METRO_LINES: usize = 8;
/// Stops on one metro line.
pub const MAX_LINE_STOPS: usize = 24;
/// Stations tried by the tour of one metro line (some may have no tunnel path).
pub const MAX_LINE_SEARCHES: usize = 2 * MAX_LINE_STOPS;
/// Tiles of the path of one metro line.
pub const MAX_LINE_PATH_LEN: usize = 1024;

/// What a kind of line is made of.
#[derive(Debug, Clone, Copy)]
pub struct Params {
    pub speed: u32,
    pub capacity: usize,
    pub dwell: u32,
    pub fare: i32,
    pub per_line: usize,
    pub spawn_interval: u64,
}

impl LineKind {
    pub const fn params(self) -> Params {
        match self {
            LineKind::Train => Params {
                speed: TRAIN_SPEED,
                capacity: TRAIN_CAPACITY,
                dwell: TRAIN_DWELL_TICKS,
                fare: TRAIN_FARE,
                per_line: MAX_TRAINS_PER_LINE,
                spawn_interval: TRAIN_SPAWN_INTERVAL,
            },
            LineKind::Metro => Params {
                speed: METRO_SPEED,
                capacity: METRO_CAPACITY,
                dwell: METRO_DWELL_TICKS,
                fare: METRO_FARE,
                per_line: MAX_RAMES_PER_LINE,
                spawn_interval: METRO_SPAWN_INTERVAL,
            },
        }
    }

    /// Kind number of the vehicles of this line in `vehicles()`.
    pub const fn vehicle_kind(self) -> i32 {
        match self {
            LineKind::Train => 3,
            LineKind::Metro => 4,
        }
    }
}

/// The trains and metro cars of one city, with the inputs the lines were built from.
#[derive(Debug, Clone, Default)]
pub struct Rail {
    rails: Grid,
    gares: Vec<Site>,
    tunnels: Grid,
    stations: Vec<u32>,
    finder: GridFinder,
    pub lines: Vec<Line>,
    /// Riders waiting: `queues[line][stop]`, longest wait first.
    pub queues: Vec<Vec<Vec<Rider>>>,
    pub shuttles: Vec<Shuttle>,
    /// Transport tick from which each line may send its next vehicle.
    next_spawn: Vec<u64>,
}

/// The working tunnels and stations of the transit network as a grid, and the working stations
/// in tile order; empty while the transit rule is off.
fn metro_inputs(sim: &Simulation) -> (Grid, Vec<u32>) {
    let net = sim.transit();
    if !sim.transit_rules() || net.is_empty() {
        return (Grid::default(), Vec::new());
    }
    let (w, h) = sim.world_size();
    let bytes = net.underground.as_slice();
    let open = bytes.iter().enumerate().map(|(i, &b)| {
        let (x, y) = (i as i32 / h, i as i32 % h);
        (b == TUNNEL || b == STATION) && net.is_working(x, y)
    });
    let grid = Grid::new(w, h, open.collect());
    let stations = net.stations().iter().filter(|&&(x, y)| net.is_working(x, y));
    (grid, stations.map(|&(x, y)| (x * h + y) as u32).collect())
}

impl Rail {
    /// Reads the gares, the rails and the metro of `sim`; rebuilds the lines if any of them
    /// changed since the last time.
    pub fn refresh(&mut self, sim: &Simulation, counters: &mut TransportCounters, now: u64) {
        let (w, h) = sim.world_size();
        let gares: Vec<_> = sim.structures().into_iter().filter(|v| v.genre == GENRE_STATION).collect();
        let rails = if gares.is_empty() {
            Grid::default()
        } else {
            Grid::from_tiles(w, h, &sim.tiles, is_rail)
        };
        let sites = lines::gare_sites(&rails, &gares);
        let (tunnels, stations) = metro_inputs(sim);
        if (&rails, &sites, &tunnels, &stations) == (&self.rails, &self.gares, &self.tunnels, &self.stations) {
            return;
        }
        let mut all = lines::train_lines(&rails, &sites, &mut self.finder);
        all.extend(lines::metro_lines(&tunnels, &stations, &mut self.finder));
        (self.rails, self.gares, self.tunnels, self.stations) = (rails, sites, tunnels, stations);
        self.adopt(all, counters, now);
    }

    /// Switches to `lines`: what belongs to a line that is unchanged stays, the rest is withdrawn
    /// and its riders count as abandoned.
    fn adopt(&mut self, lines: Vec<Line>, counters: &mut TransportCounters, now: u64) {
        let old = std::mem::replace(&mut self.lines, lines);
        let keep: Vec<Option<usize>> = old
            .iter()
            .map(|o| self.lines.iter().position(|n| n == o))
            .collect();
        let mut queues: Vec<Vec<Vec<Rider>>> = self.lines.iter().map(|l| vec![Vec::new(); l.stops.len()]).collect();
        let mut spawn = vec![now; self.lines.len()];
        for (o, q) in std::mem::take(&mut self.queues).into_iter().enumerate() {
            match keep[o] {
                Some(n) => {
                    spawn[n] = self.next_spawn.get(o).copied().unwrap_or(now);
                    queues[n] = q;
                }
                None => counters.abandoned += q.iter().map(|s| s.len() as u64).sum::<u64>(),
            }
        }
        self.shuttles.retain_mut(|s| match keep[s.line] {
            Some(n) => {
                s.line = n;
                true
            }
            None => {
                counters.abandoned += s.riders.len() as u64;
                false
            }
        });
        self.queues = queues;
        self.next_spawn = spawn;
        counters.rebuilds += 1;
    }

    /// Riders waiting at a platform.
    pub fn waiting(&self) -> usize {
        self.queues.iter().flatten().map(Vec::len).sum()
    }

    /// Riders in a vehicle.
    pub fn on_board(&self) -> usize {
        self.shuttles.iter().map(|s| s.riders.len()).sum()
    }

    /// Every rider of the rail: waiting, then on board.
    pub fn riders(&self) -> impl Iterator<Item = &Rider> {
        let waiting = self.queues.iter().flatten().flatten();
        waiting.chain(self.shuttles.iter().flat_map(|s| s.riders.iter()))
    }

    /// Lines of one kind.
    pub fn line_count(&self, kind: LineKind) -> usize {
        self.lines.iter().filter(|l| l.kind == kind).count()
    }

    /// The vehicles as `[id, kind, x16, y16, direction]` (kind 3 train, 4 metro car).
    pub fn vehicles(&self, g: &super::super::graph::RoadGraph) -> Vec<[i32; 5]> {
        let record = |s: &Shuttle| {
            let l = &self.lines[s.line];
            let kind = l.kind.vehicle_kind();
            super::super::vehicle_record(g, s.id, kind, s.tile(l), s.next_tile(l), s.progress)
        };
        self.shuttles.iter().map(record).collect()
    }

    /// Feeds the lines, the vehicles and the riders to `mix` (determinism tests).
    pub fn fingerprint(&self, mix: &mut impl FnMut(u64)) {
        mix(self.lines.len() as u64);
        for l in &self.lines {
            mix(l.path.len() as u64);
            mix(l.stops.len() as u64);
        }
        for r in self.riders() {
            for v in [r.id, r.home, r.job, r.stop] {
                mix(u64::from(v));
            }
            mix(r.born);
        }
        for s in &self.shuttles {
            for v in [s.id, s.line as u32, s.at as u32, u32::from(s.forward), s.progress, s.dwell] {
                mix(u64::from(v));
            }
        }
    }
}
