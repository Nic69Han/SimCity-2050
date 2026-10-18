//! The measured load: how many cars sit on each road tile, smoothed over a few ticks.

use super::graph::RoadGraph;

/// Load added by one car standing on a tile (4 cars fill a tile).
pub const LOAD_PER_CAR: i32 = 64;
/// A tile at or above this load is saturated.
pub const SATURATED_LOAD: u8 = 160;
/// The load moves by `1 / LOAD_SMOOTHING` of the gap each tick.
pub const LOAD_SMOOTHING: i32 = 4;

#[derive(Debug, Clone, Default)]
pub struct LoadMap {
    /// Load per tile (tile order), 0..=255.
    pub tile: Vec<u8>,
    /// Maximum load of the road tiles of each traffic-density block (`block_w * block_h`).
    pub block: Vec<u8>,
    occupancy: Vec<u8>,
    block_size: i32,
    block_h: i32,
    pub saturated: i32,
}

impl LoadMap {
    /// A map of `tiles` tiles whose density blocks are `block_size` wide and `block_w x block_h`.
    pub fn new(tiles: usize, block_size: i32, block_w: i32, block_h: i32) -> Self {
        LoadMap {
            tile: vec![0; tiles],
            block: vec![0; (block_w * block_h) as usize],
            occupancy: vec![0; tiles],
            block_size,
            block_h,
            saturated: 0,
        }
    }

    /// Counts the cars (`car_tiles`: the tile of each) and moves every road tile's load towards
    /// its target. One pass over the cars and one over the roads.
    pub fn update(&mut self, g: &RoadGraph, car_tiles: impl Iterator<Item = u32> + Clone) {
        for t in car_tiles.clone() {
            let o = &mut self.occupancy[t as usize];
            *o = o.saturating_add(1);
        }
        self.block.fill(0);
        self.saturated = 0;
        for &r in &g.roads {
            let target = (i32::from(self.occupancy[r as usize]) * LOAD_PER_CAR).min(255);
            let l = i32::from(self.tile[r as usize]);
            let step = ((target - l).abs() + LOAD_SMOOTHING - 1) / LOAD_SMOOTHING;
            let l = if target > l { l + step } else { l - step };
            self.tile[r as usize] = l as u8;
            self.saturated += i32::from(l as u8 >= SATURATED_LOAD);
            let (x, y) = g.xy(r);
            let b = ((x / self.block_size) * self.block_h + y / self.block_size) as usize;
            self.block[b] = self.block[b].max(l as u8);
        }
        for t in car_tiles {
            self.occupancy[t as usize] = 0;
        }
    }

    /// Load of the density block holding world tile `(x, y)`.
    pub fn block_load(&self, x: i32, y: i32) -> u8 {
        let b = (x / self.block_size) * self.block_h + y / self.block_size;
        usize::try_from(b)
            .ok()
            .and_then(|b| self.block.get(b).copied())
            .unwrap_or(0)
    }
}
