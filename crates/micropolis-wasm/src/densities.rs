//! wasm adapter: the zoning densities and the farms (docs/game-design-v07.md); the rules live in
//! `micropolis_core::densities` (translation only, ARCHITECTURE.md rule 4).
//!
//! Genres: 1 residential, 2 commercial, 3 industrial. Densities: 1 light, 2 medium, 3 dense.
//! Tool results are the `ToolResult` codes (1 ok, 0 failed, -1 clear the area, -2 no money);
//! the preview is `[result, cost]`. With the rules off every call is refused (`0`, cost 0) and
//! the layer and the statistics are all zero.

use crate::City;
use wasm_bindgen::prelude::*;

/// A genre or density sent by the page: anything that is not a `u8` is unknown (refused as 0).
fn byte_of(value: i32) -> u8 {
    u8::try_from(value).unwrap_or(0)
}

#[wasm_bindgen]
impl City {
    /// Whether the zoning densities are on (off by default: the engine is then the original).
    pub fn density_rules(&self) -> bool {
        self.sim.density_rules()
    }

    /// Turns the zoning densities on or off; off makes every zone dense again (no cap).
    pub fn set_density_rules(&mut self, on: bool) {
        self.sim.set_density_rules(on);
    }

    /// `[result, cost]` of `place_zone`, without changing the city.
    pub fn zone_preview(&self, genre: i32, density: i32, x: i32, y: i32) -> Vec<i32> {
        let p = self
            .sim
            .zone_preview(byte_of(genre), byte_of(density), x, y);
        vec![p.result as i32, p.cost]
    }

    /// Builds a zone whose centre tile is `(x, y)` (the classic zone tool, then the density
    /// recorded); returns the tool result code.
    pub fn place_zone(&mut self, genre: i32, density: i32, x: i32, y: i32) -> i32 {
        self.sim.place_zone(byte_of(genre), byte_of(density), x, y) as i32
    }

    /// One byte per tile (`x * height + y`): 0 nothing, 1-3 the density on the nine tiles of a
    /// zone, 4 a farm.
    pub fn density_layer(&self) -> Vec<u8> {
        self.sim.density_layer()
    }

    /// `[light zones, medium zones, dense zones, farms, agricultural jobs]`.
    pub fn density_stats(&self) -> Vec<i32> {
        self.sim.density_stats().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use crate::City;

    #[test]
    fn off_by_default_everything_is_refused_for_free() {
        let mut city = City::new(1);
        assert!(!city.density_rules());
        assert_eq!(city.zone_preview(1, 1, 20, 20), vec![0, 0]);
        assert_eq!(city.place_zone(1, 1, 20, 20), 0);
        assert!(city.density_layer().iter().all(|&v| v == 0));
        assert_eq!(city.density_stats(), vec![0; 5]);
    }

    #[test]
    fn a_light_zone_is_previewed_placed_and_shown_in_the_layer() {
        let mut city = City::new(1);
        city.set_density_rules(true);
        let spot = (2..city.width() - 2)
            .flat_map(|x| (2..city.height() - 2).map(move |y| (x, y)))
            .find(|&(x, y)| city.zone_preview(1, 1, x, y)[0] == 1)
            .expect("a free 3 x 3 spot");
        assert_eq!(city.zone_preview(1, 1, spot.0, spot.1)[1], 60);
        assert_eq!(city.zone_preview(1, 3, spot.0, spot.1)[1], 100);
        assert_eq!(city.zone_preview(9, 1, spot.0, spot.1), vec![0, 0]);
        assert_eq!(city.zone_preview(1, 4, spot.0, spot.1), vec![0, 0]);
        assert_eq!(city.place_zone(1, 1, spot.0, spot.1), 1);
        let layer = city.density_layer();
        let at = |x: i32, y: i32| layer[(x * city.height() + y) as usize];
        assert_eq!((at(spot.0, spot.1), at(spot.0 - 1, spot.1 + 1)), (1, 1));
        assert_eq!(city.density_stats()[..3], [1, 0, 0]);
    }
}
