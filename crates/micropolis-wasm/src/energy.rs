//! wasm adapter: the energy (docs/game-design-v10.md); the rules live in `micropolis_core::energy`
//! (translation only, ARCHITECTURE.md rule 4).
//!
//! * `energy_rules() -> bool`, `set_energy_rules(on)`: the switch (off by default: the engine is the
//!   original). The rules act only while the extended buildings (`structure_rules`) are on too.
//!   Turning it off pulls down the plants of the catalog and forgets the ages and the purchases.
//! * `energy_stats() -> Int32Array`: `STATS_SIZE` (6) values `[production, consumption, bought,
//!   plants, plants_worn, air_pollution_made]` (power tiles, power tiles, power tiles, count,
//!   count, intensity); all 0 while the rules do not act.
//! * `power_plants() -> Int32Array`: records of [`PLANT_LEN`] (6) values `[genre, x, y, age_months,
//!   life_months, current_power]`, sorted by position; genre 0 and 1 are the classic
//!   coal and nuclear plants (x, y = the centre tile), 40..=46 the plants of the catalog (x, y =
//!   the top-left tile). Empty while the rules do not act.
//!
//! The plants are catalog genres 40..=46 placed with `place_structure`. Buying electricity is
//! resource 3 of the deals API (offers 12..=15, see `deals.rs`).

use crate::City;
use wasm_bindgen::prelude::*;

/// Values per record of `power_plants`.
pub const PLANT_LEN: usize = 6;

fn clamp(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

#[wasm_bindgen]
impl City {
    /// Whether the energy rules are on (off by default).
    pub fn energy_rules(&self) -> bool {
        self.sim.energy_rules()
    }

    /// Turns the energy rules on or off.
    pub fn set_energy_rules(&mut self, on: bool) {
        self.sim.set_energy_rules(on);
    }

    /// `[production, consumption, bought, plants, plants_worn, air_pollution_made]`.
    pub fn energy_stats(&self) -> Vec<i32> {
        self.sim.energy_stats().to_vec()
    }

    /// The plants, records `[genre, x, y, age_months, life_months, current_power]`.
    pub fn power_plants(&self) -> Vec<i32> {
        let plants = self.sim.energy_plants();
        let mut out = Vec::with_capacity(plants.len() * PLANT_LEN);
        for p in &plants {
            out.extend_from_slice(&[
                i32::from(p.genre),
                p.x,
                p.y,
                clamp(i64::from(p.age)),
                clamp(i64::from(p.life)),
                clamp(p.power),
            ]);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use crate::City;
    use micropolis_core::energy::{GENRE_WIND, STATS_SIZE};

    #[test]
    fn the_adapter_translates_the_switch_the_stats_and_the_plants() {
        let mut city = City::new(1);
        assert!(!city.energy_rules());
        assert_eq!(city.energy_stats(), vec![0; STATS_SIZE]);
        assert!(city.power_plants().is_empty());
        city.set_energy_rules(true);
        assert!(city.energy_rules());
        // rules on but no extended buildings: nothing acts yet
        assert_eq!(city.energy_stats(), vec![0; STATS_SIZE]);
        assert!(city.power_plants().is_empty());
        city.sim.set_structure_rules(true);
        city.sim.total_funds = 1_000_000;
        assert_eq!(city.sim.place_structure(GENRE_WIND, 20, 20) as i32, 1);
        let plants = city.power_plants();
        assert_eq!(plants.len() % super::PLANT_LEN, 0);
        let wind = plants
            .chunks(super::PLANT_LEN)
            .find(|r| r[0] == i32::from(GENRE_WIND))
            .expect("the turbine is listed");
        assert_eq!(wind, &[42, 20, 20, 0, 240, 30]);
        assert_eq!(city.energy_stats().len(), STATS_SIZE);
        city.set_energy_rules(false);
        assert!(city.power_plants().is_empty());
    }
}
