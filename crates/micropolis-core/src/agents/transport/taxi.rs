//! A taxi: leaves its depot for one rider, drives depot -> home road -> job road -> depot, and
//! is gone when it is back. It exists only while on a ride, so the taxis of a depot on the road
//! are capped by [`MAX_TAXIS_PER_DEPOT`](super::MAX_TAXIS_PER_DEPOT).

use super::riders::Rider;
use crate::agents::vehicles::{speed_at, TILE_16};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Taxi {
    pub id: u32,
    /// Identity of its depot ([`Site::id`](super::net::Site)).
    pub depot: u32,
    /// Depot road, home road, job road, depot road, joined.
    pub path: Vec<u32>,
    pub at: usize,
    pub progress: u32,
    /// Index in `path` of the home road (the pick-up) and of the job road (the drop-off).
    pub pickup_at: usize,
    pub dropoff_at: usize,
    /// The rider assigned, until the drop-off.
    pub rider: Option<Rider>,
    /// The rider is in the car.
    pub picked: bool,
}

/// What happened when the taxi reached a tile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    PickedUp,
    /// The rider got out; the ride covered this many tiles.
    DroppedOff(i32),
}

impl Taxi {
    pub fn tile(&self) -> u32 {
        self.path[self.at]
    }

    pub fn arrived(&self) -> bool {
        self.at + 1 >= self.path.len()
    }

    /// Whether the rider is waiting for this taxi (assigned, not yet in the car).
    pub fn is_fetching(&self) -> bool {
        self.rider.is_some() && !self.picked
    }

    /// Drives one tick; true when it has just entered a new tile.
    pub fn advance(&mut self, load: u8) -> bool {
        if self.arrived() {
            return false;
        }
        self.progress += speed_at(load);
        if self.progress < TILE_16 {
            return false;
        }
        self.progress -= TILE_16;
        self.at += 1;
        true
    }

    /// The pick-up or the drop-off if the taxi is on the tile where it happens. The rider is
    /// taken out of the taxi at the drop-off and returned in the event's place by the caller.
    pub fn event(&mut self) -> Option<Event> {
        if self.rider.is_none() {
            return None;
        }
        if !self.picked && self.at == self.pickup_at {
            self.picked = true;
            return Some(Event::PickedUp);
        }
        if self.picked && self.at == self.dropoff_at {
            return Some(Event::DroppedOff((self.dropoff_at - self.pickup_at) as i32));
        }
        None
    }
}
