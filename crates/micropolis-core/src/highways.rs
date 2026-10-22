//! Highways (docs/game-design-v13.md): a tool lays a highway **on existing classic road tiles**.
//! A highway costs more than a road, halves the traffic of its tiles and the simulated cars
//! drive twice as fast on it. With the rule
//! ([`Extensions::highways`](crate::extensions::Extensions::highways)) off nothing here acts: the
//! hooks answer their input, every call is refused or empty and the engine is the original.
//!
//! * **Eligible tile**: a classic road tile, [`is_highway_road`]: the plain roads, the
//!   intersection, the roads with a power line and the traffic variants. Not a bridge (the classic
//!   test `(tile & 15) < 2 || (tile & 15) == 15`: the bridge tiles, their traffic variants and the
//!   piece that ends each group of 16), not a rail crossing, not anything that is not a road.
//! * **Cost**: [`HIGHWAY_COST`] per tile, paid at placement; taking one up is free. Upkeep:
//!   [`HIGHWAY_UPKEEP`] per tile and per year, paid by the yearly balance (`ext_monthly_balance`).
//!   At most [`MAX_HIGHWAY_TILES`] tiles.
//! * **Repair**: when the road under a highway disappears (bulldozer, fire, disaster) the highway
//!   tile is dropped at the next valves pass ([`repair`](Simulation::repair_highways)), also on a
//!   loaded file. Rebuilding the road does not bring the highway back.
//! * **Traffic** (`ext_traffic`): the density of a traffic block that holds a highway tile is
//!   divided by [`HIGHWAY_TRAFFIC_DIV`].
//! * **Cars** (agents, v0.3): a car on a highway tile covers [`HIGHWAY_SPEED_MUL`] times the
//!   distance per tick. A car still moves at most one tile per tick, so the trips are conserved
//!   exactly as without highways.
//! * **Save**: chunk 13 ([`HighwayList::encode`]): the number of tiles (2 bytes), then x and y
//!   (2 + 2 bytes) of each tile, sorted by x then y, no duplicate. Written only when not empty.
//!
//! No random number is drawn anywhere. Every loop is bounded by [`MAX_HIGHWAY_TILES`], a footprint
//! of a traffic block or the map size.

mod effects;
mod rules;
mod state;

pub(crate) use effects::{monthly_balance, traffic};
pub use rules::STATS_SIZE;
pub use state::HighwayList;

use crate::tile::{Tile, LASTROAD, LOMASK, ROADS};

/// Dollars to lay one highway tile.
pub const HIGHWAY_COST: i32 = 25;
/// Dollars per highway tile and per year.
pub const HIGHWAY_UPKEEP: i32 = 1;
/// Most highway tiles in a city.
pub const MAX_HIGHWAY_TILES: usize = 4096;
/// Divisor of the traffic density of the blocks that hold a highway tile.
pub const HIGHWAY_TRAFFIC_DIV: i32 = 2;
/// Factor of the speed of a simulated car on a highway tile.
pub const HIGHWAY_SPEED_MUL: u32 = 2;
/// Bytes that open chunk 13: the number of tiles.
pub const CHUNK_COUNT_SIZE: usize = 2;
/// Bytes of a saved tile: x (2), y (2).
pub const CHUNK_TILE_SIZE: usize = 4;

/// Whether `tile` is a classic road a highway may lie on: a road tile that is neither a bridge nor
/// a rail crossing (the crossings are outside the road range).
pub fn is_highway_road(tile: Tile) -> bool {
    let t = tile & LOMASK;
    // the classic bridge test (`simulate.rs`): the first two and the last tile of each group of 16
    // road tiles are bridges, with or without traffic
    let k = t & 15;
    (ROADS..=LASTROAD).contains(&t) && k >= 2 && k != 15
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile::{
        BRWH, BRWV, HRAILROAD, HROADPOWER, HTRFBASE, INTERSECTION, LTRFBASE, ROADBASE, VBRIDGE,
        VRAILROAD,
    };

    #[test]
    fn roads_are_eligible_and_bridges_crossings_and_other_tiles_are_not() {
        for t in [
            ROADS,
            INTERSECTION,
            HROADPOWER,
            LTRFBASE + 2,
            HTRFBASE + 2,
            LASTROAD - 1,
        ] {
            assert!(is_highway_road(t), "{t}");
        }
        for t in [
            ROADBASE,
            VBRIDGE,
            BRWH,
            BRWV,
            LTRFBASE,
            LTRFBASE + 1,
            HTRFBASE,
            HTRFBASE + 1,
            80,
            81,
            144,
            193,
            111,
            127,
            143,
            159,
            175,
            191,
            HRAILROAD,
            VRAILROAD,
            0,
            240,
        ] {
            assert!(!is_highway_road(t), "{t}");
        }
        assert!(
            is_highway_road(ROADS | crate::tile::BULLBIT),
            "flags ignored"
        );
    }
}
