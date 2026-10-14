//! Terrain relief: one altitude per tile, a data layer of the engine (docs/3d.md, section 2).
//!
//! Micropolis has no altitude; this layer adds one without touching the simulation rules.
//! The altitude is 0..=[`MAX_HEIGHT`] and water is always at [`SEA_LEVEL`]. Land rises with
//! its distance from water (a Chebyshev distance field), plus two octaves of value noise.
//! A final slope pass keeps neighbouring tiles within [`MAX_SLOPE`] of each other.
//!
//! Everything here is integer arithmetic on the map and a seed. The noise is a local hash,
//! not the simulation's [`Rng`](crate::rng::Rng): generating the relief consumes no random
//! number and changes no state of the simulation. The same map and seed always give the same
//! heights, on every platform.
//!
//! Layout: column-major like the tile map (`x * height + y`), so `heights[i]` is the altitude
//! of `tiles[i]`.

use crate::tile::{character, Tile};
use crate::tile_chars::{WATER_HIGH, WATER_LOW};

/// Altitude of water, and of the sea. Land is always above it.
pub const SEA_LEVEL: u8 = 8;
/// Highest altitude.
pub const MAX_HEIGHT: u8 = 63;
/// Largest altitude difference between two neighbouring tiles, where the map allows it.
pub const MAX_SLOPE: i32 = 3;

/// Distance from water beyond which land no longer rises.
const DISTANCE_CAP: i32 = 24;
/// Value-noise octaves: (lattice cell in tiles, amplitude in altitude units).
const NOISE_OCTAVES: [(i32, i32); 2] = [(16, 20), (6, 6)];
/// Upper bound on the slope pass sweeps. The pass converges well before this.
const MAX_SWEEPS: usize = 256;

/// Altitude of every tile of a map, column-major like the tile map.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relief {
    width: i32,
    height: i32,
    heights: Vec<u8>,
}

impl Relief {
    /// Relief of the `width` x `height` map whose tiles are `tiles` (column-major,
    /// `x * height + y`), for `seed`. Panics if `tiles` does not have `width * height` entries.
    pub fn generate(tiles: &[Tile], width: i32, height: i32, seed: i32) -> Relief {
        assert!(width > 0 && height > 0, "invalid map size");
        assert_eq!(
            tiles.len(),
            (width as usize) * (height as usize),
            "tiles/size mismatch"
        );
        let water: Vec<bool> = tiles.iter().map(|&t| is_water(t)).collect();
        let distance = water_distance(&water, width, height);

        let mut h: Vec<i32> = vec![i32::from(SEA_LEVEL); water.len()];
        for x in 0..width {
            for y in 0..height {
                let i = index(x, y, height);
                if water[i] {
                    continue;
                }
                let rise = distance[i].min(DISTANCE_CAP);
                let noise: i32 = NOISE_OCTAVES
                    .iter()
                    .enumerate()
                    .map(|(octave, &(cell, amp))| {
                        value_noise(seed, octave as u64, x, y, cell) * amp / 255
                    })
                    .sum();
                h[i] = i32::from(SEA_LEVEL) + rise + noise;
            }
        }
        limit_slope(&mut h, &water, width, height);

        let heights = h
            .into_iter()
            .map(|v| v.clamp(i32::from(SEA_LEVEL) + 1, i32::from(MAX_HEIGHT)) as u8)
            .collect::<Vec<u8>>();
        // Water keeps exactly the sea level, whatever the land around it does.
        let heights = heights
            .into_iter()
            .zip(&water)
            .map(|(v, &w)| if w { SEA_LEVEL } else { v })
            .collect();
        Relief {
            width,
            height,
            heights,
        }
    }

    pub fn width(&self) -> i32 {
        self.width
    }

    pub fn height(&self) -> i32 {
        self.height
    }

    /// Altitude of the tile at `(x, y)`; `None` when `(x, y)` is off the map.
    pub fn height_at(&self, x: i32, y: i32) -> Option<u8> {
        if (0..self.width).contains(&x) && (0..self.height).contains(&y) {
            Some(self.heights[index(x, y, self.height)])
        } else {
            None
        }
    }

    /// Altitudes, column-major (`x * height + y`), one per tile.
    pub fn as_slice(&self) -> &[u8] {
        &self.heights
    }

    /// A relief from raw altitudes (a loaded file). `None` when the size does not match or an
    /// altitude is above `MAX_HEIGHT`.
    pub fn from_raw(width: i32, height: i32, heights: Vec<u8>) -> Option<Relief> {
        let valid = width > 0
            && height > 0
            && heights.len() == (width as usize) * (height as usize)
            && heights.iter().all(|&v| v <= MAX_HEIGHT);
        valid.then_some(Relief {
            width,
            height,
            heights,
        })
    }

    /// Sets the altitude at `(x, y)`, clamped to `0..=MAX_HEIGHT`. Returns false when off the map.
    pub fn set_height_at(&mut self, x: i32, y: i32, value: u8) -> bool {
        if (0..self.width).contains(&x) && (0..self.height).contains(&y) {
            self.heights[index(x, y, self.height)] = value.min(MAX_HEIGHT);
            true
        } else {
            false
        }
    }
}

/// Whether a tile is water: river, river edge, channel (the `WATER_LOW..=WATER_HIGH` range).
pub(crate) fn is_water(tile: Tile) -> bool {
    (WATER_LOW..=WATER_HIGH).contains(&character(tile))
}

fn index(x: i32, y: i32, height: i32) -> usize {
    (x as usize) * (height as usize) + (y as usize)
}

/// Chebyshev (8-neighbour) distance of every tile to the nearest water tile, by breadth-first
/// search. Without any water every distance is `DISTANCE_CAP`, so the land stays high.
fn water_distance(water: &[bool], width: i32, height: i32) -> Vec<i32> {
    const UNSET: i32 = i32::MAX;
    let mut dist = vec![UNSET; water.len()];
    let mut queue: Vec<usize> = Vec::new();
    for (i, &w) in water.iter().enumerate() {
        if w {
            dist[i] = 0;
            queue.push(i);
        }
    }
    if queue.is_empty() {
        return vec![DISTANCE_CAP; water.len()];
    }
    let mut head = 0;
    while head < queue.len() {
        let i = queue[head];
        head += 1;
        let (x, y) = ((i / height as usize) as i32, (i % height as usize) as i32);
        for dx in -1..=1 {
            for dy in -1..=1 {
                let (nx, ny) = (x + dx, y + dy);
                if (0..width).contains(&nx) && (0..height).contains(&ny) {
                    let j = index(nx, ny, height);
                    if dist[j] == UNSET {
                        dist[j] = dist[i] + 1;
                        queue.push(j);
                    }
                }
            }
        }
    }
    dist
}

/// Integer hash of a lattice point, 0..=255. A splitmix-style finaliser: no state, no `Rng`.
fn lattice(seed: i32, octave: u64, gx: i32, gy: i32) -> i32 {
    let mut k =
        (seed as u32 as u64) ^ (octave << 56) ^ ((gx as u32 as u64) << 32) ^ (gy as u32 as u64);
    k = k.wrapping_add(0x9e37_79b9_7f4a_7c15);
    k = (k ^ (k >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    k = (k ^ (k >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    k ^= k >> 31;
    (k & 0xff) as i32
}

/// Bilinear value noise at `(x, y)` with lattice spacing `cell`, 0..=255. Only integer
/// arithmetic, so the result is exact and the same everywhere.
fn value_noise(seed: i32, octave: u64, x: i32, y: i32, cell: i32) -> i32 {
    let (gx, fx) = (x / cell, x % cell);
    let (gy, fy) = (y / cell, y % cell);
    let v00 = lattice(seed, octave, gx, gy);
    let v10 = lattice(seed, octave, gx + 1, gy);
    let v01 = lattice(seed, octave, gx, gy + 1);
    let v11 = lattice(seed, octave, gx + 1, gy + 1);
    let top = v00 * (cell - fx) + v10 * fx;
    let bottom = v01 * (cell - fx) + v11 * fx;
    (top * (cell - fy) + bottom * fy) / (cell * cell)
}

/// Lowers land tiles until no land tile is more than [`MAX_SLOPE`] above a neighbour. Only
/// lowers, never below `SEA_LEVEL + 1`, so it terminates. Water tiles are fixed.
fn limit_slope(h: &mut [i32], water: &[bool], width: i32, height: i32) {
    let floor = i32::from(SEA_LEVEL) + 1;
    for _ in 0..MAX_SWEEPS {
        let mut changed = false;
        for x in 0..width {
            for y in 0..height {
                let i = index(x, y, height);
                if water[i] {
                    continue;
                }
                let mut ceiling = i32::MAX;
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        let (nx, ny) = (x + dx, y + dy);
                        if (dx, dy) != (0, 0)
                            && (0..width).contains(&nx)
                            && (0..height).contains(&ny)
                        {
                            ceiling = ceiling.min(h[index(nx, ny, height)] + MAX_SLOPE);
                        }
                    }
                }
                let v = h[i].min(ceiling).max(floor);
                if v != h[i] {
                    h[i] = v;
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile_chars::{CHANNEL, DIRT, RIVER, WOODS};

    /// A `w` x `h` map of dirt with a river column at `x = river_x` and a 5x5 lake.
    fn map_with_water(w: i32, h: i32, river_x: i32) -> Vec<Tile> {
        let mut tiles = vec![DIRT; (w * h) as usize];
        for x in 0..w {
            for y in 0..h {
                let i = index(x, y, h);
                if x == river_x {
                    tiles[i] = RIVER;
                } else if (2..7).contains(&x) && (2..7).contains(&y) {
                    tiles[i] = CHANNEL;
                } else if (x + y) % 3 == 0 {
                    tiles[i] = WOODS;
                }
            }
        }
        tiles
    }

    fn sample() -> (Vec<Tile>, i32, i32) {
        (map_with_water(64, 48, 40), 64, 48)
    }

    #[test]
    fn same_map_and_seed_give_the_same_relief() {
        let (tiles, w, h) = sample();
        let a = Relief::generate(&tiles, w, h, 7);
        let b = Relief::generate(&tiles, w, h, 7);
        assert_eq!(a, b);
    }

    #[test]
    fn water_is_exactly_sea_level() {
        let (tiles, w, h) = sample();
        let r = Relief::generate(&tiles, w, h, 3);
        for (i, &t) in tiles.iter().enumerate() {
            if is_water(t) {
                assert_eq!(r.as_slice()[i], SEA_LEVEL, "water tile {i}");
            }
        }
    }

    #[test]
    fn land_is_above_sea_and_within_bounds() {
        for seed in [0, 1, -5, 1234] {
            let (tiles, w, h) = sample();
            let r = Relief::generate(&tiles, w, h, seed);
            for (i, &t) in tiles.iter().enumerate() {
                let v = r.as_slice()[i];
                assert!(v <= MAX_HEIGHT, "seed {seed}: {v} above max");
                if !is_water(t) {
                    assert!(v > SEA_LEVEL, "seed {seed}: land tile {i} at sea level");
                }
            }
        }
    }

    #[test]
    fn neighbouring_tiles_differ_by_at_most_the_slope_bound() {
        let (tiles, w, h) = sample();
        let r = Relief::generate(&tiles, w, h, 11);
        for x in 0..w {
            for y in 0..h {
                let v = i32::from(r.height_at(x, y).unwrap());
                for (dx, dy) in [(1, 0), (0, 1), (1, 1), (1, -1)] {
                    if let Some(n) = r.height_at(x + dx, y + dy) {
                        assert!(
                            (v - i32::from(n)).abs() <= MAX_SLOPE,
                            "({x},{y}) vs ({},{}): {v} / {n}",
                            x + dx,
                            y + dy
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn different_seeds_give_different_relief() {
        let (tiles, w, h) = sample();
        let a = Relief::generate(&tiles, w, h, 1);
        let b = Relief::generate(&tiles, w, h, 2);
        assert_ne!(a.as_slice(), b.as_slice());
    }

    #[test]
    fn size_matches_the_map_and_access_is_bounded() {
        let (tiles, w, h) = sample();
        let r = Relief::generate(&tiles, w, h, 0);
        assert_eq!((r.width(), r.height()), (w, h));
        assert_eq!(r.as_slice().len(), tiles.len());
        assert!(r.height_at(0, 0).is_some());
        assert!(r.height_at(w - 1, h - 1).is_some());
        assert_eq!(r.height_at(w, 0), None);
        assert_eq!(r.height_at(0, -1), None);
    }

    #[test]
    fn land_rises_with_distance_from_water() {
        // One river column: the tiles far from it are higher on average than the ones next to it.
        let (w, h) = (80, 40);
        let tiles = map_with_water(w, h, 0);
        let r = Relief::generate(&tiles, w, h, 5);
        let near = r.height_at(1, 20).unwrap();
        let far = r.height_at(30, 20).unwrap();
        assert!(far > near, "near {near}, far {far}");
    }

    #[test]
    fn map_without_water_is_all_land_above_sea() {
        let (w, h) = (20, 20);
        let tiles = vec![DIRT; 400];
        let r = Relief::generate(&tiles, w, h, 9);
        assert!(r
            .as_slice()
            .iter()
            .all(|&v| v > SEA_LEVEL && v <= MAX_HEIGHT));
    }
}
