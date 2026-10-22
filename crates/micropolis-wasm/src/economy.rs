//! wasm adapter: the economy (docs/game-design-v11.md); the rules live in `micropolis_core::economy`
//! (translation only, ARCHITECTURE.md rule 4).
//!
//! * `economy_rules() -> bool`, `set_economy_rules(on)`: the switch (off by default: the engine is
//!   the original). Does not need the extended buildings. Turning it off repays the bonds the funds
//!   allow, forgets the others and resets the rates.
//! * `tax_rates() -> Int32Array`: 9 rates in percent (0..=20), kind then wealth: `[R modest, R
//!   average, R wealthy, C ..., I ...]`. While the rule is off, the single rate of the budget nine times.
//! * `set_tax_rate(kind, wealth, rate) -> bool`: kind 1 R, 2 C, 3 I; wealth 1 modest, 2 average,
//!   3 wealthy; `false` out of range or with the rule off.
//! * `tax_income() -> Int32Array`: 9 dollars, the income of the last year by case, same order.
//! * `bonds() -> Int32Array`: records of 3 `[amount, per_thousand, years]`, oldest first.
//! * `bond_offer() -> Int32Array`: `[amount, per_thousand]` of the next bond, `[0, 0]` when it
//!   cannot be issued.
//! * `issue_bond()`, `repay_bond(index)`: 1 done, 0 rule off, -1 at the cap, without the funds or
//!   with an unknown index.
//! * `goods_stats() -> Int32Array`: `[produced, consumed, exported, imported, net_income,
//!   shortage (0 or 1)]` of the last year.
//! * `wealth_layer() -> Uint8Array`: one value per tile (order `x * height + y`), 0 outside a
//!   zone, 1 to 3 (modest, average, wealthy) on the nine tiles of a zone.

use crate::City;
use wasm_bindgen::prelude::*;

/// Values per record of `bonds`.
pub const BOND_LEN: usize = 3;

#[wasm_bindgen]
impl City {
    /// Whether the economy rules are on (off by default).
    pub fn economy_rules(&self) -> bool {
        self.sim.economy_rules()
    }

    /// Turns the economy rules on or off.
    pub fn set_economy_rules(&mut self, on: bool) {
        self.sim.set_economy_rules(on);
    }

    /// The nine tax rates in percent, kind then wealth.
    pub fn tax_rates(&self) -> Vec<i32> {
        self.sim.tax_rates().to_vec()
    }

    /// Sets one rate; `false` when refused.
    pub fn set_tax_rate(&mut self, kind: i32, wealth: i32, rate: i32) -> bool {
        self.sim.set_zone_tax_rate(kind, wealth, rate)
    }

    /// Income of the last year, by case.
    pub fn tax_income(&self) -> Vec<i32> {
        self.sim.tax_income().to_vec()
    }

    /// The bonds, records `[amount, per_thousand, years]`.
    pub fn bonds(&self) -> Vec<i32> {
        let bonds = self.sim.bonds();
        let mut out = Vec::with_capacity(bonds.len() * BOND_LEN);
        for b in bonds {
            out.extend_from_slice(&[b.amount, i32::from(b.permille), i32::from(b.years)]);
        }
        out
    }

    /// `[amount, per_thousand]` of the next bond; `[0, 0]` when none can be issued.
    pub fn bond_offer(&self) -> Vec<i32> {
        let (amount, permille) = self.sim.bond_offer();
        vec![amount, permille]
    }

    /// Issues a bond: 1 done, 0 rule off, -1 at the cap.
    pub fn issue_bond(&mut self) -> i32 {
        self.sim.issue_bond()
    }

    /// Repays bond `index`: 1 done, 0 rule off, -1 unknown index or not enough funds.
    pub fn repay_bond(&mut self, index: i32) -> i32 {
        self.sim.repay_bond(index)
    }

    /// `[produced, consumed, exported, imported, net_income, shortage]` of the last year.
    pub fn goods_stats(&self) -> Vec<i32> {
        self.sim.goods_stats().to_vec()
    }

    /// The wealth layer, one byte per tile.
    pub fn wealth_layer(&self) -> Vec<u8> {
        self.sim.wealth_layer()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use micropolis_core::economy::{BOND_AMOUNT, CASES, GOODS_STATS_SIZE, MAX_BONDS};

    #[test]
    fn off_by_default_everything_is_inert() {
        let mut city = City::new(1);
        city.sim.set_city_tax(9);
        assert!(!city.economy_rules());
        assert_eq!(city.tax_rates(), vec![9; CASES]);
        assert_eq!(city.tax_income(), vec![0; CASES]);
        assert!(city.bonds().is_empty());
        assert_eq!(city.bond_offer(), vec![0, 0]);
        assert_eq!(city.goods_stats(), vec![0; GOODS_STATS_SIZE]);
        assert!(!city.set_tax_rate(1, 1, 5));
        assert_eq!((city.issue_bond(), city.repay_bond(0)), (0, 0));
        assert!(city.wealth_layer().iter().all(|&v| v == 0));
    }

    #[test]
    fn the_adapter_translates_rates_bonds_and_codes() {
        let mut city = City::new(1);
        city.sim.total_funds = 100_000;
        city.set_economy_rules(true);
        assert!(city.economy_rules());
        assert!(city.set_tax_rate(2, 3, 15) && !city.set_tax_rate(2, 3, 21));
        assert_eq!(city.tax_rates()[5], 15);
        assert_eq!(city.bond_offer(), vec![BOND_AMOUNT, 30]);
        assert_eq!(city.issue_bond(), 1);
        assert_eq!(city.bonds(), vec![BOND_AMOUNT, 30, 0]);
        assert_eq!(city.repay_bond(5), -1);
        assert_eq!(city.repay_bond(0), 1);
        assert!(city.bonds().is_empty());
        for _ in 0..MAX_BONDS {
            assert_eq!(city.issue_bond(), 1);
        }
        assert_eq!(city.issue_bond(), -1);
        assert_eq!(city.bond_offer(), vec![0, 0]);
        assert_eq!(city.bonds().len(), MAX_BONDS * BOND_LEN);
    }
}
