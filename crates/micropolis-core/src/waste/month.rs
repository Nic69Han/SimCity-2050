//! The monthly treatment: production, recycling, burning, burying, export, piling.

use super::production::{recycled, Zone};
use super::spread::deposit;
use super::treatment::{export, Pool};
use super::{
    WasteReport, BACKLOG_DECAY, GENRE_INCINERATOR, GENRE_LANDFILL, GENRE_RECYCLING,
    GENRE_WASTE_TO_ENERGY, INCINERATOR_CAPACITY, LANDFILL_CAPACITY, WTE_CAPACITY,
};
use crate::deals::RESOURCE_WASTE;
use crate::simulation::Simulation;

/// Units of garbage sent to the neighbours under the signed waste deals: `(amount, price)` in
/// signing order. Empty while the deals rule is off.
fn export_deals(sim: &Simulation) -> Vec<(i64, i64)> {
    if !sim.deals_rules() {
        return Vec::new();
    }
    sim.deals()
        .iter()
        .filter(|d| d.resource == RESOURCE_WASTE)
        .map(|d| (i64::from(d.amount), i64::from(d.price)))
        .collect()
}

/// Gives each zone its share of `left` units, in proportion to what it makes (`weights`); the
/// shares add up to `left` exactly. Returns the units no tile could hold.
fn pile_up(sim: &mut Simulation, zones: &[Zone], weights: &[i64], left: i64) -> i64 {
    let total: i64 = weights.iter().sum();
    let size = sim.world_size();
    let (mut cumulated, mut given, mut lost) = (0, 0, 0);
    for (zone, weight) in zones.iter().zip(weights) {
        cumulated += weight;
        let upto = if total == 0 { 0 } else { left * cumulated / total };
        let share = upto - given;
        given = upto;
        if share > 0 {
            let state = &mut sim.extensions_mut().waste_state;
            lost += deposit(state, (zone.x, zone.y), share, size);
        }
    }
    lost
}

/// Hook body of `ext_monthly_balance`: one month of garbage. Returns the dollars paid to the
/// neighbours for the exports (a cost is positive). 0 while the rules do not act.
pub(crate) fn monthly_balance(sim: &mut Simulation) -> i32 {
    if !sim.waste_active() {
        return 0;
    }
    sim.repair_waste();
    let zones = sim.waste_zones();
    let centres = sim.waste_sites(GENRE_RECYCLING);
    let kept: Vec<i64> = zones
        .iter()
        .map(|z| z.base - recycled(z, &centres))
        .collect();
    let produced: i64 = zones.iter().map(|z| z.base).sum();
    let net: i64 = kept.iter().sum();

    let landfills = sim.waste_sites(GENRE_LANDFILL);
    let rooms = landfills
        .iter()
        .map(|s| LANDFILL_CAPACITY - sim.extensions().waste_state.fill_at(s.x, s.y))
        .collect();
    let burn = sim.waste_sites(GENRE_INCINERATOR).len() as i64 * INCINERATOR_CAPACITY;
    let energy = sim.waste_sites(GENRE_WASTE_TO_ENERGY).len() as i64 * WTE_CAPACITY;
    let mut pool = Pool::new(burn, energy, rooms);

    let after_treatment = net - pool.absorb(net);
    let (exported, cost) = export(after_treatment, &export_deals(sim));
    let left = after_treatment - exported;

    // spare capacity eats the old pile slowly (nothing is spare when something was left over)
    let old_pile: Vec<(u32, u8)> = sim.extensions().waste_state.piles().collect();
    for (index, units) in old_pile {
        if pool.is_exhausted() {
            break;
        }
        let eaten = pool.absorb(i64::from(units).min(BACKLOG_DECAY));
        let state = &mut sim.extensions_mut().waste_state;
        state.set_pile(index, units - eaten as u8);
    }
    let lost = pile_up(sim, &zones, &kept, left);
    for (site, buried) in landfills.iter().zip(&pool.buried) {
        let state = &mut sim.extensions_mut().waste_state;
        let fill = state.fill_at(site.x, site.y);
        state.set_fill(site.x, site.y, fill + buried);
    }
    sim.extensions_mut().waste_report = WasteReport {
        produced,
        treated: pool.treated(),
        recycled: produced - net,
        exported,
        lost,
        export_cost: cost,
        energised: pool.energised,
    };
    cost.clamp(0, i64::from(i32::MAX)) as i32
}
