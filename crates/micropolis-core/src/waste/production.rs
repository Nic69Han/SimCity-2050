//! What the zones make: the zone list with its production, and what the recycling centres cut.

use super::{PRODUCTION_PCT, RECYCLING_MAX_PCT, RECYCLING_PCT, RECYCLING_RADIUS, TIER_POPULATION};
use crate::densities::{zone_genre, GENRE_COMMERCIAL, GENRE_INDUSTRIAL, GENRE_RESIDENTIAL};
use crate::simulation::Simulation;
use crate::structures::Structure;
use crate::tile::LOMASK;
use crate::tile_chars::FREEZ;

/// A residential, commercial or industrial zone and the garbage it makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Zone {
    /// Centre tile.
    pub x: i32,
    pub y: i32,
    /// Units made in a month, before any recycling.
    pub base: i64,
}

/// Units a zone of `genre` with `population` inhabitants makes a month.
pub fn units(genre: u8, population: i64) -> i64 {
    match genre {
        GENRE_RESIDENTIAL => population * PRODUCTION_PCT[0] / 100,
        GENRE_COMMERCIAL => population * PRODUCTION_PCT[1] / 100,
        GENRE_INDUSTRIAL => population * PRODUCTION_PCT[2] / 100,
        _ => 0,
    }
}

impl Simulation {
    /// Classic population of the zone whose centre tile is `tile` (status bits included).
    fn zone_head_count(&self, genre: u8, tile: u16) -> i64 {
        let t = tile & LOMASK;
        match genre {
            GENRE_RESIDENTIAL if t == FREEZ => 0,
            GENRE_RESIDENTIAL => i64::from(self.get_res_zone_pop(t)),
            GENRE_COMMERCIAL => i64::from(self.get_com_zone_pop(t)) * TIER_POPULATION,
            _ => i64::from(self.get_ind_zone_pop(t)) * TIER_POPULATION,
        }
    }

    /// Every zone of the map with its production, in tile order (`x` then `y`). Bounded by the
    /// map size.
    pub(crate) fn waste_zones(&self) -> Vec<Zone> {
        let (w, h) = self.world_size();
        let mut out = Vec::new();
        for x in 0..w {
            for y in 0..h {
                let Some(tile) = self.tile(x, y) else {
                    continue;
                };
                let Some(genre) = zone_genre(tile) else {
                    continue;
                };
                let base = units(genre, self.zone_head_count(genre, tile));
                out.push(Zone { x, y, base });
            }
        }
        out
    }
}

/// Percent of its production the zone recycles: [`RECYCLING_PCT`] per centre in reach, at most
/// [`RECYCLING_MAX_PCT`].
pub fn recycled_pct(zone: &Zone, centres: &[Structure]) -> i64 {
    let in_reach = centres
        .iter()
        .filter(|c| c.distance(zone.x, zone.y) <= RECYCLING_RADIUS)
        .count() as i64;
    (in_reach * RECYCLING_PCT).min(RECYCLING_MAX_PCT)
}

/// Units the zone does not make thanks to the recycling centres.
pub fn recycled(zone: &Zone, centres: &[Structure]) -> i64 {
    zone.base * recycled_pct(zone, centres) / 100
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::waste::{GENRE_LANDFILL, GENRE_RECYCLING};

    fn centre(x: i32, y: i32) -> Structure {
        Structure {
            genre: GENRE_RECYCLING,
            x,
            y,
        }
    }

    #[test]
    fn production_is_a_percentage_of_the_population() {
        assert_eq!(units(GENRE_RESIDENTIAL, 40), 10);
        assert_eq!(units(GENRE_COMMERCIAL, 40), 16);
        assert_eq!(units(GENRE_INDUSTRIAL, 40), 24);
        assert_eq!(units(GENRE_INDUSTRIAL, 0), 0);
        assert_eq!(units(GENRE_LANDFILL, 40), 0);
    }

    #[test]
    fn recycling_adds_up_per_centre_in_reach_and_is_capped() {
        let zone = Zone {
            x: 20,
            y: 20,
            base: 100,
        };
        assert_eq!(recycled_pct(&zone, &[]), 0);
        // footprint 2 x 2 at (10, 20): distance from (20, 20) is 20 - 11 = 9, out of reach
        assert_eq!(recycled_pct(&zone, &[centre(10, 20)]), 0);
        assert_eq!(recycled_pct(&zone, &[centre(11, 20)]), RECYCLING_PCT);
        assert_eq!(recycled(&zone, &[centre(11, 20)]), 30);
        let many = [
            centre(11, 20),
            centre(12, 20),
            centre(13, 20),
            centre(14, 20),
        ];
        assert_eq!(recycled_pct(&zone, &many), RECYCLING_MAX_PCT);
        assert_eq!(recycled(&zone, &many), 60);
    }
}
