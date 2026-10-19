//! Starting trips: the return searches of parked cars first, then the departures from homes,
//! all inside [`MAX_PATH_SEARCHES_PER_TICK`]; and what happens when a leg arrives.

use super::vehicles::{Car, Leg, Parked};
use super::{graph::RoadGraph, WORK_TICKS};
use super::{run::Run, zone_car_cap, Counters};
use super::{DEST_SAMPLES, MAX_PATH_SEARCHES_PER_TICK, MAX_RETURN_FAILURES, MAX_VEHICLES};

fn manhattan(g: &RoadGraph, a: u32, b: u32) -> u32 {
    let ((ax, ay), (bx, by)) = (g.xy(a), g.xy(b));
    (ax - bx).unsigned_abs() + (ay - by).unsigned_abs()
}

/// What became of a parked car whose time is up.
enum Return {
    /// It left the parking lot: driving home, or already home.
    Left,
    /// No path this time; it stays parked and tries again on a later tick.
    Retry,
    /// Too many failures, or its zones are gone: it is counted abandoned.
    Abandoned,
}

/// A leg of car `c` has arrived at fleet tick `now`: the outward leg parks the car, the return
/// leg ends the round trip.
pub(super) fn land(c: &Car, now: u64, parked: &mut Vec<Parked>, counters: &mut Counters) {
    counters.finished += 1;
    counters.trip_ticks += now - c.born;
    match c.leg {
        Leg::Out => parked.push(Parked {
            id: c.id,
            home: c.home,
            job: c.job,
            ready_at: now + WORK_TICKS,
            failed: 0,
        }),
        Leg::Back => counters.round_trips += 1,
    }
}

impl Run {
    /// Cars on the road plus parked cars: what [`MAX_VEHICLES`] bounds.
    pub(super) fn present(&self) -> usize {
        self.cars.len() + self.parked.len()
    }

    /// The searches of one tick: returns first, then new departures with what is left.
    pub(super) fn plan(&mut self) {
        self.counters.searches_in_last_tick = 0;
        self.start_returns();
        let left = MAX_PATH_SEARCHES_PER_TICK - self.counters.searches_in_last_tick;
        for _ in 0..left {
            if self.present() >= MAX_VEHICLES
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

    /// One pass over the parked cars (at most one search per [`MAX_PATH_SEARCHES_PER_TICK`]).
    fn start_returns(&mut self) {
        let mut i = 0;
        while i < self.parked.len()
            && self.counters.searches_in_last_tick < MAX_PATH_SEARCHES_PER_TICK
        {
            if self.parked[i].ready_at > self.ticks {
                i += 1;
            } else if let Return::Retry = self.try_return(i) {
                i += 1;
            }
        }
    }

    /// One return search for `parked[i]`; the car leaves the list unless the answer is `Retry`.
    fn try_return(&mut self, i: usize) -> Return {
        let g = &self.graph;
        let access = |tile| g.zone_at(tile).and_then(|z| g.zones[z].access);
        let (Some(from), Some(to)) = (access(self.parked[i].job), access(self.parked[i].home))
        else {
            self.parked.remove(i);
            self.counters.abandoned += 1;
            return Return::Abandoned;
        };
        self.counters.searches_in_last_tick += 1;
        let found = self.finder.find(g, &self.load.tile, from, to);
        let c = &mut self.counters;
        c.max_expansions = c.max_expansions.max(self.finder.last_expansions);
        let Some(path) = found else {
            c.failed_searches += 1;
            self.parked[i].failed += 1;
            if self.parked[i].failed < MAX_RETURN_FAILURES {
                return Return::Retry;
            }
            self.parked.remove(i);
            c.abandoned += 1;
            return Return::Abandoned;
        };
        c.max_path_len = c.max_path_len.max(path.len());
        let p = self.parked.remove(i);
        let car = Car {
            id: p.id,
            home: p.home,
            job: p.job,
            leg: Leg::Back,
            path,
            at: 0,
            progress: 0,
            born: self.ticks,
        };
        if car.arrived() {
            // the job and the home share their access road: already home
            land(&car, self.ticks, &mut self.parked, c);
        } else {
            self.cars.push(car);
        }
        Return::Left
    }

    /// Cars of the home zone `tile`, driving or parked.
    fn cars_of_home(&self, tile: u32) -> usize {
        let driving = self.cars.iter().filter(|c| c.home == tile).count();
        driving + self.parked.iter().filter(|p| p.home == tile).count()
    }

    /// One departure attempt: a random residential zone with room for a car, the nearest of a
    /// few random job zones, one bounded search.
    fn try_trip(&mut self) {
        let g = &self.graph;
        let home =
            &g.zones[g.residential[self.rng.below(g.residential.len() as u32) as usize] as usize];
        let (Some(from), true) = (
            home.access,
            self.cars_of_home(home.tile) < zone_car_cap(home.pop),
        ) else {
            return;
        };
        let mut best: Option<(u32, u32, u32)> = None;
        for _ in 0..DEST_SAMPLES {
            let job = &g.zones[g.jobs[self.rng.below(g.jobs.len() as u32) as usize] as usize];
            let Some(to) = job.access else { continue };
            let d = manhattan(g, from, to);
            if best.is_none_or(|(bd, ..)| d < bd) {
                best = Some((d, to, job.tile));
            }
        }
        let Some((_, to, job)) = best else { return };
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
                    job,
                    leg: Leg::Out,
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
}
