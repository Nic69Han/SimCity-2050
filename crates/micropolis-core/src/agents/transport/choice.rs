//! The choice of the mode of a trip of a resident without a car (docs/game-design-v06.md):
//! `cost = WALK_COST * walk + WAIT_COST + RIDE_COST(mode) * ride + price(mode)`, walk and ride
//! in tiles (Manhattan). The candidates are the bus, the metro, the train and the taxi; the
//! cheapest wins, a tie goes to the first in that order. One mode per trip: no transfer.

use super::rail::{LineKind, Rail};
use super::{Transport, BUS_FARE, TAXI_FARE_PER_TILE, WALK_RADIUS};
use crate::agents::graph::RoadGraph;

/// Cost of one tile walked to a stop.
pub const WALK_COST: i32 = 2;
/// Cost of waiting for a vehicle, whatever the mode.
pub const WAIT_COST: i32 = 20;

/// The modes, in the order that breaks a tie.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Mode {
    Bus,
    Metro,
    Train,
    Taxi,
}

/// Cost of one tile ridden.
pub const fn ride_cost(mode: Mode) -> i32 {
    match mode {
        Mode::Bus | Mode::Taxi => 2,
        Mode::Metro | Mode::Train => 1,
    }
}

/// What the ticket costs for a ride of `ride` tiles.
pub const fn price(mode: Mode, ride: i32) -> i32 {
    match mode {
        Mode::Bus => BUS_FARE,
        Mode::Metro => super::rail::METRO_FARE,
        Mode::Train => super::rail::TRAIN_FARE,
        Mode::Taxi => TAXI_FARE_PER_TILE.saturating_mul(ride),
    }
}

/// The cost of a trip with `walk` tiles on foot and `ride` tiles in the vehicle.
pub fn trip_cost(mode: Mode, walk: u32, ride: u32) -> i32 {
    let (walk, ride) = (walk.min(1 << 16) as i32, ride.min(1 << 16) as i32);
    WALK_COST * walk + WAIT_COST + ride_cost(mode) * ride + price(mode, ride)
}

/// A way of making a trip: its mode and cost, the line (rail only) and the stops of the
/// boarding and of the getting off (indices: of the net's stops for a bus, of the line's stops
/// for the rail; unused for a taxi).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Offer {
    pub mode: Mode,
    pub cost: i32,
    pub line: usize,
    pub from: usize,
    pub to: usize,
}

/// The cheapest offer; on a tie the mode that comes first in [`Mode`]'s order.
pub fn cheapest(offers: &[Offer]) -> Option<Offer> {
    offers.iter().copied().min_by_key(|o| (o.cost, o.mode))
}

/// Index of the stop of `line` nearest to `tile` within [`WALK_RADIUS`] (the first on a tie).
fn nearest_stop(g: &RoadGraph, stops: &[super::rail::LineStop], tile: u32) -> Option<usize> {
    let near = |p: &usize| g.distance(tile, stops[*p].tile) <= WALK_RADIUS as u32;
    (0..stops.len())
        .filter(near)
        .min_by_key(|&p| (g.distance(tile, stops[p].tile), p))
}

/// The cheapest trip by a line of `kind` that serves both ends, if any.
fn rail_offer(rail: &Rail, g: &RoadGraph, kind: LineKind, home: u32, job: u32) -> Option<Offer> {
    let mode = if kind == LineKind::Train { Mode::Train } else { Mode::Metro };
    let mut best: Option<Offer> = None;
    for (line, l) in rail.lines.iter().enumerate().filter(|(_, l)| l.kind == kind) {
        let (Some(from), Some(to)) = (nearest_stop(g, &l.stops, home), nearest_stop(g, &l.stops, job)) else {
            continue;
        };
        if from == to {
            continue;
        }
        let (a, b) = (l.stops[from].tile, l.stops[to].tile);
        let cost = trip_cost(mode, g.distance(home, a) + g.distance(job, b), g.distance(a, b));
        if best.is_none_or(|o| cost < o.cost) {
            best = Some(Offer { mode, cost, line, from, to });
        }
    }
    best
}

impl Transport {
    fn bus_offer(&self, g: &RoadGraph, home: u32, job: u32) -> Option<Offer> {
        let (a, b) = (self.net.stop_near(g, home)?, self.net.stop_near(g, job)?);
        let served = self.routes.iter().flatten().any(|r| r.serves(a) && r.serves(b));
        if a == b || !served {
            return None;
        }
        let (sa, sb) = (self.net.stops[a].id, self.net.stops[b].id);
        let cost = trip_cost(Mode::Bus, g.distance(home, sa) + g.distance(job, sb), g.distance(sa, sb));
        Some(Offer { mode: Mode::Bus, cost, line: 0, from: a, to: b })
    }

    /// Every way the resident of the home zone `home` can reach the job zone `job` (zone
    /// centres); `from` and `to` are their access roads, which a taxi needs to differ.
    pub(super) fn offers(&self, g: &RoadGraph, home: u32, job: u32, (from, to): (u32, u32)) -> Vec<Offer> {
        let mut offers = Vec::with_capacity(4);
        offers.extend(self.bus_offer(g, home, job));
        offers.extend(rail_offer(&self.rail, g, LineKind::Metro, home, job));
        offers.extend(rail_offer(&self.rail, g, LineKind::Train, home, job));
        if !self.net.taxi_depots.is_empty() && from != to {
            let ride = g.distance(home, job);
            let cost = trip_cost(Mode::Taxi, 0, ride);
            offers.push(Offer { mode: Mode::Taxi, cost, line: 0, from: 0, to: 0 });
        }
        offers
    }
}
