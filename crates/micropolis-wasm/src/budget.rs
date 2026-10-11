//! wasm adapter: budget (translation only, ARCHITECTURE.md rule 4).
//!
//! Every number crosses the boundary as `i32` (values saturate to the `i32` range).
//!
//! `budget() -> Vec<i32>` (fixed layout, index: meaning)
//! ```text
//!  0 tax rate (0..=20)            1 total funds (treasury, dollars)
//!  2 tax fund (last collection)   3 cash flow (last collection, C short)
//!  4 city tax average             5 auto budget (1 = on, 0 = off)
//!  6 road fund (requested)        7 fire fund (requested)     8 police fund (requested)
//!  9 road spent                  10 fire spent                11 police spent
//! 12 road percent (0..=100)      13 fire percent (0..=100)    14 police percent (0..=100)
//! 15 road effect                 16 fire effect               17 police effect
//! ```
//! The percents are the stored fractions times 100, rounded to a whole percent.
//!
//! `evaluation() -> Vec<i32>` (fixed layout, index: meaning)
//! ```text
//!  0 score (0..=1000)             1 score delta
//!  2 class (0 village .. 5 megalopolis)
//!  3 population                   4 population delta
//!  5 assessed value (dollars)     6 "yes" vote, percent of citizens (0..=100)
//!  7 worst problem kind (-1 = none)    8 its votes
//!  9 second problem kind               10 its votes
//! 11 third problem kind                12 its votes
//! 13 fourth problem kind               14 its votes
//! ```
//! Problem kinds are the `CVP_*` constants of `evaluate.rs`: 0 crime, 1 pollution,
//! 2 housing, 3 taxes, 4 traffic, 5 unemployment, 6 fire. Entries that do not exist
//! are `-1` with 0 votes.
//!
//! `history(kind, scale) -> Vec<i32>`: 120 values, oldest first. `kind`: 0 residential,
//! 1 commercial, 2 industrial demand (valve history), 3 money, 4 crime, 5 pollution.
//! `scale`: 0 = last 10 years (short), 1 = last 120 years (long). Empty for other values.

use crate::City;
use micropolis_core::budget_api::{BudgetReport, EvaluationReport};
use wasm_bindgen::prelude::*;

fn sat(v: i64) -> i32 {
    v.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

fn percent(fraction: f32) -> i32 {
    (fraction * 100.0).round() as i32
}

fn budget_layout(b: &BudgetReport) -> Vec<i32> {
    vec![
        b.tax_rate as i32,
        sat(b.total_funds),
        sat(b.tax_fund),
        b.cash_flow as i32,
        b.city_tax_average as i32,
        b.auto_budget as i32,
        sat(b.road_fund),
        sat(b.fire_fund),
        sat(b.police_fund),
        sat(b.road_spend),
        sat(b.fire_spend),
        sat(b.police_spend),
        percent(b.road_percent),
        percent(b.fire_percent),
        percent(b.police_percent),
        b.road_effect,
        b.fire_effect,
        b.police_effect,
    ]
}

fn evaluation_layout(e: &EvaluationReport) -> Vec<i32> {
    let mut out = vec![
        e.score as i32,
        e.score_delta as i32,
        e.class as i32,
        sat(e.population),
        sat(e.population_delta),
        sat(e.assessed_value),
        e.yes_percent as i32,
    ];
    for slot in e.problems {
        match slot {
            Some((kind, votes)) => out.extend([kind, votes]),
            None => out.extend([-1, 0]),
        }
    }
    debug_assert!(out.len() == 7 + 2 * 4);
    out
}

#[wasm_bindgen]
impl City {
    /// Tax rate in percent (0..=20).
    pub fn tax(&self) -> i32 {
        self.sim.city_tax as i32
    }

    /// Set the tax rate. Returns `false` (no change) outside 0..=20.
    pub fn set_tax(&mut self, rate: i32) -> bool {
        self.sim.set_tax_rate(rate)
    }

    /// Set the road, fire and police funding percents (clamped to 0..=100) and
    /// allocate the current funds, as the budget dialog does. Nothing is charged.
    pub fn set_budget(&mut self, road: i32, fire: i32, police: i32) {
        self.sim.set_budget_percents(road, fire, police);
    }

    /// The budget and last collection figures (layout in the module documentation).
    pub fn budget(&self) -> Vec<i32> {
        budget_layout(&self.sim.budget_report())
    }

    /// The city evaluation (layout in the module documentation).
    pub fn evaluation(&self) -> Vec<i32> {
        evaluation_layout(&self.sim.evaluation_report())
    }

    /// One history graph, 120 values, oldest first (see the module documentation).
    pub fn history(&self, kind: i32, scale: i32) -> Vec<i32> {
        self.sim
            .history(kind, scale)
            .into_iter()
            .map(|v| v as i32)
            .collect()
    }
}
