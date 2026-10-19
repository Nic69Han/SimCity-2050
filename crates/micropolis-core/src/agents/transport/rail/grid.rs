//! A grid of open tiles (the classic rails, or the working tunnels of the metro) and a bounded
//! A* over it. Tile indices are column-major, `x * height + y`, like the road graph and
//! `Simulation::tiles`, so a vehicle on a grid is reported with the same `vehicle_record`.

use crate::agents::graph::STEPS;
use crate::tile::{Tile, LASTRAIL, LOMASK, RAILBASE, RAILHPOWERV, RAILVPOWERH};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Most nodes one search may pop from its open list.
pub const MAX_RAIL_EXPANSIONS: usize = 4096;
/// Longest path (tiles, ends included) a search may return.
pub const MAX_RAIL_PATH_LEN: usize = 512;

/// Whether a tile character is a rail the classic engine lets a train run on: the rails and the
/// rail-road crossings (`RAILBASE..=LASTRAIL`) and the rails crossed by a wire (as `do_train_sprite`).
pub fn is_rail(tile: Tile) -> bool {
    let t = tile & LOMASK;
    (RAILBASE..=LASTRAIL).contains(&t) || t == RAILHPOWERV || t == RAILVPOWERH
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Grid {
    w: i32,
    h: i32,
    open: Vec<bool>,
}

impl Grid {
    pub fn new(w: i32, h: i32, open: Vec<bool>) -> Grid {
        Grid { w, h, open }
    }

    /// The tiles of `tiles` that `wanted` accepts are open.
    pub fn from_tiles(w: i32, h: i32, tiles: &[Tile], wanted: impl Fn(Tile) -> bool) -> Grid {
        Grid::new(w, h, tiles.iter().map(|&t| wanted(t)).collect())
    }

    pub fn tile_count(&self) -> usize {
        self.open.len()
    }

    pub fn is_open(&self, i: u32) -> bool {
        self.open.get(i as usize) == Some(&true)
    }

    pub fn xy(&self, i: u32) -> (i32, i32) {
        (i as i32 / self.h, i as i32 % self.h)
    }

    pub fn index(&self, x: i32, y: i32) -> Option<u32> {
        (x >= 0 && y >= 0 && x < self.w && y < self.h).then(|| (x * self.h + y) as u32)
    }

    /// The open neighbours of tile `i` (north, east, south, west order).
    pub fn neighbours(&self, i: u32) -> [Option<u32>; 4] {
        let (x, y) = self.xy(i);
        STEPS.map(|(dx, dy)| self.index(x + dx, y + dy).filter(|&n| self.is_open(n)))
    }

    /// Manhattan distance in tiles.
    pub fn distance(&self, a: u32, b: u32) -> u32 {
        let ((ax, ay), (bx, by)) = (self.xy(a), self.xy(b));
        (ax - bx).unsigned_abs() + (ay - by).unsigned_abs()
    }
}

/// Reusable scratch memory of the searches (stamped, nothing is cleared between searches).
#[derive(Debug, Clone, Default)]
pub struct GridFinder {
    stamp: Vec<u32>,
    generation: u32,
    cost: Vec<u32>,
    parent: Vec<u32>,
    open: BinaryHeap<Reverse<(u32, u32, u32)>>,
    /// Pops of the last search (for the cap tests).
    pub last_expansions: usize,
}

impl GridFinder {
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

    fn known(&self, i: u32) -> Option<u32> {
        (self.stamp[i as usize] == self.generation).then(|| self.cost[i as usize])
    }

    /// The shortest path from open tile `from` to open tile `to` (both included), or `None`
    /// (no way, or a cap: [`MAX_RAIL_EXPANSIONS`] pops, [`MAX_RAIL_PATH_LEN`] tiles).
    pub fn find(&mut self, g: &Grid, from: u32, to: u32) -> Option<Vec<u32>> {
        if !g.is_open(from) || !g.is_open(to) {
            return None;
        }
        self.reset(g.tile_count());
        self.stamp[from as usize] = self.generation;
        self.cost[from as usize] = 0;
        self.parent[from as usize] = from;
        self.open.push(Reverse((g.distance(from, to), 0, from)));
        while let Some(Reverse((_, spent, at))) = self.open.pop() {
            if self.known(at) != Some(spent) {
                continue;
            }
            if at == to {
                return self.rebuild(from, to);
            }
            self.last_expansions += 1;
            if self.last_expansions > MAX_RAIL_EXPANSIONS {
                return None;
            }
            for n in g.neighbours(at).into_iter().flatten() {
                let c = spent + 1;
                if self.known(n).is_none_or(|k| c < k) {
                    self.stamp[n as usize] = self.generation;
                    self.cost[n as usize] = c;
                    self.parent[n as usize] = at;
                    self.open.push(Reverse((c + g.distance(n, to), c, n)));
                }
            }
        }
        None
    }

    fn rebuild(&self, from: u32, to: u32) -> Option<Vec<u32>> {
        let mut path = vec![to];
        let mut at = to;
        // at most MAX_RAIL_PATH_LEN - 1 steps back: a longer path is refused
        for _ in 1..MAX_RAIL_PATH_LEN {
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
