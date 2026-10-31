//! wasm adapter: the highways (docs/game-design-v13.md); the rules live in
//! `micropolis_core::highways` (translation only, ARCHITECTURE.md rule 4).
//!
//! Tool results are the `ToolResult` codes of `tool_down` (1 ok, 0 failed, -1 clear the area, -2 no
//! money); with the rule off every call is refused (`0`, cost 0).
//!
//! * `highway_rules() -> bool`, `set_highway_rules(on)`: the switch (off by default: the engine is
//!   the original). Turning it off takes up every highway, without refund.
//! * `highway_preview(x, y) -> Int32Array`: `[result, cost]` of `place_highway`, the city unchanged.
//! * `place_highway(x, y) -> i32`, `remove_highway(x, y) -> i32`: the tool result codes. A highway
//!   lies on a classic road tile (not a bridge, not a rail crossing); removing it is free.
//! * `highway_layer() -> Uint8Array`: one value per tile in the order of `tiles()` (`x * height + y`):
//!   1 highway, 0 otherwise. All 0 while the rule is off.
//! * `highway_stats() -> Int32Array`: `STATS_SIZE` (2) values `[tiles, yearly_upkeep]`.

use crate::City;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl City {
    /// Whether the highway rules are on (off by default).
    pub fn highway_rules(&self) -> bool {
        self.sim.highway_rules()
    }

    /// Turns the highway rules on or off (off takes up every highway).
    pub fn set_highway_rules(&mut self, on: bool) {
        self.sim.set_highway_rules(on);
    }

    /// `[result, cost]` of `place_highway`, without changing the city.
    pub fn highway_preview(&self, x: i32, y: i32) -> Vec<i32> {
        let p = self.sim.highway_preview(x, y);
        vec![p.result as i32, p.cost]
    }

    /// Lays a highway on the road at `(x, y)`; returns the tool result code.
    pub fn place_highway(&mut self, x: i32, y: i32) -> i32 {
        self.sim.place_highway(x, y) as i32
    }

    /// Takes up the highway at `(x, y)` (free); returns the tool result code.
    pub fn remove_highway(&mut self, x: i32, y: i32) -> i32 {
        self.sim.remove_highway(x, y) as i32
    }

    /// One byte per tile (order of `tiles()`): 1 on a highway.
    pub fn highway_layer(&self) -> Vec<u8> {
        self.sim.highway_layer()
    }

    /// `[tiles, yearly_upkeep]`.
    pub fn highway_stats(&self) -> Vec<i32> {
        self.sim.highway_stats().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use crate::City;
    use micropolis_core::highways::{HIGHWAY_COST, STATS_SIZE};
    use micropolis_core::tile::ROADS;

    #[test]
    fn the_rule_is_off_by_default_and_everything_is_refused() {
        let mut city = City::new(1);
        assert!(!city.highway_rules());
        assert_eq!(city.place_highway(5, 5), 0);
        assert_eq!(city.highway_preview(5, 5), vec![0, 0]);
        assert_eq!(city.remove_highway(5, 5), 0);
        assert_eq!(city.highway_stats(), vec![0; STATS_SIZE]);
        assert_eq!(
            city.highway_layer().len(),
            (city.width() * city.height()) as usize
        );
    }

    #[test]
    fn a_highway_is_previewed_laid_drawn_and_taken_up() {
        let mut city = City::new(1);
        city.sim.set_tile(5, 5, ROADS);
        city.sim.total_funds = 1000;
        city.set_highway_rules(true);
        assert_eq!(city.highway_preview(5, 5), vec![1, HIGHWAY_COST]);
        assert_eq!(city.highway_preview(6, 5), vec![0, 0]);
        assert_eq!(city.place_highway(5, 5), 1);
        assert_eq!(city.sim.total_funds, 1000 - i64::from(HIGHWAY_COST));
        let h = city.height();
        assert_eq!(city.highway_layer()[(5 * h + 5) as usize], 1);
        assert_eq!(city.highway_stats(), vec![1, 1]);
        assert_eq!(city.remove_highway(5, 5), 1);
        assert_eq!(city.highway_stats(), vec![0, 0]);
    }
}
