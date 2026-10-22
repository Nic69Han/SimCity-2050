//! The plants of a city as they are now: the classic ones found on the map and the working ones
//! of the catalog, with their age and the power they give.

use super::{curve, is_plant_genre, spec_of, GENRE_COAL, GENRE_NUCLEAR};
use crate::simulation::Simulation;
use crate::tile::{LOMASK, ZONEBIT};
use crate::tile_chars::{NUCLEAR, POWERPLANT};

/// A plant in service (or stopped by age), by its anchor: the top-left tile of a catalog plant,
/// the centre tile of a classic one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plant {
    pub genre: u8,
    pub x: i32,
    pub y: i32,
    /// Months since it was built (or first seen with the rule on).
    pub age: u32,
    /// Months of life span.
    pub life: u32,
    /// Power tiles it gives now.
    pub power: i64,
    /// Power tiles it gave new.
    pub base: i64,
}

impl Simulation {
    /// The classic genre of the plant whose centre tile is `(x, y)`, if there is one.
    fn classic_genre_at(&self, x: i32, y: i32) -> Option<u8> {
        let t = self.tile(x, y)?;
        if t & ZONEBIT == 0 {
            return None;
        }
        match t & LOMASK {
            POWERPLANT => Some(GENRE_COAL),
            NUCLEAR => Some(GENRE_NUCLEAR),
            _ => None,
        }
    }

    fn plant_of(&self, genre: u8, x: i32, y: i32) -> Option<Plant> {
        let spec = spec_of(genre)?;
        let age = self.extensions().energy_state.age_of(x, y);
        Some(Plant {
            genre,
            x,
            y,
            age,
            life: curve::life_months(spec),
            power: curve::power_at(spec, age),
            base: spec.power,
        })
    }

    /// Every plant, sorted by `(x, y)`: the classic ones (a scan of the map) and the working
    /// ones of the catalog. Empty while the rules do not act. Bounded by the map size and the
    /// building cap.
    pub fn energy_plants(&self) -> Vec<Plant> {
        if !self.energy_active() {
            return Vec::new();
        }
        let (w, h) = self.world_size();
        let mut out = Vec::new();
        for x in 0..w {
            for y in 0..h {
                if let Some(plant) = self
                    .classic_genre_at(x, y)
                    .and_then(|g| self.plant_of(g, x, y))
                {
                    out.push(plant);
                }
            }
        }
        for s in self.extensions().structure_list.as_slice() {
            if is_plant_genre(s.genre) && self.structure_works(s) {
                out.extend(self.plant_of(s.genre, s.x, s.y));
            }
        }
        out.sort_by_key(|p| (p.x, p.y));
        out
    }
}
