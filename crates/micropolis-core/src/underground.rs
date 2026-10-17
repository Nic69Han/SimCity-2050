//! An underground layer: one byte per tile, below the city (water pipes, metro tunnels).
//!
//! Like the tile map it is column-major (`x * height + y`), so `as_slice()[i]` belongs to
//! `tiles[i]`. The meaning of a byte is up to the feature that owns the layer; 0 always means
//! "nothing here". A layer that holds nothing owns no memory: it is allocated by the first
//! non-zero write, so a city that never uses it pays nothing and saves nothing.

/// One byte per tile of a `width` x `height` map, all zero until written.
#[derive(Debug, Clone)]
pub struct UndergroundLayer {
    width: i32,
    height: i32,
    /// Empty (not yet written) or exactly `width * height` bytes.
    cells: Vec<u8>,
}

impl UndergroundLayer {
    /// An empty layer for a `width` x `height` map. Panics on a map without area.
    pub fn new(width: i32, height: i32) -> UndergroundLayer {
        assert!(width > 0 && height > 0, "invalid layer size");
        UndergroundLayer {
            width,
            height,
            cells: Vec::new(),
        }
    }

    /// A layer from raw bytes (a loaded file): no byte at all is an empty layer, otherwise
    /// exactly `width * height` bytes. `None` for any other length or an invalid size.
    pub fn from_raw(width: i32, height: i32, bytes: &[u8]) -> Option<UndergroundLayer> {
        if width <= 0 || height <= 0 {
            return None;
        }
        let n = (width as usize) * (height as usize);
        if !bytes.is_empty() && bytes.len() != n {
            return None;
        }
        Some(UndergroundLayer {
            width,
            height,
            cells: bytes.to_vec(),
        })
    }

    pub fn width(&self) -> i32 {
        self.width
    }

    pub fn height(&self) -> i32 {
        self.height
    }

    fn contains(&self, x: i32, y: i32) -> bool {
        (0..self.width).contains(&x) && (0..self.height).contains(&y)
    }

    fn index(&self, x: i32, y: i32) -> usize {
        (x as usize) * (self.height as usize) + (y as usize)
    }

    /// The byte at `(x, y)`; 0 when nothing was written there or `(x, y)` is off the map.
    pub fn get(&self, x: i32, y: i32) -> u8 {
        if self.cells.is_empty() || !self.contains(x, y) {
            return 0;
        }
        self.cells[self.index(x, y)]
    }

    /// Writes `value` at `(x, y)`. Returns false, changing nothing, when `(x, y)` is off the map.
    /// Writing 0 to a layer that was never written allocates nothing.
    pub fn set(&mut self, x: i32, y: i32, value: u8) -> bool {
        if !self.contains(x, y) {
            return false;
        }
        if self.cells.is_empty() {
            if value == 0 {
                return true;
            }
            self.cells = vec![0; (self.width as usize) * (self.height as usize)];
        }
        let i = self.index(x, y);
        self.cells[i] = value;
        true
    }

    /// Whether every byte is 0.
    pub fn is_empty(&self) -> bool {
        self.cells.iter().all(|&c| c == 0)
    }

    /// Number of non-zero bytes.
    pub fn count(&self) -> usize {
        self.cells.iter().filter(|&&c| c != 0).count()
    }

    /// Back to nothing, freeing the memory.
    pub fn clear(&mut self) {
        self.cells = Vec::new();
    }

    /// The bytes, column-major: empty for a layer that was never written, else one per tile.
    pub fn as_slice(&self) -> &[u8] {
        &self.cells
    }

    /// The bytes a file stores: nothing for an empty layer, else one per tile.
    pub fn encode(&self) -> Vec<u8> {
        if self.is_empty() {
            Vec::new()
        } else {
            self.cells.clone()
        }
    }
}

impl PartialEq for UndergroundLayer {
    /// Same size and same bytes, an unwritten layer being equal to a layer of zeros.
    fn eq(&self, other: &Self) -> bool {
        if self.width != other.width || self.height != other.height {
            return false;
        }
        if self.cells.len() == other.cells.len() {
            return self.cells == other.cells;
        }
        self.is_empty() && other.is_empty()
    }
}

impl Eq for UndergroundLayer {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_layer_is_empty_and_owns_no_memory() {
        let l = UndergroundLayer::new(10, 7);
        assert!(l.is_empty());
        assert_eq!(l.count(), 0);
        assert_eq!(l.as_slice().len(), 0);
        assert_eq!(l.get(3, 3), 0);
        assert!(l.encode().is_empty());
    }

    #[test]
    fn writing_zero_allocates_nothing_and_writing_a_value_allocates_once() {
        let mut l = UndergroundLayer::new(10, 7);
        assert!(l.set(2, 2, 0));
        assert_eq!(l.as_slice().len(), 0);
        assert!(l.set(2, 3, 9));
        assert_eq!(l.as_slice().len(), 70);
        assert_eq!(l.get(2, 3), 9);
        assert_eq!(l.count(), 1);
        assert!(!l.is_empty());
    }

    #[test]
    fn the_order_is_column_major_like_the_tiles() {
        let mut l = UndergroundLayer::new(10, 7);
        l.set(3, 5, 42);
        assert_eq!(l.as_slice()[3 * 7 + 5], 42);
    }

    #[test]
    fn off_the_map_reads_zero_and_refuses_writes() {
        let mut l = UndergroundLayer::new(10, 7);
        for (x, y) in [(-1, 0), (0, -1), (10, 0), (0, 7)] {
            assert!(!l.set(x, y, 1), "({x}, {y})");
            assert_eq!(l.get(x, y), 0);
        }
        assert!(l.is_empty());
    }

    #[test]
    fn clear_empties_and_frees() {
        let mut l = UndergroundLayer::new(10, 7);
        l.set(1, 1, 5);
        l.clear();
        assert!(l.is_empty());
        assert_eq!(l.as_slice().len(), 0);
    }

    #[test]
    fn encode_and_from_raw_round_trip() {
        let mut l = UndergroundLayer::new(10, 7);
        l.set(9, 6, 200);
        l.set(0, 0, 1);
        let bytes = l.encode();
        assert_eq!(bytes.len(), 70);
        let back = UndergroundLayer::from_raw(10, 7, &bytes).unwrap();
        assert_eq!(back, l);
        assert_eq!(back.encode(), bytes);
        assert_eq!(
            UndergroundLayer::from_raw(10, 7, &[]).unwrap(),
            UndergroundLayer::new(10, 7)
        );
    }

    #[test]
    fn from_raw_refuses_a_wrong_length_or_size() {
        assert!(UndergroundLayer::from_raw(10, 7, &[0; 69]).is_none());
        assert!(UndergroundLayer::from_raw(10, 7, &[0; 71]).is_none());
        assert!(UndergroundLayer::from_raw(0, 7, &[]).is_none());
    }

    #[test]
    fn an_unwritten_layer_equals_a_layer_of_zeros() {
        let mut a = UndergroundLayer::new(10, 7);
        a.set(1, 1, 3);
        a.set(1, 1, 0);
        assert_eq!(a, UndergroundLayer::new(10, 7));
        assert_ne!(a, UndergroundLayer::new(7, 10));
        a.set(2, 2, 1);
        assert_ne!(a, UndergroundLayer::new(10, 7));
    }
}
