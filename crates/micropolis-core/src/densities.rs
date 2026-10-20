//! Zoning densities and farms (docs/game-design-v07.md). Every residential, commercial or
//! industrial zone is *light*, *medium* or *dense*; a zone without a record (any zone of the
//! classic tools, any saved city of before) is **dense**. With the rule
//! ([`Extensions::densities`](crate::extensions::Extensions::densities)) off nothing here acts:
//! the hooks answer their input, the calls are refused and the engine is the original.
//!
//! * **Record.** Only the light and medium zones are listed, by the coordinates of their centre
//!   tile ([`DensityList`], sorted, at most [`MAX_DENSITY_ZONES`]). The genre (residential,
//!   commercial, industrial) is read from the centre tile, never stored.
//! * **Cap.** [`DENSITY_CAP`] gives, per genre and density, the classic zone population a zone
//!   may not grow beyond (`zone_can_grow`, called through `ext_zone_can_grow`).
//! * **Cost.** A zone costs the classic price times [`DENSITY_COST_PCT`] / 100.
//! * **Farms.** A light industrial zone on cheap land, far from the pollution, is a farm
//!   ([`Farms`]): recomputed at every monthly balance, it makes no pollution and its
//!   population counts as agricultural jobs.
//! * **Consistency.** A record whose centre is no longer a zone centre is dropped
//!   (`repair_densities`: valves pass, monthly balance, load).
//! * **Save**: chunk 7, one [`RECORD_SIZE`]-byte record per zone (x, y, density). Rule off and
//!   no record: nothing is written.
//!
//! No random number is drawn anywhere. Every loop is bounded by [`MAX_DENSITY_ZONES`], by the
//! ring of [`FARM_RING`] or by the map size.

mod farms;
mod rules;

use crate::tile::{Tile, LOMASK, ZONEBIT};
use crate::tile_chars::{COMBASE, COMLAST, HOSPITALBASE, INDBASE, PORTBASE, RESBASE};

pub(crate) use farms::pollution;
pub use farms::Farms;
pub(crate) use rules::zone_can_grow;
pub use rules::STATS_SIZE;

/// Genre of a residential zone.
pub const GENRE_RESIDENTIAL: u8 = 1;
/// Genre of a commercial zone.
pub const GENRE_COMMERCIAL: u8 = 2;
/// Genre of an industrial zone.
pub const GENRE_INDUSTRIAL: u8 = 3;
/// Density: light (small buildings).
pub const DENSITY_LIGHT: u8 = 1;
/// Density: medium.
pub const DENSITY_MEDIUM: u8 = 2;
/// Density: dense (the classic zones; no cap).
pub const DENSITY_DENSE: u8 = 3;
/// Value of a farm in [`Simulation::density_layer`](crate::simulation::Simulation::density_layer).
pub const LAYER_FARM: u8 = 4;
/// Price of a zone in percent of the classic one, indexed by `density - 1`.
pub const DENSITY_COST_PCT: [i32; 3] = [60, 80, 100];
/// Largest classic zone population a zone may reach, indexed by `[genre - 1][density - 1]`.
/// Residential: 16 / 32 / 40 (`getResZonePop`); commercial 2 / 4 / 5; industrial 2 / 3 / 4.
/// Growth is refused once the population has reached the cap.
pub const DENSITY_CAP: [[i32; 3]; 3] = [[16, 32, 40], [2, 4, 5], [2, 3, 4]];
/// A farm needs a land value strictly below this (land value map, 0..=250).
pub const FARM_LAND_VALUE_MAX: i32 = 40;
/// A farm needs a pollution strictly below this around it (pollution map, 0..=255).
pub const FARM_POLLUTION_MAX: i32 = 30;
/// Distance in tiles from a farm centre of the square ring where the pollution is measured
/// (far enough not to read the diffusion of the farm itself).
pub const FARM_RING: i32 = 6;
/// Largest number of recorded (light or medium) zones in a city.
pub const MAX_DENSITY_ZONES: usize = 2048;
/// Bytes of a saved zone: x (2, big-endian), y (2, big-endian), density (1).
pub const RECORD_SIZE: usize = 5;

/// The genre of the zone whose centre tile is `tile` (status bits included), or `None` when it
/// is not the centre of a residential, commercial or industrial zone.
pub fn zone_genre(tile: Tile) -> Option<u8> {
    if tile & ZONEBIT == 0 {
        return None;
    }
    match tile & LOMASK {
        c if (RESBASE..HOSPITALBASE).contains(&c) => Some(GENRE_RESIDENTIAL),
        c if (COMBASE..=COMLAST).contains(&c) => Some(GENRE_COMMERCIAL),
        c if (INDBASE..PORTBASE).contains(&c) => Some(GENRE_INDUSTRIAL),
        _ => None,
    }
}

/// A light or medium zone: its centre tile and its density.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DensityRecord {
    pub x: i32,
    pub y: i32,
    pub density: u8,
}

/// The recorded zones, sorted by `(x, y)`, at most [`MAX_DENSITY_ZONES`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DensityList {
    items: Vec<DensityRecord>,
}

impl DensityList {
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn as_slice(&self) -> &[DensityRecord] {
        &self.items
    }

    fn search(&self, x: i32, y: i32) -> Result<usize, usize> {
        self.items.binary_search_by_key(&(x, y), |r| (r.x, r.y))
    }

    /// The density recorded for the zone centred on `(x, y)`.
    pub fn get(&self, x: i32, y: i32) -> Option<u8> {
        self.search(x, y).ok().map(|i| self.items[i].density)
    }

    /// Records (or replaces) a zone; `false` (and nothing changed) when a new one does not fit.
    pub fn set(&mut self, x: i32, y: i32, density: u8) -> bool {
        match self.search(x, y) {
            Ok(i) => self.items[i].density = density,
            Err(_) if self.items.len() >= MAX_DENSITY_ZONES => return false,
            Err(i) => self.items.insert(i, DensityRecord { x, y, density }),
        }
        true
    }

    /// Forgets the zone centred on `(x, y)`.
    pub fn remove(&mut self, x: i32, y: i32) {
        if let Ok(i) = self.search(x, y) {
            self.items.remove(i);
        }
    }

    /// Keeps the records for which `keep` is true.
    pub fn retain(&mut self, keep: impl FnMut(&DensityRecord) -> bool) {
        self.items.retain(keep);
    }

    /// The bytes of chunk 7: the records; nothing for an empty list.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.items.len() * RECORD_SIZE);
        for r in &self.items {
            out.extend_from_slice(&(r.x as u16).to_be_bytes());
            out.extend_from_slice(&(r.y as u16).to_be_bytes());
            out.push(r.density);
        }
        out
    }

    /// The list stored in `bytes` for a `width` x `height` map. Refused: a length that is not a
    /// whole number of records, more than [`MAX_DENSITY_ZONES`], a density other than light or
    /// medium, a centre whose 3 x 3 zone is off the map, records not in strictly increasing
    /// `(x, y)` order.
    pub fn decode(bytes: &[u8], width: i32, height: i32) -> Result<DensityList, &'static str> {
        if !bytes.len().is_multiple_of(RECORD_SIZE) {
            return Err("densities chunk is not a whole number of records");
        }
        if bytes.len() / RECORD_SIZE > MAX_DENSITY_ZONES {
            return Err("densities chunk has too many zones");
        }
        let mut list = DensityList::default();
        for r in bytes.as_chunks::<RECORD_SIZE>().0 {
            let rec = DensityRecord {
                x: i32::from(u16::from_be_bytes([r[0], r[1]])),
                y: i32::from(u16::from_be_bytes([r[2], r[3]])),
                density: r[4],
            };
            if rec.density != DENSITY_LIGHT && rec.density != DENSITY_MEDIUM {
                return Err("densities chunk has an unknown density");
            }
            if rec.x < 1 || rec.y < 1 || rec.x + 1 >= width || rec.y + 1 >= height {
                return Err("a zone of the densities chunk is off the map");
            }
            if list
                .items
                .last()
                .is_some_and(|p| (p.x, p.y) >= (rec.x, rec.y))
            {
                return Err("zones of the densities chunk are not in order");
            }
            list.items.push(rec);
        }
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile_chars::{CHURCH0, FREEZ, HOSPITAL, INDCLR, PORT};

    #[test]
    fn the_tables_have_one_row_per_genre_and_grow_with_the_density() {
        assert_eq!(DENSITY_COST_PCT[2], 100);
        assert!(DENSITY_COST_PCT.windows(2).all(|w| w[0] < w[1]));
        for caps in DENSITY_CAP {
            assert!(caps.windows(2).all(|w| w[0] < w[1]));
        }
    }

    #[test]
    fn the_genre_is_read_from_the_centre_tile() {
        assert_eq!(zone_genre(FREEZ | ZONEBIT), Some(GENRE_RESIDENTIAL));
        assert_eq!(zone_genre((COMBASE + 4) | ZONEBIT), Some(GENRE_COMMERCIAL));
        assert_eq!(zone_genre(INDCLR | ZONEBIT), Some(GENRE_INDUSTRIAL));
        assert_eq!(zone_genre(FREEZ), None);
        for t in [HOSPITAL, CHURCH0, PORT] {
            assert_eq!(zone_genre(t | ZONEBIT), None);
        }
    }

    #[test]
    fn the_list_stays_sorted_replaces_and_is_capped() {
        let mut l = DensityList::default();
        assert!(l.set(9, 2, DENSITY_LIGHT) && l.set(3, 8, DENSITY_MEDIUM) && l.set(3, 5, 1));
        let order: Vec<_> = l.as_slice().iter().map(|r| (r.x, r.y)).collect();
        assert_eq!(order, [(3, 5), (3, 8), (9, 2)]);
        assert!(l.set(3, 8, DENSITY_LIGHT));
        assert_eq!((l.len(), l.get(3, 8), l.get(4, 8)), (3, Some(1), None));
        l.remove(3, 8);
        l.remove(77, 77);
        assert_eq!(l.len(), 2);
        let mut full = DensityList::default();
        for i in 0..MAX_DENSITY_ZONES as i32 {
            assert!(full.set(i, 1, 1));
        }
        assert!(!full.set(0, 2, 1) && full.set(0, 1, 2));
        assert_eq!(full.len(), MAX_DENSITY_ZONES);
    }

    #[test]
    fn the_list_round_trips_and_an_empty_one_is_empty_bytes() {
        let mut l = DensityList::default();
        assert!(l.encode().is_empty());
        assert_eq!(DensityList::decode(&[], 80, 67), Ok(l.clone()));
        l.set(70, 60, DENSITY_MEDIUM);
        l.set(1, 2, DENSITY_LIGHT);
        let bytes = l.encode();
        assert_eq!(bytes.len(), 2 * RECORD_SIZE);
        assert_eq!(DensityList::decode(&bytes, 80, 67), Ok(l));
    }

    #[test]
    fn a_bad_chunk_is_refused() {
        let rec = |x: u16, y: u16, d: u8| {
            let mut v = x.to_be_bytes().to_vec();
            v.extend_from_slice(&y.to_be_bytes());
            v.push(d);
            v
        };
        let too_many: Vec<u8> = (0..=MAX_DENSITY_ZONES as u16)
            .flat_map(|i| rec(i % 70 + 1, 5, 1))
            .collect();
        let bad = [
            vec![1, 0, 0],
            rec(5, 5, 0),
            rec(5, 5, 3),
            rec(5, 5, 9),
            rec(0, 5, 1),
            rec(79, 5, 1),
            rec(5, 66, 1),
            [rec(5, 5, 1), rec(5, 5, 2)].concat(),
            [rec(6, 5, 1), rec(5, 9, 2)].concat(),
            too_many,
        ];
        for (i, b) in bad.iter().enumerate() {
            assert!(DensityList::decode(b, 80, 67).is_err(), "case {i}");
        }
    }
}
