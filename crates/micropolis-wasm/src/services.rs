//! wasm adapter: the public services (docs/game-design-v09.md): education, health, justice; the
//! rules live in `micropolis_core::services` (translation only, ARCHITECTURE.md rule 4).
//!
//! The buildings (genres 30-36) are placed with the calls of `structures.rs`; they can only be
//! built while the services are on, which in turn act only while the extended buildings are on.
//! With the rules off the statistics and the layers are all zero.

use crate::City;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl City {
    /// Whether the public services are on (off by default: the engine then equals the original).
    pub fn service_rules(&self) -> bool {
        self.sim.service_rules()
    }

    /// Turns the public services on or off; off removes every service building, without refund.
    pub fn set_service_rules(&mut self, on: bool) {
        self.sim.set_service_rules(on);
    }

    /// `[eq, life expectancy, students, school places, patients, care places, detainees, prison
    /// places, education coverage %, health coverage %]`.
    pub fn service_stats(&self) -> Vec<i32> {
        self.sim.service_stats().to_vec()
    }

    /// One byte per tile (`x * height + y`): the coverage 0..=255 of `kind` (0 education,
    /// 1 health, 2 security). All zero for another kind.
    pub fn coverage_layer(&self, kind: i32) -> Vec<u8> {
        self.sim.coverage_layer(kind)
    }
}

#[cfg(test)]
mod tests {
    use crate::City;

    #[test]
    fn off_by_default_everything_is_zero_and_refused() {
        let mut city = City::new(1);
        assert!(!city.service_rules());
        assert_eq!(city.service_stats(), vec![0; 10]);
        for kind in -1..4 {
            let layer = city.coverage_layer(kind);
            assert_eq!(layer.len() as i32, city.width() * city.height());
            assert!(layer.iter().all(|&v| v == 0));
        }
        city.set_structure_rules(true);
        assert_eq!(city.structure_preview(30, 5, 5), vec![0, 0]);
        assert_eq!(city.place_structure(30, 5, 5), 0);
    }

    #[test]
    fn a_school_is_placed_and_shows_in_the_education_layer_only() {
        let mut city = City::new(1);
        city.set_structure_rules(true);
        city.set_service_rules(true);
        let spot = (0..city.width() - 2)
            .flat_map(|x| (0..city.height() - 2).map(move |y| (x, y)))
            .find(|&(x, y)| city.structure_preview(30, x, y)[0] == 1)
            .expect("a free 2 x 2 spot");
        assert_eq!(city.structure_preview(30, spot.0, spot.1)[1], 500);
        assert_eq!(city.place_structure(30, spot.0, spot.1), 1);
        let at = |layer: &[u8]| layer[(spot.0 * city.height() + spot.1) as usize];
        // not powered yet: no coverage
        assert_eq!(at(&city.coverage_layer(0)), 0);
        city.set_service_rules(false);
        assert!(city.structures().is_empty());
        assert_eq!(city.service_stats(), vec![0; 10]);
    }
}
