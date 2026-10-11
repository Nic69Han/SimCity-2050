//! Port of the `Map<DATA, BLKSIZE>` template from `map_type.h`.
//!
//! A map covers a `world_w` x `world_h` world, but stores one value per
//! `block` x `block` cluster of world tiles. Data is column-major
//! (`x * height + y`) exactly like the original.
//!
//! Dimensions are runtime values (the C++ version hard-codes 120x100), which
//! is what makes much larger cities possible.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Map<T: Copy> {
    world_w: i32,
    world_h: i32,
    block: i32,
    w: i32, // clusters horizontally
    h: i32, // clusters vertically
    default: T,
    data: Vec<T>,
}

impl<T: Copy> Map<T> {
    pub fn new(world_w: i32, world_h: i32, block: i32, default: T) -> Self {
        assert!(world_w > 0 && world_h > 0 && block > 0, "invalid map size");
        let w = (world_w + block - 1) / block;
        let h = (world_h + block - 1) / block;
        Self {
            world_w,
            world_h,
            block,
            w,
            h,
            default,
            data: vec![default; (w as usize) * (h as usize)],
        }
    }

    /// Number of clusters horizontally / vertically.
    pub fn size(&self) -> (i32, i32) {
        (self.w, self.h)
    }

    pub fn block_size(&self) -> i32 {
        self.block
    }

    pub fn fill(&mut self, v: T) {
        self.data.fill(v);
    }

    pub fn clear(&mut self) {
        let d = self.default;
        self.fill(d);
    }

    pub fn on_map(&self, x: i32, y: i32) -> bool {
        x >= 0 && x < self.w && y >= 0 && y < self.h
    }

    pub fn world_on_map(&self, x: i32, y: i32) -> bool {
        x >= 0 && x < self.world_w && y >= 0 && y < self.world_h
    }

    #[inline]
    fn index(&self, x: i32, y: i32) -> usize {
        (x as usize) * (self.h as usize) + (y as usize)
    }

    /// Cluster coordinates. Out of range reads return the default value.
    pub fn get(&self, x: i32, y: i32) -> T {
        if self.on_map(x, y) {
            self.data[self.index(x, y)]
        } else {
            self.default
        }
    }

    /// Cluster coordinates. Out of range writes are ignored.
    pub fn set(&mut self, x: i32, y: i32, v: T) {
        if self.on_map(x, y) {
            let i = self.index(x, y);
            self.data[i] = v;
        }
    }

    /// World coordinates (divided by the block size).
    pub fn world_get(&self, x: i32, y: i32) -> T {
        if self.world_on_map(x, y) {
            self.data[self.index(x / self.block, y / self.block)]
        } else {
            self.default
        }
    }

    pub fn world_set(&mut self, x: i32, y: i32, v: T) {
        if self.world_on_map(x, y) {
            let i = self.index(x / self.block, y / self.block);
            self.data[i] = v;
        }
    }

    /// Raw column-major data, for serialisation.
    pub fn as_slice(&self) -> &[T] {
        &self.data
    }

    pub fn as_mut_slice(&mut self) -> &mut [T] {
        &mut self.data
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DEFAULT_WORLD_H, DEFAULT_WORLD_W};

    #[test]
    fn cluster_sizes_match_original_dimensions() {
        // Values taken from the C++ templates for 120x100.
        let m1 = Map::<u8>::new(DEFAULT_WORLD_W, DEFAULT_WORLD_H, 1, 0);
        let m2 = Map::<u8>::new(DEFAULT_WORLD_W, DEFAULT_WORLD_H, 2, 0);
        let m4 = Map::<u8>::new(DEFAULT_WORLD_W, DEFAULT_WORLD_H, 4, 0);
        let m8 = Map::<i16>::new(DEFAULT_WORLD_W, DEFAULT_WORLD_H, 8, 0);
        assert_eq!(m1.size(), (120, 100));
        assert_eq!(m2.size(), (60, 50));
        assert_eq!(m4.size(), (30, 25));
        assert_eq!(m8.size(), (15, 13)); // (100 + 7) / 8 = 13
    }

    #[test]
    fn out_of_range_is_default_and_ignored() {
        let mut m = Map::<i16>::new(120, 100, 8, -1);
        m.set(99, 99, 5);
        assert_eq!(m.get(99, 99), -1);
        assert_eq!(m.get(-1, 0), -1);
        m.world_set(500, 5, 9);
        assert_eq!(m.world_get(500, 5), -1);
    }

    #[test]
    fn world_coordinates_share_a_cluster() {
        let mut m = Map::<u8>::new(120, 100, 4, 0);
        m.world_set(9, 9, 7);
        for (x, y) in [(8, 8), (11, 11), (8, 11), (11, 8)] {
            assert_eq!(m.world_get(x, y), 7);
        }
        assert_eq!(m.world_get(12, 8), 0);
        assert_eq!(m.get(2, 2), 7);
    }

    #[test]
    fn storage_is_column_major() {
        let mut m = Map::<u8>::new(4, 3, 1, 0);
        m.set(1, 2, 42);
        assert_eq!(m.as_slice()[1 * 3 + 2], 42);
    }

    #[test]
    fn clear_restores_default() {
        let mut m = Map::<u8>::new(10, 10, 1, 3);
        m.fill(9);
        m.clear();
        assert!(m.as_slice().iter().all(|&v| v == 3));
    }

    #[test]
    fn handles_fifty_times_larger_world() {
        // 50x the area of 120x100 is ~600k tiles; check 850x700 works.
        let mut m = Map::<u16>::new(850, 700, 1, 0);
        m.set(849, 699, 1);
        assert_eq!(m.get(849, 699), 1);
        assert_eq!(m.as_slice().len(), 850 * 700);
    }
}
