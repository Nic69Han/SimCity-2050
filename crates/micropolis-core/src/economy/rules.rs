//! The economy on a [`Simulation`]: the switch, the rates, the bonds and the statistics. See the
//! module documentation of [`crate::economy`].

use super::bonds::{next_bond, repay_what_can_be};
use super::goods::Goods;
use super::{Bond, EconomyState, CASES, GOODS_STATS_SIZE, KINDS, RATE_MAX, WEALTHS};
use crate::simulation::Simulation;

fn clamp32(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

impl Simulation {
    /// Whether the economy rules are on (off by default: the engine is the original).
    pub fn economy_rules(&self) -> bool {
        self.extensions().economy
    }

    /// Turns the economy rules on or off. Turning on keeps what is there; turning off repays the
    /// bonds the funds allow (oldest first), forgets the others, resets the rates and forgets
    /// the figures of the last year. The same value twice changes nothing.
    pub fn set_economy_rules(&mut self, on: bool) {
        if on == self.economy_rules() {
            return;
        }
        if !on {
            let mut bonds = std::mem::take(&mut self.extensions_mut().economy_state.bonds);
            let spent = repay_what_can_be(&mut bonds, self.total_funds);
            self.spend(clamp32(spent));
        }
        let ext = self.extensions_mut();
        ext.economy = on;
        ext.economy_state = EconomyState::default();
    }

    /// Forgets the economy figures of a rule that is off (a loaded file).
    pub(crate) fn repair_economy(&mut self) {
        if !self.economy_rules() {
            self.extensions_mut().economy_state = EconomyState::default();
        }
    }

    /// The nine rates in percent, kind then wealth: the player's, or the single rate of the
    /// budget until a rate is set (also while the rule is off).
    pub fn tax_rates(&self) -> [i32; CASES] {
        let state = &self.extensions().economy_state;
        if self.economy_rules() && state.custom {
            return state.rates.map(i32::from);
        }
        [i32::from(self.city_tax).clamp(0, RATE_MAX); CASES]
    }

    /// Sets the rate of a kind (1 R, 2 C, 3 I) and a wealth (1 modest, 2 average, 3 wealthy) to
    /// `rate` percent. `false`, and nothing changed, when the rule is off or an argument is out
    /// of range. The first rate set freezes the others at the current single rate.
    pub fn set_zone_tax_rate(&mut self, kind: i32, wealth: i32, rate: i32) -> bool {
        let valid = (1..=KINDS as i32).contains(&kind)
            && (1..=WEALTHS as i32).contains(&wealth)
            && (0..=RATE_MAX).contains(&rate);
        if !self.economy_rules() || !valid {
            return false;
        }
        let current = self.tax_rates();
        let state = &mut self.extensions_mut().economy_state;
        state.rates = current.map(|r| r as u8);
        state.custom = true;
        state.rates[super::zones::case_of(kind, wealth)] = rate as u8;
        true
    }

    /// Income of the last year by case, in dollars. All 0 while the rule is off.
    pub fn tax_income(&self) -> [i32; CASES] {
        self.extensions().economy_state.income
    }

    /// The bonds running, oldest first. Empty while the rule is off.
    pub fn bonds(&self) -> &[Bond] {
        &self.extensions().economy_state.bonds
    }

    /// `(amount, per thousand)` of the next bond; `(0, 0)` when the rule is off or at the cap.
    pub fn bond_offer(&self) -> (i32, i32) {
        if !self.economy_rules() {
            return (0, 0);
        }
        next_bond(self.bonds().len()).map_or((0, 0), |b| (b.amount, i32::from(b.permille)))
    }

    /// Issues a bond: its amount is added to the funds. 1 done, 0 rule off, -1 at the cap.
    pub fn issue_bond(&mut self) -> i32 {
        if !self.economy_rules() {
            return 0;
        }
        let Some(bond) = next_bond(self.bonds().len()) else {
            return -1;
        };
        self.extensions_mut().economy_state.bonds.push(bond);
        self.spend(-bond.amount);
        1
    }

    /// Repays bond `index` (0 is the oldest) at its amount. 1 done, 0 rule off, -1 unknown index
    /// or funds under the amount.
    pub fn repay_bond(&mut self, index: i32) -> i32 {
        if !self.economy_rules() {
            return 0;
        }
        let Some(bond) = usize::try_from(index)
            .ok()
            .and_then(|i| self.bonds().get(i).copied())
        else {
            return -1;
        };
        if self.total_funds < i64::from(bond.amount) {
            return -1;
        }
        self.extensions_mut()
            .economy_state
            .bonds
            .remove(index as usize);
        self.spend(bond.amount);
        1
    }

    /// `[produced, consumed, exported, imported, net, shortage]` of the last year. All 0 while
    /// the rule is off.
    pub fn goods_stats(&self) -> [i32; GOODS_STATS_SIZE] {
        let Goods {
            produced,
            consumed,
            exported,
            imported,
            net,
            shortage,
        } = self.extensions().economy_state.goods;
        [
            produced,
            consumed,
            exported,
            imported,
            net,
            i32::from(shortage),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economy::{BOND_AMOUNT, MAX_BONDS};

    fn sim() -> Simulation {
        let mut s = Simulation::new(40, 40);
        s.total_funds = 100_000;
        s.set_city_tax(9);
        s
    }

    #[test]
    fn off_by_default_and_everything_is_refused_or_empty() {
        let mut s = sim();
        assert!(!s.economy_rules() && !s.extensions_active());
        assert!(!s.set_zone_tax_rate(1, 1, 5));
        assert_eq!(s.issue_bond(), 0);
        assert_eq!(s.repay_bond(0), 0);
        assert_eq!(s.bond_offer(), (0, 0));
        assert_eq!(s.goods_stats(), [0; GOODS_STATS_SIZE]);
        assert_eq!(s.tax_income(), [0; CASES]);
        assert!(s.bonds().is_empty());
        assert_eq!(s.total_funds, 100_000);
        assert_eq!(
            s.tax_rates(),
            [9; CASES],
            "the single rate, shown but not used"
        );
    }

    #[test]
    fn the_rule_does_not_need_the_buildings_and_activates_the_extensions() {
        let mut s = sim();
        s.set_economy_rules(true);
        assert!(s.economy_rules() && s.extensions_active() && !s.structure_rules());
        assert!(s.needs_extension_block());
        s.set_economy_rules(false);
        assert!(!s.extensions_active() && !s.needs_extension_block());
    }

    #[test]
    fn the_rates_follow_the_budget_until_one_is_set() {
        let mut s = sim();
        s.set_economy_rules(true);
        assert_eq!(s.tax_rates(), [9; CASES]);
        s.set_city_tax(12);
        assert_eq!(s.tax_rates(), [12; CASES]);
        assert!(s.set_zone_tax_rate(2, 3, 20));
        let mut want = [12; CASES];
        want[5] = 20;
        assert_eq!(s.tax_rates(), want);
        s.set_city_tax(3);
        assert_eq!(s.tax_rates(), want, "frozen once a rate is set");
        assert!(s.set_zone_tax_rate(1, 1, 0));
        assert_eq!(s.tax_rates()[0], 0);
    }

    #[test]
    fn a_rate_out_of_range_is_refused_and_changes_nothing() {
        let mut s = sim();
        s.set_economy_rules(true);
        for (k, w, r) in [
            (0, 1, 5),
            (4, 1, 5),
            (1, 0, 5),
            (1, 4, 5),
            (1, 1, -1),
            (1, 1, 21),
        ] {
            assert!(!s.set_zone_tax_rate(k, w, r), "{k} {w} {r}");
        }
        assert!(s.bonds().is_empty());
        assert!(!s.extensions().economy_state.custom);
        assert!(s.set_zone_tax_rate(3, 3, 20) && s.set_zone_tax_rate(1, 1, 0));
    }

    #[test]
    fn a_bond_brings_its_amount_and_the_rate_rises_with_each() {
        let mut s = sim();
        s.set_economy_rules(true);
        assert_eq!(s.bond_offer(), (BOND_AMOUNT, 30));
        assert_eq!(s.issue_bond(), 1);
        assert_eq!(s.total_funds, 110_000);
        assert_eq!(s.bond_offer(), (BOND_AMOUNT, 40));
        assert_eq!(s.issue_bond(), 1);
        let rates: Vec<u16> = s.bonds().iter().map(|b| b.permille).collect();
        assert_eq!(rates, [30, 40]);
    }

    #[test]
    fn the_bonds_stop_at_the_cap() {
        let mut s = sim();
        s.set_economy_rules(true);
        for _ in 0..MAX_BONDS {
            assert_eq!(s.issue_bond(), 1);
        }
        let funds = s.total_funds;
        assert_eq!(s.issue_bond(), -1);
        assert_eq!(s.bonds().len(), MAX_BONDS);
        assert_eq!(s.total_funds, funds);
        assert_eq!(s.bond_offer(), (0, 0));
        assert_eq!(s.repay_bond(0), 1);
        assert_eq!(s.bond_offer(), (BOND_AMOUNT, 30 + 10 * 9));
    }

    #[test]
    fn repaying_needs_the_funds_and_a_known_bond() {
        let mut s = sim();
        s.set_economy_rules(true);
        s.issue_bond();
        s.issue_bond();
        assert_eq!(s.repay_bond(-1), -1);
        assert_eq!(s.repay_bond(2), -1);
        s.total_funds = i64::from(BOND_AMOUNT) - 1;
        assert_eq!(s.repay_bond(0), -1);
        assert_eq!(s.bonds().len(), 2);
        s.total_funds = i64::from(BOND_AMOUNT);
        assert_eq!(s.repay_bond(1), 1, "any index, here the newest");
        assert_eq!(s.total_funds, 0);
        assert_eq!(s.bonds()[0].permille, 30);
    }

    #[test]
    fn turning_off_repays_what_it_can_forgets_the_rest_and_resets_the_rates() {
        let mut s = sim();
        s.set_economy_rules(true);
        for _ in 0..4 {
            s.issue_bond();
        }
        assert!(s.set_zone_tax_rate(1, 1, 3));
        s.total_funds = 25_000;
        s.set_economy_rules(false);
        assert_eq!(s.total_funds, 5_000, "two bonds repaid, two forgotten");
        assert!(s.bonds().is_empty());
        assert_eq!(s.extensions().economy_state, EconomyState::default());
        s.set_economy_rules(true);
        assert_eq!(
            s.tax_rates(),
            [9; CASES],
            "the rates start again from the budget"
        );
    }

    #[test]
    fn turning_on_twice_keeps_what_is_there() {
        let mut s = sim();
        s.set_economy_rules(true);
        s.issue_bond();
        s.set_economy_rules(true);
        assert_eq!(s.bonds().len(), 1);
    }
}
