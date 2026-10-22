//! The yearly pass of the rewards: unlocks, proposals and the income of the accepted deals.

use super::{deal_of, ANSWER_ACCEPTED, ANSWER_NONE, ANSWER_PROPOSED, DEALS, REWARDS};
use crate::simulation::Simulation;

/// Unlocks the rewards the city now qualifies for and proposes the offers whose population is
/// reached. Nothing is ever locked or withdrawn.
pub(super) fn refresh(sim: &mut Simulation) {
    if !sim.reward_active() {
        return;
    }
    let population = sim.get_population();
    let satisfaction = i32::from(sim.city_yes);
    let state = &mut sim.extensions_mut().reward_state;
    for r in REWARDS
        .iter()
        .filter(|r| population >= r.population && satisfaction >= r.satisfaction)
    {
        state.unlock(r.genre);
    }
    for d in DEALS.iter().filter(|d| population >= d.population) {
        if state.answer_of(d.genre) == ANSWER_NONE {
            state.set_answer(d.genre, ANSWER_PROPOSED);
        }
    }
}

/// Dollars of the year: the income of every accepted deal whose building stands and is powered.
fn income(sim: &Simulation) -> i64 {
    let ext = sim.extensions();
    ext.structure_list
        .as_slice()
        .iter()
        .filter(|s| ext.reward_state.answer_of(s.genre) == ANSWER_ACCEPTED)
        .filter(|s| sim.structure_works(s))
        .filter_map(|s| deal_of(s.genre))
        .map(|d| i64::from(d.income))
        .sum()
}

/// Net cost in dollars of the pass (a cost is positive, so the income is negative): checks the
/// unlocks and the offers, then collects the income. 0 and nothing changed while the rules do
/// not act.
pub(crate) fn monthly_balance(sim: &mut Simulation) -> i32 {
    if !sim.reward_active() {
        return 0;
    }
    refresh(sim);
    let earned = income(sim).clamp(0, i64::from(i32::MAX));
    sim.extensions_mut().reward_report.income = earned;
    -(earned as i32)
}
