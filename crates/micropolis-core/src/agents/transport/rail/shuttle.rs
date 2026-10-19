//! A train or a metro car ("rame"): shuttles forth and back along the path of its line, stands
//! at the stops it meets, lets its riders off (they pay the fare) and takes on the riders
//! waiting there, up to the capacity of its kind.

use super::lines::{Line, LineKind};
use crate::agents::transport::riders::{Rider, TransportCounters};
use crate::agents::vehicles::TILE_16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shuttle {
    pub id: u32,
    /// Index of its line in the rail's lines.
    pub line: usize,
    /// Index in the line's path of the tile it is on.
    pub at: usize,
    /// Driving towards the end of the path (else towards the start).
    pub forward: bool,
    /// Sixteenths of a tile driven towards the next tile (< 16).
    pub progress: u32,
    /// Ticks left standing at a stop.
    pub dwell: u32,
    pub riders: Vec<Rider>,
}

impl Shuttle {
    pub fn new(id: u32, line: usize) -> Shuttle {
        Shuttle {
            id,
            line,
            at: 0,
            forward: true,
            progress: 0,
            dwell: 0,
            riders: Vec::new(),
        }
    }

    pub fn tile(&self, l: &Line) -> u32 {
        l.path[self.at]
    }

    /// The tile it drives to next (paths have two tiles at least, and the direction turns at
    /// both ends, so it exists).
    pub fn next_tile(&self, l: &Line) -> u32 {
        let next = if self.forward {
            self.at + 1
        } else {
            self.at.saturating_sub(1)
        };
        l.path[next.min(l.path.len() - 1)]
    }

    /// Drives one tick at `speed` sixteenths of a tile; true when it has just entered a tile.
    pub fn advance(&mut self, l: &Line, speed: u32) -> bool {
        if self.dwell > 0 {
            self.dwell -= 1;
            return false;
        }
        self.progress += speed;
        if self.progress < TILE_16 {
            return false;
        }
        self.progress -= TILE_16;
        self.at = if self.forward {
            self.at + 1
        } else {
            self.at - 1
        };
        if self.at + 1 >= l.path.len() {
            self.forward = false;
        } else if self.at == 0 {
            self.forward = true;
        }
        true
    }

    /// Serves the stops of the line on this tile: riders bound for the stop get off and pay
    /// `fare`, then the riders waiting there get on while there is room (`capacity`); it stands
    /// `dwell` ticks. `queues[k]` waits at `l.stops[k]`.
    pub fn serve(
        &mut self,
        l: &Line,
        queues: &mut [Vec<Rider>],
        counters: &mut TransportCounters,
        (capacity, dwell, fare): (usize, u32, i32),
    ) {
        let tile = self.tile(l);
        for (k, stop) in l.stops.iter().enumerate().filter(|(_, s)| s.tile == tile) {
            self.dwell = dwell;
            let before = self.riders.len();
            self.riders.retain(|r| r.stop != stop.site);
            for _ in self.riders.len()..before {
                match l.kind {
                    LineKind::Train => counters.train_arrival(fare),
                    LineKind::Metro => counters.metro_arrival(fare),
                }
            }
            let room = capacity.saturating_sub(self.riders.len());
            let take = room.min(queues[k].len());
            self.riders.extend(queues[k].drain(..take));
        }
    }
}
