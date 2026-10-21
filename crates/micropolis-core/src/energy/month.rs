//! The monthly pass of the energy: the plants get a month older and the city pays for the
//! electricity it buys.

use super::{EnergyState, MAX_PLANTS};
use crate::deals::RESOURCE_POWER_BUY;
use crate::simulation::Simulation;

/// Dollars of one month of purchases: `amount * price` of every electricity deal.
fn purchases(sim: &Simulation) -> i64 {
    sim.extensions()
        .deal_list
        .as_slice()
        .iter()
        .filter(|d| d.resource == RESOURCE_POWER_BUY)
        .map(|d| i64::from(d.amount) * i64::from(d.price))
        .sum()
}

/// Every plant now standing is one month older; the ages of the others are forgotten. A plant
/// never seen starts at 0 and so is 1 month old after its first pass. Plants past
/// [`MAX_PLANTS`] are not followed.
fn age_plants(sim: &mut Simulation) {
    let mut next = EnergyState::default();
    for p in sim.energy_plants().iter().take(MAX_PLANTS) {
        next.set(p.x, p.y, p.age.saturating_add(1));
    }
    sim.extensions_mut().energy_state = next;
}

/// Net monthly cost in dollars (a cost is positive): the electricity bought. Ages the plants.
/// 0 and nothing changed while the rules do not act.
pub(crate) fn monthly_balance(sim: &mut Simulation) -> i32 {
    if !sim.energy_active() {
        return 0;
    }
    let cost = purchases(sim);
    age_plants(sim);
    cost.clamp(0, i64::from(i32::MAX)) as i32
}
