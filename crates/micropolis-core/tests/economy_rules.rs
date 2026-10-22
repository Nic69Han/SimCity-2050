//! The economy rules end to end (docs/game-design-v11.md): rule off = the classic engine, the tax
//! fund and the valves by rate, the yearly pass (interest, goods), the conservation of goods.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::economy::{
    wealth_of, Goods, BOND_AMOUNT, CASES, RATE_MAX, SHORTAGE_VALVE, VALVE_TAX_LIMIT,
};
use micropolis_core::simulation::{Simulation, COM_VALVE_RANGE};
use support::{file_of, run, state, HAIGHT};

/// Ticks that hold at least one tax collection (a game year is 48 city ticks of 16 sim ticks).
const YEAR_TICKS: usize = 1_200;
/// Steps of the "rule off is the classic engine" comparison.
const CLASSIC_STEPS: usize = 600;
/// The single rate of the budget the tests start from.
const SINGLE_RATE: i16 = 7;

fn haight() -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(HAIGHT, 1).expect("the sample city");
    s.total_funds = 1_000_000;
    s.set_city_tax(SINGLE_RATE);
    s
}

/// A city with the rule on after one full year, so the figures of the year are there.
fn one_year() -> Simulation {
    let mut s = haight();
    s.set_economy_rules(true);
    run(&mut s, YEAR_TICKS);
    assert!(s.tax_income().iter().sum::<i32>() > 0, "a year has passed");
    s
}

#[test]
fn rule_off_the_hook_answers_its_input_and_the_engine_is_the_classic_one() {
    let s = haight();
    for v in [0, 1, 777, -5, i64::MAX] {
        assert_eq!(s.ext_tax_fund(v), v);
    }
    let mut plain = haight();
    let mut toggled = haight();
    toggled.set_economy_rules(true);
    toggled.set_economy_rules(false);
    assert!(!toggled.set_zone_tax_rate(1, 1, 5));
    run(&mut plain, CLASSIC_STEPS);
    run(&mut toggled, CLASSIC_STEPS);
    assert_eq!(state(&plain), state(&toggled));
    assert_eq!(file_of(&plain), file_of(&toggled));
    assert!(!toggled.needs_extension_block());
}

#[test]
fn rule_off_the_budget_formula_is_untouched_whatever_the_stored_numbers() {
    let mut s = haight();
    run(&mut s, 10);
    let classic = s.tax_amounts().3;
    s.extensions_mut().economy_state.custom = true;
    s.extensions_mut().economy_state.rates = [20; CASES];
    assert_eq!(s.tax_amounts().3, classic);
}

#[test]
fn the_fund_of_a_collection_is_the_sum_of_the_recorded_cases() {
    let s = one_year();
    let sum: i64 = s.tax_income().iter().map(|&v| i64::from(v)).sum();
    assert_eq!(s.tax_amounts().3, s.ext_tax_fund(0));
    // the city moved since the pass, so compare with a pass done right now
    let mut now = s.clone();
    now.ext_monthly_balance();
    assert_eq!(
        now.tax_income().iter().map(|&v| i64::from(v)).sum::<i64>(),
        now.tax_amounts().3
    );
    assert!(sum > 0);
}

#[test]
fn a_zero_rate_pays_nothing_and_a_case_pays_only_its_own_zones() {
    let mut s = haight();
    run(&mut s, 10);
    s.set_economy_rules(true);
    for k in 1..=3 {
        for w in 1..=3 {
            assert!(s.set_zone_tax_rate(k, w, 0));
        }
    }
    assert_eq!(s.tax_amounts().3, 0);
    assert!(s.set_zone_tax_rate(1, 2, 10));
    let only_r2 = s.tax_amounts().3;
    assert!(only_r2 > 0);
    s.ext_monthly_balance();
    let income = s.tax_income();
    assert_eq!(i64::from(income[1]), only_r2);
    assert_eq!(income.iter().filter(|&&v| v != 0).count(), 1);
}

#[test]
fn doubling_every_rate_doubles_the_fund_within_rounding() {
    let mut s = haight();
    run(&mut s, 10);
    s.set_economy_rules(true);
    for k in 1..=3 {
        for w in 1..=3 {
            assert!(s.set_zone_tax_rate(k, w, 5));
        }
    }
    let low = s.tax_amounts().3;
    for k in 1..=3 {
        for w in 1..=3 {
            assert!(s.set_zone_tax_rate(k, w, 10));
        }
    }
    let high = s.tax_amounts().3;
    assert!(
        low > 0 && (high - 2 * low).abs() <= CASES as i64,
        "{low} {high}"
    );
}

#[test]
fn the_wealth_of_every_zone_is_a_class_of_its_land_value() {
    let s = one_year();
    let layer = s.wealth_layer();
    assert_eq!(layer.len(), 120 * 100);
    assert!(layer.iter().all(|&v| v <= 3));
    assert!(layer.iter().any(|&v| v > 0));
    assert!((0..=250).all(|v| (1..=3).contains(&wealth_of(v))));
    let off = haight();
    assert!(off.wealth_layer().iter().all(|&v| v == 0));
}

/// The valves after one call of the hook from a known start.
fn valves_after(s: &mut Simulation, start: i16) -> (i16, i16, i16) {
    s.res_valve = start;
    s.com_valve = start;
    s.ind_valve = start;
    s.res_cap = false;
    s.com_cap = false;
    s.ind_cap = false;
    s.ext_valves();
    (s.res_valve, s.com_valve, s.ind_valve)
}

#[test]
fn a_high_rate_lowers_the_demand_a_low_one_raises_it_within_the_limit() {
    let mut s = one_year();
    s.set_city_tax(7);
    let base = valves_after(&mut s.clone(), 0);
    assert_eq!(base, (0, 0, 0), "rates at the single rate: no push");
    for (rate, sign) in [(RATE_MAX, -1), (0, 1)] {
        for k in 1..=3 {
            for w in 1..=3 {
                assert!(s.set_zone_tax_rate(k, w, rate));
            }
        }
        let v = valves_after(&mut s.clone(), 0);
        for x in [v.0, v.1, v.2] {
            assert!(x.signum() == sign as i16 || x == 0, "{rate}: {x}");
            assert!(i32::from(x).abs() <= VALVE_TAX_LIMIT);
        }
        assert!(v.0 != 0, "residential has people");
    }
}

#[test]
fn a_valve_never_leaves_its_classic_range() {
    let mut s = one_year();
    for k in 1..=3 {
        for w in 1..=3 {
            assert!(s.set_zone_tax_rate(k, w, RATE_MAX));
        }
    }
    let top = i16::try_from(COM_VALVE_RANGE).unwrap();
    let (_, com, _) = valves_after(&mut s, -top + 10);
    assert!(i32::from(com) >= -COM_VALVE_RANGE);
    s.set_city_tax(RATE_MAX as i16);
    for k in 1..=3 {
        for w in 1..=3 {
            assert!(s.set_zone_tax_rate(k, w, 0));
        }
    }
    let (_, com, _) = valves_after(&mut s, top - 10);
    assert!(i32::from(com) <= COM_VALVE_RANGE);
}

#[test]
fn a_shortage_of_the_last_year_lowers_the_commercial_valve_only() {
    let mut s = one_year();
    s.set_city_tax(7);
    for k in 1..=3 {
        for w in 1..=3 {
            assert!(s.set_zone_tax_rate(k, w, 7));
        }
    }
    s.extensions_mut().economy_state.goods = Goods::from_totals(0, 100);
    assert!(s.extensions().economy_state.goods.shortage);
    assert_eq!(valves_after(&mut s, 0), (0, -SHORTAGE_VALVE as i16, 0));
    s.extensions_mut().economy_state.goods = Goods::from_totals(100, 100);
    assert_eq!(valves_after(&mut s, 0), (0, 0, 0));
}

#[test]
fn a_year_pays_the_interest_and_ages_the_bonds() {
    let mut s = one_year();
    assert_eq!(s.issue_bond(), 1);
    assert_eq!(s.issue_bond(), 1);
    let interest = 300 + 400;
    let before = s.total_funds;
    s.ext_monthly_balance();
    let goods_net = i64::from(s.goods_stats()[4]);
    assert_eq!(before - s.total_funds, interest - goods_net);
    assert!(s.bonds().iter().all(|b| b.years == 1));
}

#[test]
fn goods_are_conserved_and_the_net_is_priced() {
    let s = one_year();
    let [produced, consumed, exported, imported, net, shortage] = s.goods_stats();
    assert!(produced + consumed > 0);
    assert_eq!(produced + imported, consumed + exported);
    assert_eq!(net, exported - 2 * imported);
    assert!(exported == 0 || imported == 0);
    let wants = imported * 100 > 50 * consumed;
    assert_eq!(shortage == 1, wants);
}

#[test]
fn the_cap_of_bonds_and_the_funds_hold_through_the_years() {
    let mut s = one_year();
    s.total_funds = 10 * i64::from(BOND_AMOUNT);
    for _ in 0..10 {
        assert_eq!(s.issue_bond(), 1);
    }
    assert_eq!(s.issue_bond(), -1);
    s.total_funds = 0;
    assert_eq!(s.repay_bond(0), -1);
    run(&mut s, YEAR_TICKS);
    assert_eq!(s.bonds().len(), 10);
}

#[test]
fn turning_the_rule_off_leaves_a_city_the_classic_engine_would_play() {
    let mut s = one_year();
    s.issue_bond();
    s.set_zone_tax_rate(2, 2, 15);
    s.total_funds = 1_000_000;
    s.set_economy_rules(false);
    assert!(s.bonds().is_empty() && !s.needs_extension_block());
    assert_eq!(s.tax_income(), [0; CASES]);
    assert_eq!(s.ext_tax_fund(42), 42);
}
