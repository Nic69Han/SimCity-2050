//! Where riders come from and where taxis go: one attempt per tick to create a rider, one
//! taxi dispatch per tick, and the riders who give up waiting.

use super::taxi::Taxi;
use super::{zone_rider_cap, Rider, Transport, MAX_RIDERS, MAX_TAXIS_PER_DEPOT, MAX_TAXI_FAILURES};
use super::{MAX_TAXI_REQUESTS, MAX_WAITING_PER_STOP, MAX_WAIT_TICKS};
use crate::agents::graph::RoadGraph;
use crate::agents::path::PathFinder;
use crate::agents::DEST_SAMPLES;

/// `counts[i]` = number of `ids` equal to `depots[i]`.
fn per_depot(depots: &[u32], ids: impl Iterator<Item = u32>) -> Vec<usize> {
    let mut counts = vec![0; depots.len()];
    for id in ids {
        if let Some(p) = depots.iter().position(|&d| d == id) {
            counts[p] += 1;
        }
    }
    counts
}

impl Transport {
    /// Riders in the city: waiting and on board.
    fn total_riders(&self) -> usize {
        let a = self.audit();
        a.waiting + a.on_board
    }

    /// Riders of the home zone `home` in the system.
    fn riders_of_home(&self, home: u32) -> usize {
        let buses = self.buses.iter().flat_map(|b| b.riders.iter());
        let taxis = self.taxis.iter().filter_map(|t| t.rider.as_ref());
        self.queues
            .iter()
            .flatten()
            .chain(self.requests.iter())
            .chain(buses)
            .chain(taxis)
            .filter(|r| r.home == home)
            .count()
    }

    /// Riders who have waited more than [`MAX_WAIT_TICKS`] give up.
    pub(super) fn expire(&mut self, now: u64) {
        let alive = |r: &Rider| now - r.born <= MAX_WAIT_TICKS;
        let before: usize = self.queues.iter().map(Vec::len).sum::<usize>() + self.requests.len();
        self.queues.iter_mut().for_each(|q| q.retain(alive));
        self.requests.retain(alive);
        let after: usize = self.queues.iter().map(Vec::len).sum::<usize>() + self.requests.len();
        self.counters.abandoned += (before - after) as u64;
    }

    /// One attempt to create a rider: a random home zone with residents without a car and room
    /// in its share, the nearest of a few random job zones, then by bus (a stop near each,
    /// served by a common loop) or else by taxi.
    pub(super) fn try_rider(&mut self, g: &RoadGraph, now: u64) {
        let none = self.net.stops.is_empty() && self.net.taxi_depots.is_empty();
        if g.residential.is_empty() || g.jobs.is_empty() || none {
            return;
        }
        let home =
            &g.zones[g.residential[self.rng.below(g.residential.len() as u32) as usize] as usize];
        let (cap, Some(from)) = (zone_rider_cap(home.pop), home.access) else {
            return;
        };
        let mut job: Option<(u32, u32, u32)> = None;
        for _ in 0..DEST_SAMPLES {
            let z = &g.zones[g.jobs[self.rng.below(g.jobs.len() as u32) as usize] as usize];
            let Some(to) = z.access else { continue };
            let d = g.distance(home.tile, z.tile);
            if job.is_none_or(|(bd, ..)| d < bd) {
                job = Some((d, z.tile, to));
            }
        }
        let (Some((_, job, to)), true) = (job, cap > 0) else {
            return;
        };
        let stops = (self.net.stop_near(g, home.tile), self.net.stop_near(g, job));
        let by_bus = match stops {
            (Some(a), Some(b)) if a != b => self
                .routes
                .iter()
                .flatten()
                .any(|r| r.serves(a) && r.serves(b)),
            _ => false,
        };
        let by_taxi = !by_bus && !self.net.taxi_depots.is_empty() && from != to;
        if !by_bus && !by_taxi {
            return;
        }
        let full = match stops {
            (Some(a), _) if by_bus => self.queues[a].len() >= MAX_WAITING_PER_STOP,
            _ => self.requests.len() >= MAX_TAXI_REQUESTS,
        };
        if full || self.total_riders() >= MAX_RIDERS || self.riders_of_home(home.tile) >= cap {
            self.counters.refused += 1;
            return;
        }
        let stop = match stops {
            (_, Some(b)) if by_bus => self.net.stops[b].id,
            _ => 0,
        };
        let rider = Rider {
            id: self.next_rider,
            home: home.tile,
            job,
            stop,
            born: now,
            failed: 0,
        };
        self.next_rider += 1;
        self.counters.created += 1;
        match stops {
            (Some(a), _) if by_bus => self.queues[a].push(rider),
            _ => self.requests.push(rider),
        }
    }

    /// Sends one taxi for the rider who has waited longest, from the nearest depot that has a
    /// taxi to spare: at most [`MAX_TRANSPORT_SEARCHES_PER_TICK`] path searches.
    pub(super) fn dispatch_taxi(&mut self, g: &RoadGraph, finder: &mut PathFinder, load: &[u8]) {
        let Some(rider) = self.requests.first() else {
            return;
        };
        let access = |tile| g.zone_at(tile).and_then(|z| g.zones[z].access);
        let (Some(home), Some(job)) = (access(rider.home), access(rider.job)) else {
            self.requests.remove(0);
            self.counters.abandoned += 1;
            return;
        };
        let ids: Vec<u32> = self.net.taxi_depots.iter().map(|d| d.id).collect();
        let out = per_depot(&ids, self.taxis.iter().map(|t| t.depot));
        let depot = (0..ids.len())
            .filter(|&i| out[i] < MAX_TAXIS_PER_DEPOT)
            .min_by_key(|&i| (g.distance(self.net.taxi_depots[i].access, home), i))
            .map(|i| self.net.taxi_depots[i]);
        let Some(depot) = depot else { return };
        let mut legs = Vec::with_capacity(3);
        for (a, b) in [(depot.access, home), (home, job), (job, depot.access)] {
            self.counters.searches_in_last_tick += 1;
            match finder.find(g, load, a, b) {
                Some(p) => legs.push(p),
                None => break,
            }
        }
        if legs.len() < 3 {
            self.taxi_failed();
            return;
        }
        let pickup_at = legs[0].len() - 1;
        let dropoff_at = pickup_at + legs[1].len() - 1;
        let path: Vec<u32> = legs
            .iter()
            .enumerate()
            .flat_map(|(i, p)| p.iter().skip(usize::from(i > 0)).copied())
            .collect();
        let mut taxi = Taxi {
            id: self.next_vehicle,
            depot: depot.id,
            path,
            at: 0,
            progress: 0,
            pickup_at,
            dropoff_at,
            rider: Some(self.requests.remove(0)),
            picked: false,
        };
        self.next_vehicle += 1;
        // a home on the depot's own road: the rider gets in at once
        let _ = taxi.event();
        self.taxis.push(taxi);
    }

    /// The head of the queue found no path: it goes to the back, or gives up for good.
    fn taxi_failed(&mut self) {
        let mut rider = self.requests.remove(0);
        rider.failed += 1;
        if rider.failed >= MAX_TAXI_FAILURES {
            self.counters.abandoned += 1;
        } else {
            self.requests.push(rider);
        }
    }
}
