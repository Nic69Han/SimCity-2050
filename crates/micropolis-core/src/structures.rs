//! Extended buildings (docs/game-design-v04.md): a generic platform. A building is an entry of
//! the constant [`CATALOG`] (size, cost, monthly upkeep, needs, radius, effect) and a placed
//! [`Structure`] (genre and top-left corner). With the rule
//! ([`Extensions::structures`](crate::extensions::Extensions::structures)) off nothing here acts:
//! every call is refused with [`ToolResult::Failed`](crate::tool::ToolResult) and a cost of 0,
//! the hooks answer their input, and the engine is the original.
//!
//! * **Surface tile.** Every tile of a footprint holds one inert tile character shared by all the
//!   genres ([`SURFACE_TILE`], 1019, an unused character after the last church), with the bits
//!   [`SURFACE_BITS`] (burnable, bulldozable, conductive). Which building owns a tile is read from
//!   the list, never from the character, so new genres need no new tile. v0.4 wrote one character
//!   per genre (1019, 1020, 1021): those still count as surface ([`is_surface`]) and load as they
//!   are. Nothing in
//!   the engine looks at them: they are not zones, roads, rails, wires, fire or flood, so the
//!   zones never grow on them and the classic tools refuse them (`NeedBulldoze`), except the
//!   bulldozer, which clears a tile. A fire turns a tile into fire. Being conductive, a building
//!   is part of the power grid like a zone (each tile counts as one power tile).
//! * **Consistency.** The list and the map must agree: a listed building is *intact* when each
//!   tile of its footprint is its surface tile. [`Simulation::repair_structures`] drops the
//!   broken ones and clears their leftover surface tiles; it runs at every valves pass, every
//!   monthly balance and when a file is loaded, which also clears surface tiles that no listed
//!   building owns. Readers (`structures`, the land value) skip a broken building at once.
//! * **Upkeep** is paid with the monthly balance ([`monthly_balance`]); the **land value
//!   bonus** ([`land_value`]) falls off linearly with the distance to the footprint, adds up
//!   over the buildings and is capped at [`LAND_VALUE_CAP`].
//! * **Save**: chunk 6, one [`RECORD_SIZE`]-byte record per building (genre, x, y). A city
//!   with the rule off and no building writes nothing.
//!
//! No random number is drawn anywhere. Every loop is bounded by [`MAX_STRUCTURES`], by the
//! 3 x 3 footprints or by the map size.

mod catalog;
mod rules;

use crate::simulation::Simulation;
use crate::tile::{Tile, BULLBIT, BURNBIT, CONDBIT};

pub use catalog::{kind_of, Kind, CATALOG};
pub use rules::StructureView;

/// Largest number of buildings in a city.
pub const MAX_STRUCTURES: usize = 256;
/// Genre of the urban park (2 x 2).
pub const GENRE_PARK: u8 = 1;
/// Genre of the public square (1 x 1).
pub const GENRE_PLAZA: u8 = 2;
/// Genre of the monument (3 x 3).
pub const GENRE_MONUMENT: u8 = 3;
/// Genre of the bus stop (1 x 1, next to a road).
pub const GENRE_BUS_STOP: u8 = 10;
/// Genre of the bus depot (2 x 2).
pub const GENRE_BUS_DEPOT: u8 = 11;
/// Genre of the taxi depot (2 x 2).
pub const GENRE_TAXI_DEPOT: u8 = 12;
/// Need flag: the building needs electricity to have its effect.
pub const FLAG_POWER: i32 = 1;
/// Need flag: the building needs water (only while the water rules are on).
pub const FLAG_WATER: i32 = 2;
/// Effect: none.
pub const EFFECT_NONE: i32 = 0;
/// Effect: raises the land value around the building.
pub const EFFECT_LAND_VALUE: i32 = 1;
/// Largest land value bonus the buildings give a block together.
pub const LAND_VALUE_CAP: i32 = 40;
/// Tile character every new building leaves on its footprint.
pub const SURFACE_TILE: Tile = 1019;
/// Last of the characters v0.4 used as surface (one per genre: 1019, 1020, 1021).
pub const LEGACY_SURFACE_LAST: Tile = 1021;
/// Status bits of a surface tile.
pub const SURFACE_BITS: Tile = BURNBIT | BULLBIT | CONDBIT;
/// Bytes of a saved building: genre (1), x (2, big-endian), y (2, big-endian).
pub const RECORD_SIZE: usize = 5;

/// Whether the tile character `c` is a building surface (the shared one, or a v0.4 per-genre one).
pub fn is_surface(c: Tile) -> bool {
    (SURFACE_TILE..=LEGACY_SURFACE_LAST).contains(&c)
}

/// A placed building: its genre and the top-left tile of its footprint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Structure {
    pub genre: u8,
    pub x: i32,
    pub y: i32,
}

impl Structure {
    /// The catalog entry (every listed building has one).
    pub fn kind(&self) -> &'static Kind {
        kind_of(self.genre).unwrap_or(&CATALOG[0])
    }

    /// Whether tile `(x, y)` is in the footprint.
    pub fn covers(&self, x: i32, y: i32) -> bool {
        let k = self.kind();
        (self.x..self.x + k.width).contains(&x) && (self.y..self.y + k.height).contains(&y)
    }

    /// Manhattan distance from tile `(x, y)` to the footprint (0 inside).
    pub fn distance(&self, x: i32, y: i32) -> i32 {
        let k = self.kind();
        let dx = (self.x - x).max(x - (self.x + k.width - 1)).max(0);
        let dy = (self.y - y).max(y - (self.y + k.height - 1)).max(0);
        dx + dy
    }

    /// The tiles of the footprint, row by row.
    pub fn tiles(&self) -> Vec<(i32, i32)> {
        let k = self.kind();
        let mut out = Vec::with_capacity((k.width * k.height) as usize);
        for dy in 0..k.height {
            for dx in 0..k.width {
                out.push((self.x + dx, self.y + dy));
            }
        }
        out
    }
}

/// The placed buildings, oldest first (at most [`MAX_STRUCTURES`]).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StructureList {
    items: Vec<Structure>,
}

impl StructureList {
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn as_slice(&self) -> &[Structure] {
        &self.items
    }

    /// Adds a building; `false` (and nothing added) when the list is full.
    pub fn push(&mut self, s: Structure) -> bool {
        if self.items.len() >= MAX_STRUCTURES {
            return false;
        }
        self.items.push(s);
        true
    }

    /// The building whose footprint holds tile `(x, y)`.
    pub fn find_at(&self, x: i32, y: i32) -> Option<Structure> {
        self.items.iter().copied().find(|s| s.covers(x, y))
    }

    /// Keeps the buildings for which `keep` is true.
    pub fn retain(&mut self, keep: impl FnMut(&Structure) -> bool) {
        self.items.retain(keep);
    }

    /// The bytes of chunk 6: the records; nothing for an empty list.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.items.len() * RECORD_SIZE);
        for s in &self.items {
            out.push(s.genre);
            out.extend_from_slice(&(s.x as u16).to_be_bytes());
            out.extend_from_slice(&(s.y as u16).to_be_bytes());
        }
        out
    }

    /// The list stored in `bytes` for a `width` x `height` map. Refused: a length that is not a
    /// whole number of records, more than [`MAX_STRUCTURES`], an unknown genre, a footprint off
    /// the map or two buildings that overlap.
    pub fn decode(bytes: &[u8], width: i32, height: i32) -> Result<StructureList, &'static str> {
        if !bytes.len().is_multiple_of(RECORD_SIZE) {
            return Err("structures chunk is not a whole number of records");
        }
        if bytes.len() / RECORD_SIZE > MAX_STRUCTURES {
            return Err("structures chunk has too many buildings");
        }
        let mut list = StructureList::default();
        for r in bytes.as_chunks::<RECORD_SIZE>().0 {
            let s = Structure {
                genre: r[0],
                x: i32::from(u16::from_be_bytes([r[1], r[2]])),
                y: i32::from(u16::from_be_bytes([r[3], r[4]])),
            };
            let kind = kind_of(s.genre).ok_or("structures chunk has an unknown genre")?;
            if s.x + kind.width > width || s.y + kind.height > height {
                return Err("a building of the structures chunk is off the map");
            }
            if list.items.iter().any(|o| o.overlaps(&s)) {
                return Err("buildings of the structures chunk overlap");
            }
            list.items.push(s);
        }
        Ok(list)
    }
}

impl Structure {
    /// Whether the two footprints share a tile.
    fn overlaps(&self, other: &Structure) -> bool {
        let (a, b) = (self.kind(), other.kind());
        self.x < other.x + b.width
            && other.x < self.x + a.width
            && self.y < other.y + b.height
            && other.y < self.y + a.height
    }
}

/// Net monthly cost of the buildings in dollars (a cost is positive): the upkeep of each.
pub(crate) fn monthly_balance(sim: &Simulation) -> i32 {
    sim.structures_upkeep()
}

/// Land value `v` of the block at world tile `(x, y)` with the bonus of the buildings in reach
/// (powered and watered when they need it), capped at [`LAND_VALUE_CAP`]. The caller clamps.
pub(crate) fn land_value(sim: &Simulation, x: i32, y: i32, v: i32) -> i32 {
    let list = &sim.extensions().structure_list;
    if !sim.structure_rules() || list.is_empty() {
        return v;
    }
    let mut bonus = 0;
    for s in list.as_slice() {
        let k = s.kind();
        let d = s.distance(x, y);
        if k.effect != EFFECT_LAND_VALUE || d > k.radius || !sim.structure_works(s) {
            continue;
        }
        bonus += k.bonus * (k.radius + 1 - d) / (k.radius + 1);
    }
    v + bonus.min(LAND_VALUE_CAP)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_is_in_increasing_genre_order_and_all_genres_share_one_surface() {
        let genres: Vec<u8> = CATALOG.iter().map(|k| k.genre).collect();
        assert_eq!(genres, [1, 2, 3, 10, 11, 12]);
        for k in &CATALOG {
            assert_eq!(kind_of(k.genre), Some(k));
            assert_eq!(k.surface(), SURFACE_TILE);
            assert!(k.width > 0 && k.height > 0 && k.cost > 0 && k.upkeep >= 0);
            assert!(k.bonus <= LAND_VALUE_CAP && k.radius >= 0);
        }
        for g in [0, 4, 9, 13, 255] {
            assert_eq!(kind_of(g), None);
        }
        let needing_a_road: Vec<u8> = CATALOG
            .iter()
            .filter(|k| k.needs_road)
            .map(|k| k.genre)
            .collect();
        assert_eq!(needing_a_road, [GENRE_BUS_STOP]);
    }

    #[test]
    fn the_surface_family_stays_inside_the_free_characters() {
        const { assert!(SURFACE_TILE <= LEGACY_SURFACE_LAST && LEGACY_SURFACE_LAST <= 1023) };
        assert!(is_surface(SURFACE_TILE) && is_surface(LEGACY_SURFACE_LAST));
        assert!(!is_surface(SURFACE_TILE - 1) && !is_surface(LEGACY_SURFACE_LAST + 1));
    }

    #[test]
    fn footprints_distances_and_overlaps() {
        let park = Structure {
            genre: GENRE_PARK,
            x: 5,
            y: 5,
        };
        assert_eq!(park.tiles(), vec![(5, 5), (6, 5), (5, 6), (6, 6)]);
        assert!(park.covers(6, 6) && !park.covers(7, 6));
        assert_eq!(
            (
                park.distance(6, 6),
                park.distance(8, 5),
                park.distance(8, 9)
            ),
            (0, 2, 5)
        );
        let plaza = Structure {
            genre: GENRE_PLAZA,
            x: 6,
            y: 6,
        };
        assert!(park.overlaps(&plaza));
        assert!(!park.overlaps(&Structure {
            genre: GENRE_PLAZA,
            x: 7,
            y: 6
        }));
    }

    #[test]
    fn the_list_round_trips_and_an_empty_one_is_empty_bytes() {
        let mut l = StructureList::default();
        assert!(l.encode().is_empty());
        assert_eq!(StructureList::decode(&[], 80, 67), Ok(l.clone()));
        assert!(l.push(Structure {
            genre: GENRE_MONUMENT,
            x: 70,
            y: 60
        }));
        assert!(l.push(Structure {
            genre: GENRE_PARK,
            x: 1,
            y: 2
        }));
        let bytes = l.encode();
        assert_eq!(bytes.len(), 2 * RECORD_SIZE);
        assert_eq!(StructureList::decode(&bytes, 80, 67), Ok(l));
    }

    #[test]
    fn a_bad_chunk_is_refused() {
        let rec = |g: u8, x: u16, y: u16| {
            let mut v = vec![g];
            v.extend_from_slice(&x.to_be_bytes());
            v.extend_from_slice(&y.to_be_bytes());
            v
        };
        let too_many: Vec<u8> = (0..=MAX_STRUCTURES).flat_map(|_| rec(2, 0, 0)).collect();
        let bad = [
            vec![1, 0, 0],
            rec(0, 1, 1),
            rec(4, 1, 1),
            rec(3, 78, 1),
            rec(1, 1, 66),
            [rec(1, 5, 5), rec(2, 6, 6)].concat(),
            too_many,
        ];
        for (i, b) in bad.iter().enumerate() {
            assert!(StructureList::decode(b, 80, 67).is_err(), "case {i}");
        }
    }

    #[test]
    fn the_list_is_capped() {
        let mut l = StructureList::default();
        for i in 0..MAX_STRUCTURES {
            assert!(l.push(Structure {
                genre: GENRE_PLAZA,
                x: i as i32,
                y: 0
            }));
        }
        assert!(!l.push(Structure {
            genre: GENRE_PLAZA,
            x: 0,
            y: 1
        }));
        assert_eq!(l.len(), MAX_STRUCTURES);
    }
}
