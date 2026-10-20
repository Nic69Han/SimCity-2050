//! One tick of the rail: riders give up, vehicles leave the first stop of their line, every
//! vehicle moves and serves its stops.

use super::shuttle::Shuttle;
use super::{LineKind, Rail};
use crate::agents::transport::riders::{Rider, TransportCounters};
use crate::agents::transport::MAX_WAIT_TICKS;

impl Rail {
    /// Riders who have waited more than [`MAX_WAIT_TICKS`] give up.
    pub fn expire(&mut self, now: u64, counters: &mut TransportCounters) {
        let alive = |r: &Rider| now - r.born <= MAX_WAIT_TICKS;
        let before = self.waiting();
        self.queues
            .iter_mut()
            .flatten()
            .for_each(|q| q.retain(alive));
        counters.abandoned += (before - self.waiting()) as u64;
    }

    /// Advances the rail one tick at transport time `now`; `next_id` numbers the new vehicles.
    pub fn step(&mut self, now: u64, next_id: &mut u32, counters: &mut TransportCounters) {
        let Rail {
            lines,
            queues,
            shuttles,
            next_spawn,
            ..
        } = self;
        for (l, line) in lines.iter().enumerate() {
            let p = line.kind.params();
            let out = shuttles.iter().filter(|s| s.line == l).count();
            if now < next_spawn[l] || out >= p.per_line {
                continue;
            }
            let mut s = Shuttle::new(*next_id, l);
            *next_id += 1;
            s.serve(
                line,
                &mut queues[l],
                counters,
                (p.capacity, p.dwell, p.fare),
            );
            shuttles.push(s);
            next_spawn[l] = now + p.spawn_interval;
        }
        for s in shuttles.iter_mut() {
            let line = &lines[s.line];
            let p = line.kind.params();
            if s.advance(line, p.speed) {
                s.serve(
                    line,
                    &mut queues[s.line],
                    counters,
                    (p.capacity, p.dwell, p.fare),
                );
            }
        }
    }

    /// Vehicles of one kind on the road.
    pub fn count(&self, kind: LineKind) -> usize {
        let of_kind = |s: &&Shuttle| self.lines[s.line].kind == kind;
        self.shuttles.iter().filter(of_kind).count()
    }
}
