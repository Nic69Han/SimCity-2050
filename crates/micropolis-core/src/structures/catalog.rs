//! The catalog of the extended buildings: one constant entry per genre.

use super::{EFFECT_LAND_VALUE, EFFECT_NONE, FLAG_POWER, FLAG_WATER, SURFACE_TILE};
use super::{GENRE_BUS_DEPOT, GENRE_BUS_STOP, GENRE_MONUMENT, GENRE_PARK, GENRE_PLAZA};
use super::{GENRE_STATION, GENRE_TAXI_DEPOT, LAND_VALUE_CAP};
use crate::agents::transport::WALK_RADIUS;
use crate::services::{
    GENRE_CLINIC, GENRE_COLLEGE, GENRE_HOSPITAL, GENRE_LIBRARY, GENRE_MUSEUM, GENRE_PRISON,
    GENRE_SCHOOL,
};
use crate::tile::Tile;

/// One entry of the catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Kind {
    pub genre: u8,
    pub width: i32,
    pub height: i32,
    /// Dollars to build.
    pub cost: i32,
    /// Dollars per month.
    pub upkeep: i32,
    /// [`FLAG_POWER`] | [`FLAG_WATER`].
    pub flags: i32,
    /// Tiles from the footprint up to which the effect reaches.
    pub radius: i32,
    /// [`EFFECT_NONE`] or [`EFFECT_LAND_VALUE`].
    pub effect: i32,
    /// Land value points at the footprint (falls off to 0 past the radius).
    pub bonus: i32,
    /// Placement rule: a road must touch the footprint (one of the tiles next to its sides).
    pub needs_road: bool,
    /// Placement rule: a classic rail tile must touch the footprint (same neighbours).
    pub needs_rail: bool,
}

impl Kind {
    /// The surface tile character of this genre: the one every genre shares.
    pub fn surface(&self) -> Tile {
        SURFACE_TILE
    }
}

const fn kind(genre: u8, size: (i32, i32), cost: i32, upkeep: i32) -> Kind {
    Kind {
        genre,
        width: size.0,
        height: size.1,
        cost,
        upkeep,
        flags: 0,
        radius: 0,
        effect: EFFECT_NONE,
        bonus: 0,
        needs_road: false,
        needs_rail: false,
    }
}

const fn amenity(k: Kind, flags: i32, radius: i32, bonus: i32) -> Kind {
    Kind {
        flags,
        radius,
        effect: EFFECT_LAND_VALUE,
        bonus,
        ..k
    }
}

/// A public service building (docs/game-design-v09.md): needs power, its `radius` is the reach of
/// its service; capacity and weights are in [`crate::services::SERVICES`].
const fn public(genre: u8, size: (i32, i32), cost: i32, upkeep: i32, radius: i32) -> Kind {
    Kind {
        flags: FLAG_POWER,
        radius,
        ..kind(genre, size, cost, upkeep)
    }
}

/// The buildings, in genre order (genres 1-3 of v0.4, 10-12 of v0.5, 13 of v0.6, 30-36 of v0.9).
pub const CATALOG: [Kind; 14] = [
    amenity(kind(GENRE_PARK, (2, 2), 300, 5), 0, 6, 12),
    amenity(kind(GENRE_PLAZA, (1, 1), 100, 2), FLAG_POWER, 4, 6),
    amenity(
        kind(GENRE_MONUMENT, (3, 3), 2000, 40),
        FLAG_POWER | FLAG_WATER,
        12,
        30,
    ),
    Kind {
        radius: WALK_RADIUS,
        needs_road: true,
        ..kind(GENRE_BUS_STOP, (1, 1), 50, 1)
    },
    kind(GENRE_BUS_DEPOT, (2, 2), 600, 25),
    kind(GENRE_TAXI_DEPOT, (2, 2), 400, 15),
    Kind {
        needs_rail: true,
        ..kind(GENRE_STATION, (2, 2), 800, 30)
    },
    public(GENRE_SCHOOL, (2, 2), 500, 20, 8),
    public(GENRE_COLLEGE, (3, 3), 1500, 60, 14),
    public(GENRE_LIBRARY, (2, 2), 400, 15, 10),
    public(GENRE_MUSEUM, (3, 3), 1200, 40, 14),
    public(GENRE_CLINIC, (1, 1), 200, 10, 8),
    public(GENRE_HOSPITAL, (3, 3), 1800, 70, 16),
    public(GENRE_PRISON, (3, 3), 2500, 80, 20),
];

/// The catalog entry of `genre`, if it exists.
pub fn kind_of(genre: u8) -> Option<&'static Kind> {
    CATALOG.iter().find(|k| k.genre == genre)
}

const _: () = assert!(CATALOG[0].bonus <= LAND_VALUE_CAP);
