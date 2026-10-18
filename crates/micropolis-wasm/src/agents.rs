//! wasm adapter: the simulated cars (docs/game-design-v03.md); the rules live in
//! `micropolis_core::agents` (translation only, ARCHITECTURE.md rule 4).
//!
//! * `agent_rules() -> bool`, `set_agent_rules(on)`: the switch (off by default: the engine is the
//!   original). Only the switch is saved; the cars restart from the city on load.
//! * `agent_stats() -> Int32Array`: `[active_cars, finished_trips, mean_trip_ticks,
//!   saturated_tiles, motorised_residents]` (zeros with the rule off).
//! * `vehicles(max) -> Int32Array`: records of 5 values
//!   `[id, kind, x16, y16, direction]`, at most `max`; `x16`/`y16` = centre of the vehicle in
//!   sixteenths of a tile from the top-left corner of the map (the middle of tile `(tx, ty)` is
//!   `tx * 16 + 8`); kind 0 = car; direction 0 N, 1 E, 2 S, 3 W.
//! * `traffic_load() -> Uint8Array`: measured load 0..=255 per tile, tile order `x * height + y`.

use crate::City;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl City {
    /// Whether the simulated cars are on.
    pub fn agent_rules(&self) -> bool {
        self.sim.agent_rules()
    }

    /// Turns the simulated cars on or off.
    pub fn set_agent_rules(&mut self, on: bool) {
        self.sim.set_agent_rules(on);
    }

    /// `[active_cars, finished_trips, mean_trip_ticks, saturated_tiles, motorised_residents]`.
    pub fn agent_stats(&self) -> Vec<i32> {
        self.sim.agent_stats().to_vec()
    }

    /// Flat records `[id, kind, x16, y16, direction]`, at most `max`.
    pub fn vehicles(&self, max: u32) -> Vec<i32> {
        let max = usize::try_from(max).unwrap_or(usize::MAX);
        self.sim.agent_vehicles(max).into_iter().flatten().collect()
    }

    /// Measured load of every tile (tile order), 0..=255.
    pub fn traffic_load(&self) -> Vec<u8> {
        self.sim.agent_traffic_load()
    }
}

#[cfg(test)]
mod tests {
    use crate::City;

    #[test]
    fn the_adapter_is_inert_when_off_and_flat_when_on() {
        let mut city = City::new(1);
        assert!(!city.agent_rules());
        assert_eq!(city.agent_stats(), vec![0; 5]);
        assert!(city.vehicles(10).is_empty());
        assert_eq!(city.traffic_load().len(), 120 * 100);
        city.set_agent_rules(true);
        assert!(city.agent_rules());
        city.set_speed(3);
        city.tick();
        assert_eq!(city.vehicles(0).len(), 0);
        assert_eq!(city.vehicles(7).len() % 5, 0);
    }
}
