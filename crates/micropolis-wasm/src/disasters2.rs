//! wasm adapter: the SimCity 3000 disasters (docs/game-design-v13.md); the rules live in
//! `micropolis_core::disasters2` (translation only, ARCHITECTURE.md rule 4).
//!
//! * `disaster2_rules() -> bool`, `set_disaster2_rules(on)`: the switch (off by default: the engine
//!   is the original and draws no extra random number). Turning it off ends a drought.
//! * `trigger_disaster(kind) -> i32`: starts a disaster now. `kind` 1 riot, 2 UFO, 3 meteor,
//!   4 drought. Returns 1 done, 0 rule off, -1 impossible (unknown kind, or a riot in a city
//!   without residential zone). No chance, no crime condition, `enable_disasters` is not needed.
//! * `disaster2_stats() -> Int32Array`: `STATS_SIZE` (4) values `[drought_months_left,
//!   last_disaster (0 none, 1..=4), x, y]`, x and y -1 when there is none or it has no place (the
//!   drought). `[0, 0, -1, -1]` while the rule is off.
//!
//! The disasters announce themselves with `take_messages` records of kind `MESSAGE`: 44 riot (the
//! classic riot message), 59 UFO, 60 meteor, 61 drought (x, y: the place; none for the drought).

use crate::City;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl City {
    /// Whether the extended disasters are on (off by default).
    pub fn disaster2_rules(&self) -> bool {
        self.sim.disaster2_rules()
    }

    /// Turns the extended disasters on or off.
    pub fn set_disaster2_rules(&mut self, on: bool) {
        self.sim.set_disaster2_rules(on);
    }

    /// Starts the disaster `kind` now: 1 done, 0 rule off, -1 impossible.
    pub fn trigger_disaster(&mut self, kind: i32) -> i32 {
        self.sim.trigger_disaster(kind) as i32
    }

    /// `[drought_months_left, last_disaster, x, y]`.
    pub fn disaster2_stats(&self) -> Vec<i32> {
        self.sim.disaster2_stats().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use crate::City;
    use micropolis_core::disasters2::STATS_SIZE;

    #[test]
    fn the_adapter_translates_the_switch_the_trigger_and_the_stats() {
        let mut city = City::new(1);
        assert!(!city.disaster2_rules());
        assert_eq!(city.trigger_disaster(3), 0);
        assert_eq!(city.disaster2_stats(), vec![0, 0, -1, -1]);
        assert_eq!(city.disaster2_stats().len(), STATS_SIZE);
        city.set_disaster2_rules(true);
        assert!(city.disaster2_rules());
        assert_eq!(city.trigger_disaster(0), -1);
        assert_eq!(city.trigger_disaster(5), -1);
        assert_eq!(city.trigger_disaster(1), -1, "no residential zone");
        assert_eq!(city.trigger_disaster(4), 1);
        assert_eq!(city.disaster2_stats(), vec![12, 4, -1, -1]);
        assert_eq!(city.trigger_disaster(3), 1);
        let s = city.disaster2_stats();
        assert_eq!((s[0], s[1]), (12, 3));
        city.set_disaster2_rules(false);
        assert_eq!(city.disaster2_stats(), vec![0, 0, -1, -1]);
    }
}
