//! A bus: drives its route's loop forever, stops at the stops it meets, lets its riders off and
//! takes on waiting riders (at most [`BUS_CAPACITY`]) whose stop the route serves.

use super::net::Net;
use super::riders::{Rider, TransportCounters};
use super::route::Route;
use super::{BUS_CAPACITY, BUS_DWELL_TICKS, BUS_FARE};
use crate::agents::vehicles::{speed_at, TILE_16};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bus {
    pub id: u32,
    /// Identity of its depot ([`Site::id`](super::net::Site)).
    pub depot: u32,
    /// Index of its route in the transport's routes (same order as the depots).
    pub route: usize,
    /// Index in the route's path of the tile the bus is on.
    pub at: usize,
    /// Sixteenths of a tile driven towards the next tile (< 16).
    pub progress: u32,
    /// Ticks left standing at a stop.
    pub dwell: u32,
    pub riders: Vec<Rider>,
}

impl Bus {
    pub fn new(id: u32, depot: u32, route: usize) -> Bus {
        Bus {
            id,
            depot,
            route,
            at: 0,
            progress: 0,
            dwell: 0,
            riders: Vec::new(),
        }
    }

    /// The tile the bus is on.
    pub fn tile(&self, r: &Route) -> u32 {
        r.path[self.at]
    }

    /// The tile it drives to next (the loop wraps).
    pub fn next_tile(&self, r: &Route) -> u32 {
        r.path[(self.at + 1) % r.path.len()]
    }

    /// Drives one tick on a tile of load `load`; true when the bus has just entered a new tile.
    pub fn advance(&mut self, r: &Route, load: u8) -> bool {
        if self.dwell > 0 {
            self.dwell -= 1;
            return false;
        }
        self.progress += speed_at(load);
        if self.progress < TILE_16 {
            return false;
        }
        self.progress -= TILE_16;
        self.at = (self.at + 1) % r.path.len();
        true
    }

    /// Serves the stops of the route that sit on the bus's tile: riders whose stop it is get
    /// off and pay [`BUS_FARE`], then riders waiting there get on while there is room. The bus
    /// stands [`BUS_DWELL_TICKS`] ticks if there was a stop.
    pub fn serve(
        &mut self,
        r: &Route,
        net: &Net,
        queues: &mut [Vec<Rider>],
        counters: &mut TransportCounters,
    ) {
        let at = self.at;
        for rs in r.stops.iter().filter(|s| s.at == at) {
            let here = net.stops[rs.stop].id;
            self.dwell = BUS_DWELL_TICKS;
            let before = self.riders.len();
            self.riders.retain(|x| x.stop != here);
            for _ in self.riders.len()..before {
                counters.bus_arrival(BUS_FARE);
            }
            self.board(r, net, &mut queues[rs.stop]);
        }
    }

    fn board(&mut self, r: &Route, net: &Net, queue: &mut Vec<Rider>) {
        let mut i = 0;
        while i < queue.len() && self.riders.len() < BUS_CAPACITY {
            let wanted = net.stops.iter().position(|s| s.id == queue[i].stop);
            if wanted.is_some_and(|w| r.serves(w)) {
                self.riders.push(queue.remove(i));
            } else {
                i += 1;
            }
        }
    }
}
