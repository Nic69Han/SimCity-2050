//! WebAssembly adapter (see ARCHITECTURE.md, rule 4): converts types and
//! forwards calls to `micropolis-core`. It contains no game rule.

use micropolis_core::events::Event;
use micropolis_core::simulation::{GameLevel, Simulation};
use wasm_bindgen::prelude::*;

/// Year the original front-end gives to city time 0.
const STARTING_YEAR: i16 = 1900;

#[wasm_bindgen]
pub struct City {
    sim: Simulation,
}

#[wasm_bindgen]
impl City {
    /// An empty city of the original 120x100 size.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: i32) -> City {
        let mut sim = Simulation::with_default_size();
        sim.starting_year = STARTING_YEAR;
        sim.new_city(GameLevel::Easy, seed);
        City { sim }
    }

    /// Load the bytes of a `.cty` file; the error is a readable message.
    pub fn load_cty(&mut self, bytes: &[u8]) -> Result<(), JsError> {
        self.sim
            .load_cty(bytes)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    pub fn save_cty(&self) -> Vec<u8> {
        self.sim.save_cty()
    }

    pub fn width(&self) -> i32 {
        self.sim.world_size().0
    }

    pub fn height(&self) -> i32 {
        self.sim.world_size().1
    }

    /// Raw tiles, column-major (`x * height + y`), status bits included.
    pub fn tiles(&self) -> Vec<u16> {
        self.sim.tiles.clone()
    }

    pub fn funds(&self) -> f64 {
        self.sim.total_funds as f64
    }

    pub fn year(&self) -> i32 {
        self.sim.calendar().0 as i32
    }

    /// Month, 0..=11.
    pub fn month(&self) -> i32 {
        self.sim.calendar().1 as i32
    }

    pub fn population(&self) -> i32 {
        i32::from(self.sim.total_pop)
    }

    /// Advance the simulation by one tick (`simTick`). Does nothing while the
    /// speed is 0.
    pub fn tick(&mut self) {
        self.sim.sim_tick();
    }

    /// Speed 0 (paused) to 3 (fast), as `setSpeed`.
    pub fn set_speed(&mut self, speed: i32) {
        self.sim.set_speed(speed as i16);
    }

    pub fn speed(&self) -> i32 {
        i32::from(self.sim.sim_speed)
    }

    pub fn enable_disasters(&mut self, on: bool) {
        self.sim.set_enable_disasters(on);
    }

    /// Residential, commercial and industrial demand valves.
    pub fn demand(&self) -> Vec<i32> {
        vec![
            i32::from(self.sim.res_valve),
            i32::from(self.sim.com_valve),
            i32::from(self.sim.ind_valve),
        ]
    }

    pub fn score(&self) -> i32 {
        i32::from(self.sim.city_score)
    }

    /// Number of pending events, then discards them. Events carry no payload
    /// the page needs yet; it simply redraws after a load.
    pub fn take_events(&mut self) -> u32 {
        self.sim
            .drain_events()
            .iter()
            .filter(|e| matches!(e, Event::NewCity))
            .count() as u32
    }
}
