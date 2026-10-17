//! wasm adapter: Ordinances (docs/game-design-v02.md): the player's city-wide decisions; the rules live in micropolis_core::ordinances (translation only, ARCHITECTURE.md rule 4).
//!
//! * `ordinance_count() -> u32`: how many ordinances there are (valid indices `0..count`).
//! * `ordinance_key(i) -> String`: the stable machine name (empty for an invalid index); the
//!   page owns the French texts.
//! * `ordinance_info(i) -> Int32Array`: `[monthly_cost, crime_pct, pollution_pct, land_pct, res,
//!   com, ind]`. The cost is what the ordinance costs at each tax collection at the current
//!   population; the others are signed percentages (a negative crime percentage lowers crime,
//!   a positive demand percentage raises demand). Empty for an invalid index.
//! * `ordinance_active(i) -> bool`; `set_ordinance(i, on) -> bool` (`false`: invalid index,
//!   nothing changed).

use crate::City;
use wasm_bindgen::prelude::*;

/// An index from the page as the core's, `None` when it is negative.
fn index(i: i32) -> Option<usize> {
    usize::try_from(i).ok()
}

#[wasm_bindgen]
impl City {
    /// Number of ordinances.
    pub fn ordinance_count(&self) -> u32 {
        self.sim.ordinance_count() as u32
    }

    /// Stable key of ordinance `i`; empty when `i` is not an ordinance.
    pub fn ordinance_key(&self, i: i32) -> String {
        index(i)
            .and_then(|i| self.sim.ordinance_key(i))
            .unwrap_or("")
            .to_string()
    }

    /// `[monthly_cost, crime_pct, pollution_pct, land_pct, res, com, ind]`; empty when `i` is not
    /// an ordinance.
    pub fn ordinance_info(&self, i: i32) -> Vec<i32> {
        match index(i).and_then(|i| self.sim.ordinance_info(i)) {
            Some(o) => vec![
                o.monthly_cost,
                o.crime_pct,
                o.pollution_pct,
                o.land_pct,
                o.res_pct,
                o.com_pct,
                o.ind_pct,
            ],
            None => Vec::new(),
        }
    }

    /// Whether ordinance `i` is on.
    pub fn ordinance_active(&self, i: i32) -> bool {
        index(i).is_some_and(|i| self.sim.ordinance_active(i))
    }

    /// Turns ordinance `i` on or off. `false` (nothing changed) when `i` is not an ordinance.
    pub fn set_ordinance(&mut self, i: i32, on: bool) -> bool {
        index(i).is_some_and(|i| self.sim.set_ordinance(i, on))
    }
}

#[cfg(test)]
mod tests {
    use crate::City;

    #[test]
    fn the_adapter_translates_indices_and_layouts() {
        let mut city = City::new(1);
        assert_eq!(city.ordinance_count(), 8);
        assert_eq!(city.ordinance_key(0), "community_policing");
        assert_eq!(city.ordinance_info(0).len(), 7);
        assert_eq!(city.ordinance_info(0)[1], -15);
        assert!(!city.ordinance_active(0));
        assert!(city.set_ordinance(0, true) && city.ordinance_active(0));
        for bad in [-1, 8, i32::MAX, i32::MIN] {
            assert!(!city.set_ordinance(bad, true), "{bad}");
            assert!(!city.ordinance_active(bad), "{bad}");
            assert!(city.ordinance_info(bad).is_empty(), "{bad}");
            assert_eq!(city.ordinance_key(bad), "");
        }
    }
}
