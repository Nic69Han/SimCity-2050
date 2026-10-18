//! Bounded A* over the road graph. Costs are integers: a step costs [`STEP_COST`] plus a
//! penalty that grows with the measured load of the tile, so drivers go round jams. The search
//! is capped by [`MAX_EXPANSIONS`] pops and the answer by [`MAX_PATH_LEN`] tiles; a search that
//! hits a cap answers `None`.

use super::graph::RoadGraph;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Cost of one tile step.
pub const STEP_COST: u32 = 10;
/// A tile at load 255 costs `255 / LOAD_COST_DIV` more.
pub const LOAD_COST_DIV: u32 = 8;
/// Most nodes one search may pop from its open list.
pub const MAX_EXPANSIONS: usize = 2048;
/// Longest path (tiles, ends included) a search may return.
pub const MAX_PATH_LEN: usize = 256;

/// Reusable scratch memory of the searches (stamped, so nothing is cleared between searches).
#[derive(Debug, Clone, Default)]
pub struct PathFinder {
    stamp: Vec<u32>,
    generation: u32,
    cost: Vec<u32>,
    parent: Vec<u32>,
    open: BinaryHeap<Reverse<(u32, u32, u32)>>,
    /// Pops of the last search (for the cap tests).
    pub last_expansions: usize,
}

fn distance(g: &RoadGraph, a: u32, b: u32) -> u32 {
    let ((ax, ay), (bx, by)) = (g.xy(a), g.xy(b));
    ((ax - bx).unsigned_abs() + (ay - by).unsigned_abs()) * STEP_COST
}

impl PathFinder {
    fn reset(&mut self, nodes: usize) {
        if self.stamp.len() != nodes {
            self.stamp = vec![0; nodes];
            self.cost = vec![0; nodes];
            self.parent = vec![0; nodes];
            self.generation = 0;
        }
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.stamp.fill(0);
            self.generation = 1;
        }
        self.open.clear();
        self.last_expansions = 0;
    }

    fn known_cost(&self, i: u32) -> Option<u32> {
        (self.stamp[i as usize] == self.generation).then(|| self.cost[i as usize])
    }

    /// The cheapest path from road tile `from` to road tile `to` (both included), or `None`.
    pub fn find(&mut self, g: &RoadGraph, load: &[u8], from: u32, to: u32) -> Option<Vec<u32>> {
        if !g.is_road(from) || !g.is_road(to) {
            return None;
        }
        self.reset(g.class_len());
        self.stamp[from as usize] = self.generation;
        self.cost[from as usize] = 0;
        self.parent[from as usize] = from;
        self.open.push(Reverse((distance(g, from, to), 0, from)));
        while let Some(Reverse((_, spent, at))) = self.open.pop() {
            if self.known_cost(at) != Some(spent) {
                continue; // a cheaper way to `at` was found since
            }
            if at == to {
                return self.rebuild(from, to);
            }
            self.last_expansions += 1;
            if self.last_expansions > MAX_EXPANSIONS {
                return None;
            }
            for n in g.road_neighbours(at).into_iter().flatten() {
                let l = u32::from(load.get(n as usize).copied().unwrap_or(0));
                let c = spent + STEP_COST + l / LOAD_COST_DIV;
                if self.known_cost(n).is_none_or(|k| c < k) {
                    self.stamp[n as usize] = self.generation;
                    self.cost[n as usize] = c;
                    self.parent[n as usize] = at;
                    self.open.push(Reverse((c + distance(g, n, to), c, n)));
                }
            }
        }
        None
    }

    fn rebuild(&self, from: u32, to: u32) -> Option<Vec<u32>> {
        let mut path = vec![to];
        let mut at = to;
        // at most MAX_PATH_LEN - 1 steps back: a longer path is refused
        for _ in 1..MAX_PATH_LEN {
            if at == from {
                break;
            }
            at = self.parent[at as usize];
            path.push(at);
        }
        if at != from {
            return None;
        }
        path.reverse();
        Some(path)
    }
}
