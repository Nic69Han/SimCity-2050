//! wasm adapter: the waste (docs/game-design-v08.md); the rules live in `micropolis_core::waste`
//! (translation only, ARCHITECTURE.md rule 4).
//!
//! * `waste_rules() -> bool`, `set_waste_rules(on)`: the switch (off by default: the engine is the
//!   original). The rules act only while the extended buildings (`structure_rules`) are on too.
//!   Turning it off forgets the piles, the landfill fills and the waste deals.
//! * `waste_stats() -> Int32Array`: `STATS_SIZE` (7) values `[produced_per_month, treated_per_month,
//!   recycled_per_month, exported_per_month, piled_total, landfill_room_left, power_produced]` of
//!   the last month (all 0 before the first month, after a load and while the rules do not act).
//! * `waste_layer() -> Uint8Array`: one value per tile, in the order of `tiles()`
//!   (`x * height + y`): the garbage piled there, 0..=255. All 0 while the rules do not act.
//!
//! The buildings are catalog genres: 20 landfill (3x3), 21 incinerator (2x2, power), 22 recycling
//! centre (2x2), 23 waste-to-energy plant (3x3), placed with `place_structure`. The garbage deals
//! are resource 2 of the deals API (offers 8..=11, see `deals.rs`).

use crate::City;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl City {
    /// Whether the waste rules are on (off by default).
    pub fn waste_rules(&self) -> bool {
        self.sim.waste_rules()
    }

    /// Turns the waste rules on or off.
    pub fn set_waste_rules(&mut self, on: bool) {
        self.sim.set_waste_rules(on);
    }

    /// `[produced, treated, recycled, exported]` per month, the garbage piled, the landfill room
    /// left and the power tiles of the waste-to-energy plants.
    pub fn waste_stats(&self) -> Vec<i32> {
        self.sim.waste_stats().to_vec()
    }

    /// The garbage piled on each tile (`x * height + y`), 0..=255.
    pub fn waste_layer(&self) -> Vec<u8> {
        self.sim.waste_layer()
    }
}

#[cfg(test)]
mod tests {
    use crate::City;
    use micropolis_core::waste::{GENRE_LANDFILL, STATS_SIZE};

    #[test]
    fn the_adapter_translates_the_switch_the_stats_and_the_layer() {
        let mut city = City::new(1);
        assert!(!city.waste_rules());
        assert_eq!(city.waste_stats(), vec![0; STATS_SIZE]);
        let layer = city.waste_layer();
        assert_eq!(layer.len(), city.sim.tiles.len());
        assert!(layer.iter().all(|&v| v == 0));
        city.set_waste_rules(true);
        assert!(city.waste_rules());
        // rules on but no extended buildings: nothing acts yet
        assert_eq!(city.waste_stats(), vec![0; STATS_SIZE]);
        city.sim.set_structure_rules(true);
        city.sim.total_funds = 1_000_000;
        assert_eq!(city.sim.place_structure(GENRE_LANDFILL, 20, 20) as i32, 1);
        let stats = city.waste_stats();
        assert_eq!(stats.len(), STATS_SIZE);
        assert_eq!(stats[5], micropolis_core::waste::LANDFILL_CAPACITY as i32);
    }
}
