//! Read/write API of the money and evaluation screens: what the original front-end
//! reads (budget dialog, financial figures, score card, history graphs) and the
//! few setters it uses. No simulation rule lives here: the functions call the
//! ported `budget.rs`, `evaluate.rs`, `graph.rs` and `utilities.rs` code.
//!
//! Percentages: the budget dialog works in whole percents `0..=100`; the engine
//! stores `road_percent`, `fire_percent` and `police_percent` as `f32` fractions,
//! so a value `p` is stored as `p as f32 / 100.0` (the same expression in the
//! differential oracle). The percentage of the original dialog's sliders is
//! not in this repository; this mapping is the one the oracle uses.

use crate::evaluate::CVP_NUMPROBLEMS;
use crate::graph::{HISTORY_COUNT, HISTORY_SCALE_COUNT, HISTORY_TYPE_COUNT};
use crate::simulation::{CityClass, Simulation, CVP_PROBLEM_COMPLAINTS};

/// Highest tax rate the budget dialog offers (`setCityTax` is called with 0..=20).
pub const TAX_RATE_MAX: i16 = 20;

/// Money figures of the budget and of the last tax collection.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BudgetReport {
    /// Tax rate in percent (`cityTax`), 0..=20.
    pub tax_rate: i16,
    /// Money available in the treasury (`totalFunds`).
    pub total_funds: i64,
    /// Taxes collected at the last collection (`taxFund`).
    pub tax_fund: i64,
    /// Last collection's taxes minus the requested funding (`cashFlow`, a C `short`).
    pub cash_flow: i16,
    /// Running average of the tax rate over the current year (`cityTaxAverage`).
    pub city_tax_average: i16,
    /// Auto budget switch (`autoBudget`).
    pub auto_budget: bool,
    /// Requested amounts of the last collection (`roadFund`, `fireFund`, `policeFund`).
    pub road_fund: i64,
    pub fire_fund: i64,
    pub police_fund: i64,
    /// Amounts actually spent on each department (`roadSpend`, ...).
    pub road_spend: i64,
    pub fire_spend: i64,
    pub police_spend: i64,
    /// Funding percentages (`roadPercent`, ...) as stored, in `0.0..=1.0`.
    pub road_percent: f32,
    pub fire_percent: f32,
    pub police_percent: f32,
    /// Effect of the department on the city (`roadEffect`, ...).
    pub road_effect: i32,
    pub fire_effect: i32,
    pub police_effect: i32,
}

/// The city evaluation (`cityEvaluation` results and the score card).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EvaluationReport {
    pub score: i16,
    pub score_delta: i16,
    pub class: CityClass,
    pub population: i64,
    pub population_delta: i64,
    pub assessed_value: i64,
    /// Percent of citizens who say "yes" to the mayor (`cityYes`), 0..=100.
    pub yes_percent: i16,
    /// The worst problems, worst first: `(problem index, votes)`. Unused entries
    /// are `None`. Problem indices are the `CVP_*` constants of `evaluate.rs`.
    pub problems: [Option<(i32, i32)>; CVP_PROBLEM_COMPLAINTS],
}

/// Clamp a percent to the dialog's range and convert it to the stored fraction.
pub fn percent_to_fraction(percent: i32) -> f32 {
    percent.clamp(0, 100) as f32 / 100.0
}

impl Simulation {
    /// The budget and financial figures, as the budget dialog shows them.
    pub fn budget_report(&self) -> BudgetReport {
        BudgetReport {
            tax_rate: self.city_tax,
            total_funds: self.total_funds,
            tax_fund: self.tax_fund,
            cash_flow: self.cash_flow,
            city_tax_average: self.city_tax_average,
            auto_budget: self.auto_budget,
            road_fund: self.road_fund,
            fire_fund: self.fire_fund,
            police_fund: self.police_fund,
            road_spend: self.road_spend,
            fire_spend: self.fire_spend,
            police_spend: self.police_spend,
            road_percent: self.road_percent,
            fire_percent: self.fire_percent,
            police_percent: self.police_percent,
            road_effect: self.road_effect,
            fire_effect: self.fire_effect,
            police_effect: self.police_effect,
        }
    }

    /// Set the tax rate (`setCityTax`). Returns `false` and changes nothing
    /// when the rate is outside `0..=TAX_RATE_MAX`.
    pub fn set_tax_rate(&mut self, rate: i32) -> bool {
        if !(0..=TAX_RATE_MAX as i32).contains(&rate) {
            return false;
        }
        self.set_city_tax(rate as i16);
        true
    }

    /// The budget dialog's "accept": store the three percentages (clamped to
    /// `0..=100`) and run `doBudgetFromMenu`, which allocates the current funds
    /// with the new percentages (scaling them back when money runs out). Nothing
    /// is charged here; the money moves at the next tax collection.
    pub fn set_budget_percents(&mut self, road: i32, fire: i32, police: i32) {
        self.road_percent = percent_to_fraction(road);
        self.fire_percent = percent_to_fraction(fire);
        self.police_percent = percent_to_fraction(police);
        self.do_budget_from_menu();
    }

    /// The city evaluation as the score card shows it.
    pub fn evaluation_report(&self) -> EvaluationReport {
        let mut problems = [None; CVP_PROBLEM_COMPLAINTS];
        let count = self.count_problems().min(CVP_PROBLEM_COMPLAINTS as i32);
        for (i, slot) in problems.iter_mut().enumerate().take(count as usize) {
            let p = self.get_problem_number(i as i32);
            let v = self.get_problem_votes(i as i32);
            if p >= 0 && v >= 0 && p < CVP_NUMPROBLEMS as i32 {
                *slot = Some((p, v));
            }
        }
        EvaluationReport {
            score: self.city_score,
            score_delta: self.city_score_delta,
            class: self.city_class,
            population: self.city_pop,
            population_delta: self.city_pop_delta,
            assessed_value: self.city_assessed_value,
            yes_percent: self.city_yes,
            problems,
        }
    }

    /// One history graph: `HISTORY_COUNT` values, oldest first. `kind` is a
    /// `HISTORY_TYPE_*` value and `scale` a `HISTORY_SCALE_*` value (0 = last
    /// 10 years, 1 = last 120 years). Invalid arguments give an empty vector.
    pub fn history(&self, kind: i32, scale: i32) -> Vec<i16> {
        if !(0..HISTORY_TYPE_COUNT).contains(&kind) || !(0..HISTORY_SCALE_COUNT).contains(&scale) {
            return Vec::new();
        }
        (0..HISTORY_COUNT)
            .map(|i| self.get_history(kind, scale, i))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_is_clamped_and_scaled() {
        assert_eq!(percent_to_fraction(-5), 0.0);
        assert_eq!(percent_to_fraction(250), 1.0);
        assert_eq!(percent_to_fraction(50), 0.5);
        assert_eq!(percent_to_fraction(7), 7.0f32 / 100.0);
    }

    #[test]
    fn tax_rate_is_range_checked() {
        let mut s = Simulation::with_default_size();
        assert!(s.set_tax_rate(20));
        assert_eq!(s.city_tax, 20);
        assert!(!s.set_tax_rate(21));
        assert!(!s.set_tax_rate(-1));
        assert_eq!(s.city_tax, 20);
    }

    #[test]
    fn history_rejects_invalid_arguments() {
        let s = Simulation::with_default_size();
        assert!(s.history(HISTORY_TYPE_COUNT, 0).is_empty());
        assert!(s.history(0, 2).is_empty());
        assert_eq!(s.history(0, 1).len(), HISTORY_COUNT as usize);
    }

    #[test]
    fn empty_city_evaluation_has_no_problems() {
        let s = Simulation::with_default_size();
        let e = s.evaluation_report();
        assert_eq!(e.problems, [None; CVP_PROBLEM_COMPLAINTS]);
    }
}
