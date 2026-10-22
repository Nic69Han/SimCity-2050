//! The hooks of the economy: the tax fund, the valves and the yearly pass.

use super::bonds::pay_year;
use super::goods::Goods;
use super::zones::{income_by_case, mean_rate};
use super::{
    EcoZone, CASES, KIND_COMMERCIAL, KIND_INDUSTRIAL, KIND_RESIDENTIAL, RATE_MAX, SHORTAGE_VALVE,
    VALVE_TAX_LIMIT,
};
use crate::simulate::TAX_TABLE;
use crate::simulation::{Simulation, COM_VALVE_RANGE, IND_VALVE_RANGE, RES_VALVE_RANGE};

fn clamp32(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

/// Income of the nine cases for the city as it is now.
fn incomes(sim: &Simulation, zones: &[EcoZone]) -> [i64; CASES] {
    income_by_case(zones, &sim.tax_rates(), sim.game_level as usize)
}

/// Hook body of `ext_tax_fund`: the sum of the nine incomes; `fund` while the rule is off.
pub(crate) fn tax_fund(sim: &Simulation, fund: i64) -> i64 {
    if !sim.economy_rules() {
        return fund;
    }
    incomes(sim, &sim.economy_zones()).iter().sum()
}

/// The `TAX_TABLE` line of a rate: the game level counts like in the classic code.
fn table_at(rate: i32, level: i32) -> i32 {
    let index = (rate.clamp(0, RATE_MAX) + level).min(RATE_MAX);
    i32::from(TAX_TABLE[index as usize])
}

/// What a kind of zone adds to its valve in one call: the classic table at the mean rate less
/// the table at the single rate (the classic code already added the latter), within the limit.
/// A mean over the single rate lowers the demand, one under it raises it. 0 for a kind without
/// population.
fn tax_push(single: i32, mean: Option<i32>, level: i32) -> i32 {
    let Some(mean) = mean else { return 0 };
    (table_at(mean, level) - table_at(single, level)).clamp(-VALVE_TAX_LIMIT, VALVE_TAX_LIMIT)
}

/// `valve` moved by `push` inside `-range..=range`; a capped valve stays at 0 or under.
fn moved(valve: i16, push: i32, range: i32, capped: bool) -> i16 {
    let v = (i32::from(valve) + push).clamp(-range, range);
    if capped && v > 0 {
        0
    } else {
        v as i16
    }
}

/// Hook body of `ext_valves`: the taxes push each valve, a shortage of the last year lowers the
/// commercial one. Inert while the rule is off.
pub(crate) fn valves(sim: &mut Simulation) {
    if !sim.economy_rules() {
        return;
    }
    let zones = sim.economy_zones();
    let rates = sim.tax_rates();
    let level = sim.game_level as i32;
    let single = i32::from(sim.city_tax);
    let push = |kind| tax_push(single, mean_rate(&zones, &rates, kind), level);
    let shortage = if sim.extensions().economy_state.goods.shortage {
        SHORTAGE_VALVE
    } else {
        0
    };
    sim.res_valve = moved(
        sim.res_valve,
        push(KIND_RESIDENTIAL),
        RES_VALVE_RANGE,
        sim.res_cap,
    );
    sim.com_valve = moved(
        sim.com_valve,
        push(KIND_COMMERCIAL) - shortage,
        COM_VALVE_RANGE,
        sim.com_cap,
    );
    sim.ind_valve = moved(
        sim.ind_valve,
        push(KIND_INDUSTRIAL),
        IND_VALVE_RANGE,
        sim.ind_cap,
    );
}

/// The yearly pass: records the income and the goods of the year, pays the interest of the bonds
/// and ages them. Returns the net cost in dollars (a cost is positive): the interest less what
/// the goods earned. The taxes themselves were collected by the classic code through
/// `ext_tax_fund`. 0 and nothing changed while the rule is off.
pub(crate) fn monthly_balance(sim: &mut Simulation) -> i32 {
    if !sim.economy_rules() {
        return 0;
    }
    let zones = sim.economy_zones();
    let income = incomes(sim, &zones).map(clamp32);
    let goods = Goods::of_zones(&zones);
    let state = &mut sim.extensions_mut().economy_state;
    let interest = pay_year(&mut state.bonds);
    state.income = income;
    state.goods = goods;
    clamp32(interest - i64::from(goods.net))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_push_is_the_table_difference_within_the_limit() {
        // single 7 (table 0), mean 7: nothing; mean 0: 200; mean 10: -100
        assert_eq!(tax_push(7, Some(7), 0), 0);
        assert_eq!(tax_push(7, Some(0), 0), 200);
        assert_eq!(tax_push(7, Some(10), 0), -100);
        assert_eq!(tax_push(7, None, 0), 0, "no population, no push");
    }

    #[test]
    fn the_push_is_bounded_both_ways() {
        assert_eq!(tax_push(0, Some(20), 0), -VALVE_TAX_LIMIT);
        assert_eq!(tax_push(20, Some(0), 0), VALVE_TAX_LIMIT);
        assert_eq!(tax_push(20, Some(20), 0), 0);
        for single in 0..=20 {
            for mean in 0..=20 {
                let p = tax_push(single, Some(mean), 2);
                assert!((-VALVE_TAX_LIMIT..=VALVE_TAX_LIMIT).contains(&p));
            }
        }
    }

    #[test]
    fn the_game_level_shifts_the_table_and_the_index_is_capped() {
        assert_eq!(table_at(5, 0), 50);
        assert_eq!(table_at(5, 2), i32::from(TAX_TABLE[7]));
        assert_eq!(table_at(20, 2), i32::from(TAX_TABLE[20]));
        assert_eq!(table_at(99, 0), i32::from(TAX_TABLE[20]));
    }

    #[test]
    fn a_valve_stays_in_its_range_and_a_cap_keeps_it_at_zero() {
        assert_eq!(moved(1_990, 300, 2_000, false), 2_000);
        assert_eq!(moved(-1_990, -300, 2_000, false), -2_000);
        assert_eq!(moved(50, 300, 2_000, true), 0);
        assert_eq!(moved(-50, 20, 2_000, true), -30);
    }
}

#[cfg(test)]
mod sign_tests {
    use super::tax_push;

    #[test]
    fn a_mean_rate_over_the_single_rate_lowers_demand() {
        assert!(tax_push(7, Some(15), 0) < 0);
        assert!(tax_push(15, Some(7), 0) > 0);
        assert_eq!(tax_push(7, Some(7), 0), 0);
        assert_eq!(tax_push(7, None, 0), 0);
    }
}
