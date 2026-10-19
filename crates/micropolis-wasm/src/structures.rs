//! wasm adapter: the extended buildings (docs/game-design-v04.md): park, public square,
//! monument; the rules live in `micropolis_core::structures` (translation only,
//! ARCHITECTURE.md rule 4).
//!
//! Tool results are the `ToolResult` codes of `tool_down` (1 ok, 0 failed, -1 clear the area, -2 no
//! money); the preview is `[result, cost]`. With the rules off every call is refused (`0`, cost 0)
//! and the lists are empty.

use crate::City;
use micropolis_core::structures::CATALOG;
use wasm_bindgen::prelude::*;

/// A genre sent by the page: anything that is not a `u8` is unknown (refused as genre 0).
fn genre_of(genre: i32) -> u8 {
    u8::try_from(genre).unwrap_or(0)
}

#[wasm_bindgen]
impl City {
    /// Whether the extended buildings are on (off by default: the engine then equals the original).
    pub fn structure_rules(&self) -> bool {
        self.sim.structure_rules()
    }

    /// Turns the extended buildings on or off; off removes every building, without refund.
    pub fn set_structure_rules(&mut self, on: bool) {
        self.sim.set_structure_rules(on);
    }

    /// The catalog, 8 numbers per building: `[genre, width, height, cost, monthly upkeep, flags,
    /// radius, effect]` (flags: bit 0 needs electricity, bit 1 needs water; effect: 0 none, 1 land
    /// value).
    pub fn structure_catalog(&self) -> Vec<i32> {
        CATALOG
            .iter()
            .flat_map(|k| {
                [
                    i32::from(k.genre),
                    k.width,
                    k.height,
                    k.cost,
                    k.upkeep,
                    k.flags,
                    k.radius,
                    k.effect,
                ]
            })
            .collect()
    }

    /// The buildings, 6 numbers each: `[genre, x, y, width, height, state]` (x, y the top-left
    /// tile; state bit 0 powered, bit 1 watered). Empty with the rules off.
    pub fn structures(&self) -> Vec<i32> {
        self.sim
            .structures()
            .iter()
            .flat_map(|s| {
                [
                    i32::from(s.genre),
                    s.x,
                    s.y,
                    s.width,
                    s.height,
                    i32::from(s.state),
                ]
            })
            .collect()
    }

    /// `[result, cost]` of `place_structure`, without changing the city.
    pub fn structure_preview(&self, genre: i32, x: i32, y: i32) -> Vec<i32> {
        let p = self.sim.structure_preview(genre_of(genre), x, y);
        vec![p.result as i32, p.cost]
    }

    /// Builds a building whose top-left tile is `(x, y)`; returns the tool result code.
    pub fn place_structure(&mut self, genre: i32, x: i32, y: i32) -> i32 {
        self.sim.place_structure(genre_of(genre), x, y) as i32
    }

    /// Removes the building that has tile `(x, y)` (any of its tiles), free; returns the tool
    /// result code.
    pub fn remove_structure(&mut self, x: i32, y: i32) -> i32 {
        self.sim.remove_structure(x, y) as i32
    }

    /// Total monthly upkeep of the buildings, in dollars.
    pub fn structures_upkeep(&self) -> i32 {
        self.sim.structures_upkeep()
    }
}

#[cfg(test)]
mod tests {
    use crate::City;

    #[test]
    fn off_by_default_everything_is_refused_for_free() {
        let mut city = City::new(1);
        assert!(!city.structure_rules());
        assert_eq!(city.place_structure(1, 5, 5), 0);
        assert_eq!(city.structure_preview(1, 5, 5), vec![0, 0]);
        assert_eq!(city.remove_structure(5, 5), 0);
        assert!(city.structures().is_empty());
        assert_eq!(city.structures_upkeep(), 0);
        assert_eq!(city.structure_catalog().len(), 6 * 8);
    }

    #[test]
    fn a_building_is_placed_listed_and_removed() {
        let mut city = City::new(1);
        city.set_structure_rules(true);
        let spot = (0..city.width() - 3)
            .flat_map(|x| (0..city.height() - 3).map(move |y| (x, y)))
            .find(|&(x, y)| city.structure_preview(3, x, y)[0] == 1)
            .expect("a free 3 x 3 spot");
        assert_eq!(city.place_structure(3, spot.0, spot.1), 1);
        assert_eq!(city.structures()[..5], [3, spot.0, spot.1, 3, 3]);
        assert_eq!(city.remove_structure(spot.0 + 2, spot.1 + 2), 1);
        assert!(city.structures().is_empty());
    }
}
