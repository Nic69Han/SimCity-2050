//! wasm adapter: terrain relief (translation only, ARCHITECTURE.md rule 4).
//!
//! The altitude of each tile comes from the core's `Relief` layer (docs/3d.md, section 2).

use crate::City;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl City {
    /// Altitude of every tile: `width * height` values in 0..=63, in the same order as
    /// `tiles()` (column-major, index `x * height + y`). Water is at 8, the sea level.
    pub fn heights(&self) -> Vec<u8> {
        self.sim.relief().as_slice().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use micropolis_core::relief::MAX_HEIGHT;
    use micropolis_core::simulation::Simulation;

    #[test]
    fn heights_match_the_map_and_stay_in_range() {
        let mut sim = Simulation::new(90, 70);
        sim.new_random_city(2);
        let heights = sim.relief().as_slice().to_vec();
        assert_eq!(heights.len(), sim.tiles.len());
        assert!(heights.iter().all(|&v| v <= MAX_HEIGHT));
    }
}
