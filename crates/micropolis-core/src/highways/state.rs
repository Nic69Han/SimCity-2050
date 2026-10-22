//! The highway tiles of a city: a sorted list, and its file format (chunk 13).

use super::{CHUNK_COUNT_SIZE, CHUNK_TILE_SIZE, MAX_HIGHWAY_TILES};

/// The highway tiles, sorted by `(x, y)`, no duplicate, at most [`MAX_HIGHWAY_TILES`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HighwayList {
    tiles: Vec<(u16, u16)>,
}

fn key(x: i32, y: i32) -> Option<(u16, u16)> {
    Some((u16::try_from(x).ok()?, u16::try_from(y).ok()?))
}

impl HighwayList {
    pub fn is_empty(&self) -> bool {
        self.tiles.is_empty()
    }

    pub fn len(&self) -> usize {
        self.tiles.len()
    }

    /// The tiles in `(x, y)` order.
    pub fn as_slice(&self) -> &[(u16, u16)] {
        &self.tiles
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        key(x, y).is_some_and(|k| self.tiles.binary_search(&k).is_ok())
    }

    /// Adds `(x, y)`; false when it is already there, off the `u16` range or the list is full.
    pub fn insert(&mut self, x: i32, y: i32) -> bool {
        let Some(k) = key(x, y) else { return false };
        match self.tiles.binary_search(&k) {
            Ok(_) => false,
            Err(_) if self.tiles.len() >= MAX_HIGHWAY_TILES => false,
            Err(at) => {
                self.tiles.insert(at, k);
                true
            }
        }
    }

    /// Removes `(x, y)`; false when it was not there.
    pub fn remove(&mut self, x: i32, y: i32) -> bool {
        match key(x, y).map(|k| self.tiles.binary_search(&k)) {
            Some(Ok(at)) => {
                self.tiles.remove(at);
                true
            }
            _ => false,
        }
    }

    /// Keeps the tiles `keep` accepts.
    pub fn retain(&mut self, mut keep: impl FnMut(i32, i32) -> bool) {
        self.tiles
            .retain(|&(x, y)| keep(i32::from(x), i32::from(y)));
    }

    /// The bytes of chunk 13; nothing for an empty list.
    pub fn encode(&self) -> Vec<u8> {
        if self.tiles.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(CHUNK_COUNT_SIZE + CHUNK_TILE_SIZE * self.tiles.len());
        out.extend_from_slice(&(self.tiles.len() as u16).to_be_bytes());
        for &(x, y) in &self.tiles {
            out.extend_from_slice(&x.to_be_bytes());
            out.extend_from_slice(&y.to_be_bytes());
        }
        out
    }

    /// The list stored in `bytes` for a `width` x `height` map. Refused: a length that does not
    /// match the count, an empty list (never written), more than [`MAX_HIGHWAY_TILES`] tiles, a
    /// tile off the map, tiles that are not strictly increasing.
    pub fn decode(bytes: &[u8], width: i32, height: i32) -> Result<HighwayList, &'static str> {
        let Some((head, body)) = bytes.split_first_chunk::<CHUNK_COUNT_SIZE>() else {
            return Err("highways chunk is cut short");
        };
        let count = usize::from(u16::from_be_bytes(*head));
        if count == 0 {
            return Err("highways chunk is empty");
        }
        if count > MAX_HIGHWAY_TILES {
            return Err("highways chunk has too many tiles");
        }
        if body.len() != count * CHUNK_TILE_SIZE {
            return Err("highways chunk does not match its tile count");
        }
        let mut tiles = Vec::with_capacity(count);
        for t in body.chunks_exact(CHUNK_TILE_SIZE) {
            let tile = (
                u16::from_be_bytes([t[0], t[1]]),
                u16::from_be_bytes([t[2], t[3]]),
            );
            if i32::from(tile.0) >= width || i32::from(tile.1) >= height {
                return Err("highways chunk has a tile off the map");
            }
            if tiles.last().is_some_and(|last| *last >= tile) {
                return Err("highways chunk is not sorted or has a duplicate");
            }
            tiles.push(tile);
        }
        Ok(HighwayList { tiles })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_list_stays_sorted_without_duplicates_and_is_capped() {
        let mut l = HighwayList::default();
        assert!(l.insert(5, 2) && l.insert(1, 9) && l.insert(5, 1));
        assert!(!l.insert(5, 2), "duplicate");
        assert!(!l.insert(-1, 0) && !l.insert(0, 70_000));
        assert_eq!(l.as_slice(), &[(1, 9), (5, 1), (5, 2)]);
        assert!(l.contains(5, 1) && !l.contains(5, 3) && !l.contains(-4, 1));
        assert!(l.remove(5, 1) && !l.remove(5, 1) && !l.remove(-1, 1));
        let mut full = HighwayList::default();
        for i in 0..MAX_HIGHWAY_TILES as i32 {
            assert!(full.insert(i / 64, i % 64));
        }
        assert!(!full.insert(900, 900), "the cap");
        assert_eq!(full.len(), MAX_HIGHWAY_TILES);
    }

    #[test]
    fn the_list_round_trips_and_a_bad_chunk_is_refused() {
        let mut l = HighwayList::default();
        assert!(l.encode().is_empty());
        l.insert(3, 4);
        l.insert(2, 7);
        let bytes = l.encode();
        assert_eq!(bytes, vec![0, 2, 0, 2, 0, 7, 0, 3, 0, 4]);
        assert_eq!(HighwayList::decode(&bytes, 10, 10), Ok(l));
        let bad: [&[u8]; 8] = [
            &[],
            &[0],
            &[0, 0],
            &[0, 1, 0, 1, 0],
            &[0, 1, 0, 1, 0, 1, 0],
            &[0, 2, 0, 3, 0, 4, 0, 2, 0, 7],
            &[0, 2, 0, 2, 0, 7, 0, 2, 0, 7],
            &[0, 1, 0, 10, 0, 0],
        ];
        for (i, b) in bad.iter().enumerate() {
            assert!(HighwayList::decode(b, 10, 10).is_err(), "case {i}");
        }
        let too_many = [
            (MAX_HIGHWAY_TILES as u16 + 1).to_be_bytes().to_vec(),
            vec![0; 4],
        ]
        .concat();
        assert!(HighwayList::decode(&too_many, 10, 10).is_err());
    }
}
