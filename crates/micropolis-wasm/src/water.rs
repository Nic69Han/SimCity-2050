//! wasm adapter: the water network (docs/game-design-v02.md): pumps and underground pipes; the
//! rules live in `micropolis_core::water` (translation only, ARCHITECTURE.md rule 4).
//!
//! Tool results are the `ToolResult` codes of `tool_down` (1 ok, 0 failed, -1 clear the area, -2 no
//! money); the previews are `[result, cost]`. With the rules off every call is refused (`0`, cost 0).

use crate::City;
use micropolis_core::tool::ToolPreview;
use wasm_bindgen::prelude::*;

fn pair(preview: ToolPreview) -> Vec<i32> {
    vec![preview.result as i32, preview.cost]
}

#[wasm_bindgen]
impl City {
    /// Whether the water rules are on (off by default: the engine then equals the original).
    pub fn water_rules(&self) -> bool {
        self.sim.water_rules()
    }

    /// Turns the water rules on or off.
    pub fn set_water_rules(&mut self, on: bool) {
        self.sim.set_water_rules(on);
    }

    /// Lays a pipe at `(x, y)`; returns the tool result code.
    pub fn place_pipe(&mut self, x: i32, y: i32) -> i32 {
        self.sim.place_pipe(x, y) as i32
    }

    /// `[result, cost]` of `place_pipe`, without changing the city.
    pub fn pipe_preview(&self, x: i32, y: i32) -> Vec<i32> {
        pair(self.sim.pipe_preview(x, y))
    }

    /// Takes up the pipe at `(x, y)` (free); returns the tool result code.
    pub fn remove_pipe(&mut self, x: i32, y: i32) -> i32 {
        self.sim.remove_pipe(x, y) as i32
    }

    /// Builds a pump at `(x, y)`, on land next to water; returns the tool result code.
    pub fn place_pump(&mut self, x: i32, y: i32) -> i32 {
        self.sim.place_pump(x, y) as i32
    }

    /// `[result, cost]` of `place_pump`, without changing the city.
    pub fn pump_preview(&self, x: i32, y: i32) -> Vec<i32> {
        pair(self.sim.pump_preview(x, y))
    }

    /// Removes the pump at `(x, y)` (free); returns the tool result code.
    pub fn remove_pump(&mut self, x: i32, y: i32) -> i32 {
        self.sim.remove_pump(x, y) as i32
    }

    /// Whether tile `(x, y)` is watered.
    pub fn watered(&self, x: i32, y: i32) -> bool {
        self.sim.watered(x, y)
    }

    /// What to draw on each tile, `width * height` bytes in the order of `tiles()`: 0 nothing,
    /// 1 a dry pipe, 2 a watered pipe, 3 a pump. All 0 with the rules off.
    pub fn water_layer(&self) -> Vec<u8> {
        self.sim.water_layer()
    }

    /// Centres of the zones without water, as `x0, y0, x1, y1, ...` (tile order).
    pub fn water_dry_zones(&self) -> Vec<i32> {
        self.sim
            .dry_zones()
            .into_iter()
            .flat_map(|(x, y)| [x, y])
            .collect()
    }

    /// `[pumps, pipes, watered zones, unwatered zones]`.
    pub fn water_stats(&self) -> Vec<i32> {
        let s = self.sim.water_stats();
        vec![s.pumps, s.pipes, s.watered_zones, s.unwatered_zones]
    }
}

#[cfg(test)]
mod tests {
    use crate::City;

    #[test]
    fn the_rules_are_off_by_default_and_everything_is_refused() {
        let mut city = City::new(1);
        assert!(!city.water_rules());
        assert_eq!(city.place_pipe(5, 5), 0);
        assert_eq!(city.pipe_preview(5, 5), vec![0, 0]);
        assert_eq!(city.place_pump(5, 5), 0);
        assert_eq!(city.water_stats(), vec![0, 0, 0, 0]);
        assert!(city.water_dry_zones().is_empty());
        assert_eq!(
            city.water_layer().len(),
            (city.width() * city.height()) as usize
        );
    }

    #[test]
    fn a_pipe_is_laid_previewed_and_drawn() {
        let mut city = City::new(1);
        city.set_water_rules(true);
        let funds = city.sim.total_funds;
        assert_eq!(
            city.pipe_preview(5, 5),
            vec![1, micropolis_core::water::PIPE_COST]
        );
        assert_eq!(city.place_pipe(5, 5), 1);
        assert_eq!(
            city.sim.total_funds,
            funds - i64::from(micropolis_core::water::PIPE_COST)
        );
        let h = city.height();
        assert_eq!(city.water_layer()[(5 * h + 5) as usize], 1);
        assert_eq!(city.water_stats()[..2], [0, 1]);
        assert_eq!(city.remove_pipe(5, 5), 1);
    }
}
