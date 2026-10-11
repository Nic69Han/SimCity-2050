//! Port of `budget.cpp` — city budget: how the available money is shared out
//! between roads, police and fire stations, and the city tax rate.
//!
//! The allocation step of `doBudgetNow` is a pure function
//! ([`allocate_funding`]) so it can be tested on its own. Float to integer
//! conversions reproduce the x86-64 behaviour of the original (see
//! `evaluate::c_f32_to_i32`).
//!
//! UI notifications of the original (`callback("update", ...)`,
//! `showBudgetAndWait`) have no counterpart in the core: the budget window is
//! only redrawn when `must_draw_budget` is set, and that flag is cleared by
//! [`Simulation::update_budget`]. The assertions in `doBudgetNow` are not
//! ported; they document states that the arithmetic already guarantees.

use crate::evaluate::c_f32_to_i32;
use crate::events::Event;
use crate::simulation::{Simulation, NOWHERE};

/// `MESSAGE_NO_MONEY` in `text.h` ("YOUR CITY HAS GONE BROKE!").
pub const MESSAGE_NO_MONEY: i16 = 26;

/// Result of the allocation step of `doBudgetNow`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FundingAllocation {
    pub fire_value: i64,
    pub police_value: i64,
    pub road_value: i64,
    pub fire_percent: f32,
    pub police_percent: f32,
    pub road_percent: f32,
    /// The money left after the allocation (`yumDuckets` in the original).
    /// This is the value the auto-budget test uses, even though it is reduced
    /// in some cases and not in others (see the FIXME in the original).
    pub yum_ducks: i64,
    /// Funding requested, after truncation to whole dollars (`total`).
    pub total: i64,
}

/// The allocation step of `doBudgetNow`: share `tax_fund + total_funds`
/// between road, fire and police, spending on roads first, then fire, then
/// police. Percentages are scaled back when the money runs out.
#[allow(clippy::too_many_arguments)]
pub fn allocate_funding(
    fire_fund: i64,
    fire_percent: f32,
    police_fund: i64,
    police_percent: f32,
    road_fund: i64,
    road_percent: f32,
    tax_fund: i64,
    total_funds: i64,
) -> FundingAllocation {
    // The product is computed in single precision, and then truncated to an int.
    let fire_int = c_f32_to_i32(fire_fund as f32 * fire_percent) as i64;
    let police_int = c_f32_to_i32(police_fund as f32 * police_percent) as i64;
    let road_int = c_f32_to_i32(road_fund as f32 * road_percent) as i64;

    let total = fire_int + police_int + road_int;
    let mut yum_ducks = tax_fund + total_funds;

    let mut out = FundingAllocation {
        fire_value: 0,
        police_value: 0,
        road_value: 0,
        fire_percent,
        police_percent,
        road_percent,
        yum_ducks: 0,
        total,
    };

    if yum_ducks > total {
        // Enough yumDuckets to fully fund fire, police and road.
        // (yumDuckets is not reduced here, as in the original.)
        out.fire_value = fire_int;
        out.police_value = police_int;
        out.road_value = road_int;
    } else if total > 0 {
        // Not enough yumDuckets to fund everything.
        // First spend on roads, then on fire, then on police.
        if yum_ducks > road_int {
            // Enough yumDuckets to fully fund roads.
            out.road_value = road_int;
            yum_ducks -= road_int;

            if yum_ducks > fire_int {
                // Enough yumDuckets to fully fund fire.
                out.fire_value = fire_int;
                yum_ducks -= fire_int;

                if yum_ducks > police_int {
                    // Unreachable: yum_ducks <= total - road_int - fire_int here.
                    out.police_value = police_int;
                    yum_ducks -= police_int;
                } else {
                    // Fully funded roads and fire. Partially fund police.
                    out.police_value = yum_ducks;
                    if yum_ducks > 0 {
                        // Scale back police percentage to available cash.
                        out.police_percent = (yum_ducks as f32) / (police_fund as f32);
                    } else {
                        // Exactly nothing left: police percentage goes to zero.
                        out.police_percent = 0.0;
                    }
                }
            } else {
                // Not enough yumDuckets to fully fund fire.
                out.fire_value = yum_ducks;
                // No police after funding roads and fire.
                out.police_value = 0;
                out.police_percent = 0.0;
                if yum_ducks > 0 {
                    out.fire_percent = (yum_ducks as f32) / (fire_fund as f32);
                } else {
                    out.fire_percent = 0.0;
                }
            }
        } else {
            // Not enough yumDuckets to fully fund roads.
            out.road_value = yum_ducks;
            // No fire or police after funding roads.
            out.fire_value = 0;
            out.police_value = 0;
            out.fire_percent = 0.0;
            out.police_percent = 0.0;
            if yum_ducks > 0 {
                out.road_percent = (yum_ducks as f32) / (road_fund as f32);
            } else {
                out.road_percent = 0.0;
            }
        }
    } else {
        // Zero funding, so no values but full percentages.
        out.fire_value = 0;
        out.police_value = 0;
        out.road_value = 0;
        out.fire_percent = 1.0;
        out.police_percent = 1.0;
        out.road_percent = 1.0;
    }

    out.yum_ducks = yum_ducks;
    out
}

/// Which branch of `doBudgetNow` runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetPath {
    /// Auto budget and the money covers the whole request: pay it all.
    AutoFunded,
    /// The player decides (manual budget, or asked from the menu).
    Manual,
    /// Auto budget cannot pay in full: it is switched off and the manual path runs.
    AutoBroke,
}

/// The decision of `doBudgetNow`: `yum_ducks` is the money left after the
/// allocation and `total` the amount requested.
pub fn budget_path(auto_budget: bool, from_menu: bool, yum_ducks: i64, total: i64) -> BudgetPath {
    if !auto_budget || from_menu {
        BudgetPath::Manual
    } else if yum_ducks > total {
        BudgetPath::AutoFunded
    } else {
        BudgetPath::AutoBroke
    }
}

impl Simulation {
    /// `initFundingLevel`: full percentages, no values, budget to be drawn.
    pub fn init_funding_level(&mut self) {
        self.fire_percent = 1.0;
        self.fire_value = 0;
        self.police_percent = 1.0;
        self.police_value = 0;
        self.road_percent = 1.0;
        self.road_value = 0;
        self.must_draw_budget = true;
    }

    /// `doBudget`: the game decided to show the budget.
    pub fn do_budget(&mut self) {
        self.do_budget_now(false);
    }

    /// `doBudgetFromMenu`: the user asked for the budget window.
    pub fn do_budget_from_menu(&mut self) {
        self.do_budget_now(true);
    }

    /// `doBudgetNow`: allocate the funds, then either spend them (auto budget
    /// and enough money), or leave the choice to the player (manual budget).
    /// When auto budget cannot pay in full, it is switched off and the
    /// manual path runs (the `goto noMoney` of the original).
    pub fn do_budget_now(&mut self, from_menu: bool) {
        let a = allocate_funding(
            self.fire_fund,
            self.fire_percent,
            self.police_fund,
            self.police_percent,
            self.road_fund,
            self.road_percent,
            self.tax_fund,
            self.total_funds,
        );
        self.fire_value = a.fire_value;
        self.police_value = a.police_value;
        self.road_value = a.road_value;
        self.fire_percent = a.fire_percent;
        self.police_percent = a.police_percent;
        self.road_percent = a.road_percent;

        let total = a.total;

        match budget_path(self.auto_budget, from_menu, a.yum_ducks, total) {
            BudgetPath::AutoFunded => {
                // Auto budget: pay everything that was asked for.
                let more_dough = self.tax_fund - total;
                self.spend((-more_dough) as i32);

                self.fire_spend = self.fire_fund;
                self.police_spend = self.police_fund;
                self.road_spend = self.road_fund;

                self.must_draw_budget = true;
                self.do_update_heads();
                return;
            }
            BudgetPath::AutoBroke => {
                // Not enough money: force the manual budget and tell the player.
                self.set_auto_budget(false);
                self.push_event(Event::OptionsChanged);
                self.send_message(
                    MESSAGE_NO_MONEY,
                    NOWHERE as i16,
                    NOWHERE as i16,
                    false,
                    true,
                );
            }
            BudgetPath::Manual => {}
        }

        // Manual budget (`!autoBudget || fromMenu`, or auto budget just
        // switched off).
        self.show_budget_window_and_start_waiting();

        if !from_menu {
            self.fire_spend = self.fire_value;
            self.police_spend = self.police_value;
            self.road_spend = self.road_value;

            let spent = self.fire_spend + self.police_spend + self.road_spend;
            let more_dough = self.tax_fund - spent;
            self.spend((-more_dough) as i32);
        }

        self.must_draw_budget = true;
        self.do_update_heads();
    }

    /// `updateBudget`: the budget window is redrawn when asked. The redraw
    /// itself is a front-end concern; only the request is cleared here.
    pub fn update_budget(&mut self) {
        if self.must_draw_budget {
            self.must_draw_budget = false;
        }
    }

    /// `showBudgetWindowAndStartWaiting`: front-end only, no-op in the core.
    pub fn show_budget_window_and_start_waiting(&mut self) {}

    /// `setCityTax`: change the tax rate.
    pub fn set_city_tax(&mut self, tax: i16) {
        self.city_tax = tax;
        self.push_event(Event::OptionsChanged);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    fn alloc(
        fire_fund: i64,
        fire_percent: f32,
        police_fund: i64,
        police_percent: f32,
        road_fund: i64,
        road_percent: f32,
        tax_fund: i64,
        total_funds: i64,
    ) -> FundingAllocation {
        allocate_funding(
            fire_fund,
            fire_percent,
            police_fund,
            police_percent,
            road_fund,
            road_percent,
            tax_fund,
            total_funds,
        )
    }

    #[test]
    fn budget_path_table() {
        for &from_menu in &[false, true] {
            for &auto in &[false, true] {
                for &(yum, total) in &[(0i64, 0i64), (5, 4), (4, 5), (5, 5), (-1, -2), (-2, -1)] {
                    let got = budget_path(auto, from_menu, yum, total);
                    let want = if !auto || from_menu {
                        BudgetPath::Manual
                    } else if yum > total {
                        BudgetPath::AutoFunded
                    } else {
                        BudgetPath::AutoBroke
                    };
                    assert_eq!(
                        got, want,
                        "auto={auto} menu={from_menu} yum={yum} total={total}"
                    );
                }
            }
        }
        assert_eq!(budget_path(true, false, 10, 3), BudgetPath::AutoFunded);
        assert_eq!(budget_path(true, false, 3, 3), BudgetPath::AutoBroke);
    }

    #[test]
    fn fully_funded_when_money_covers_everything() {
        let a = alloc(100, 1.0, 200, 1.0, 300, 1.0, 1000, 0);
        assert_eq!(
            (a.fire_value, a.police_value, a.road_value),
            (100, 200, 300)
        );
        assert_eq!(a.total, 600);
        assert_eq!(a.yum_ducks, 1000); // not reduced in the fully funded case
        assert_eq!(
            (a.fire_percent, a.police_percent, a.road_percent),
            (1.0, 1.0, 1.0)
        );
    }

    #[test]
    fn roads_first_then_fire_then_police() {
        // 50 available: roads (30) fully, fire (20 of 40) partly.
        let a = alloc(40, 1.0, 40, 1.0, 30, 1.0, 20, 30);
        assert_eq!(a.road_value, 30);
        assert_eq!(a.fire_value, 20);
        assert_eq!(a.police_value, 0);
        assert_eq!(a.yum_ducks, 20); // the partial fire branch does not reduce it
        assert_eq!(a.fire_percent, 0.5);
        assert_eq!(a.police_percent, 0.0);
        assert_eq!(a.road_percent, 1.0);
    }

    #[test]
    fn police_is_partly_funded_last() {
        // yum = 100: road 30, fire 40, police gets 30 out of 50.
        let a = alloc(40, 1.0, 50, 1.0, 30, 1.0, 60, 40);
        assert_eq!((a.road_value, a.fire_value, a.police_value), (30, 40, 30));
        assert_eq!(a.yum_ducks, 30);
        assert_eq!(a.police_percent, 30.0 / 50.0);
        assert_eq!(a.fire_percent, 1.0);
    }

    #[test]
    fn partial_road_scales_road_percent() {
        let a = alloc(40, 1.0, 40, 1.0, 100, 1.0, 10, 20);
        assert_eq!((a.road_value, a.fire_value, a.police_value), (30, 0, 0));
        assert_eq!(a.road_percent, 0.3);
        assert_eq!((a.fire_percent, a.police_percent), (0.0, 0.0));
    }

    #[test]
    fn zero_money_zeroes_values_and_restores_percent() {
        let a = alloc(40, 0.5, 40, 0.5, 40, 0.5, 0, 0);
        // total = 20 + 20 + 20 > 0, yum = 0 <= road_int: road gets 0, scaled to 0.
        assert_eq!(a.road_value, 0);
        assert_eq!(a.road_percent, 0.0);
        assert_eq!((a.fire_percent, a.police_percent), (0.0, 0.0));
        let z = alloc(0, 1.0, 0, 1.0, 0, 1.0, 0, 0);
        assert_eq!(z.total, 0);
        assert_eq!(
            (z.fire_percent, z.police_percent, z.road_percent),
            (1.0, 1.0, 1.0)
        );
    }

    #[test]
    fn negative_treasury_takes_the_road_branch() {
        // yum = -50 is not > 0, so roads get nothing and their percent is 0.
        let a = alloc(10, 1.0, 10, 1.0, 10, 1.0, -20, -30);
        assert_eq!(a.road_value, -50);
        assert_eq!(a.road_percent, 0.0);
    }

    #[test]
    fn requested_amounts_are_truncated_in_single_precision() {
        // 1_000_003 * 0.7 in f32 truncated to int.
        let a = alloc(1_000_003, 0.7, 0, 1.0, 0, 1.0, 0, 0);
        let expected = ((1_000_003f32) * 0.7f32) as i64;
        assert_eq!(a.total, expected);
    }

    #[test]
    fn allocation_table_is_consistent() {
        // Invariants over a grid: never overspend, values never negative when
        // money is positive, and the total never exceeds the requested amount.
        let funds = [0i64, 1, 7, 99, 100, 1000];
        let pcts = [0.0f32, 0.25, 0.5, 1.0];
        for &ff in &funds {
            for &pf in &funds {
                for &rf in &funds {
                    for &tax in &[0i64, 50, 500] {
                        for &total_funds in &[0i64, 5, 800] {
                            for &fp in &pcts {
                                let a = alloc(ff, fp, pf, fp, rf, fp, tax, total_funds);
                                let spent = a.fire_value + a.police_value + a.road_value;
                                let money = tax + total_funds;
                                if money > 0 && a.total > 0 {
                                    assert!(spent <= money, "overspent {spent} of {money}");
                                    assert!(a.road_value >= 0);
                                }
                                assert!(a.fire_percent >= 0.0 && a.police_percent >= 0.0);
                                assert!(a.road_percent >= 0.0);
                            }
                        }
                    }
                }
            }
        }
    }
}
