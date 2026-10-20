//! The effects of the services on the engine, one function per hook of
//! [`crate::extensions`]. Each answers its input while the services do not act.

use super::{
    is_prison, met_pct, EQ_MAX, EQ_VALVE_DIV, LIFE_BASE, LIFE_VALVE_DIV, POLLUTION_CUT_MAX_PCT,
    PRISON_CRIME_CUT_MAX_PCT, PRISON_CRIME_CUT_PCT, PRISON_LAND_MALUS, PRISON_LAND_MALUS_CAP,
    PRISON_LAND_RADIUS, VALVE_PUSH_CEILING,
};
use crate::simulation::Simulation;
use crate::structures::Structure;

/// `v` raised by `push`, never past `ceiling` (a value already there stays).
fn raised(v: i16, push: i32, ceiling: i32) -> i16 {
    if i32::from(v) >= ceiling {
        return v;
    }
    (i32::from(v) + push).min(ceiling) as i16
}

/// Hook body of `ext_valves`: the monthly pass, then a bounded push of the commercial valve with
/// the EQ and of the residential valve with the life expectancy (not past a stadium or airport
/// cap).
pub(crate) fn valves(sim: &mut Simulation) {
    if !sim.services_active() {
        return;
    }
    sim.service_month_pass();
    let (eq, life) = (sim.education_quotient(), sim.life_expectancy());
    if !sim.com_cap {
        sim.com_valve = raised(sim.com_valve, eq / EQ_VALVE_DIV, VALVE_PUSH_CEILING);
    }
    if !sim.res_cap {
        let push = (life - LIFE_BASE) / LIFE_VALVE_DIV;
        sim.res_valve = raised(sim.res_valve, push, VALVE_PUSH_CEILING);
    }
}

/// Hook body of `ext_pollution`: less pollution with a high EQ (linear, [`POLLUTION_CUT_MAX_PCT`]
/// at [`EQ_MAX`]).
pub(crate) fn pollution(sim: &Simulation, _x: i32, _y: i32, p: i32) -> i32 {
    if p == 0 || !sim.services_active() {
        return p;
    }
    let cut = p * sim.education_quotient() * POLLUTION_CUT_MAX_PCT / (EQ_MAX * 100);
    p - cut
}

/// The listed prisons that work (powered), with the percent of the demand they meet together.
fn working_prisons(sim: &Simulation) -> (Vec<Structure>, i32) {
    let list = sim.extensions().structure_list.as_slice();
    let prisons: Vec<Structure> = list
        .iter()
        .filter(|s| is_prison(s) && sim.structure_works(s))
        .copied()
        .collect();
    let places = prisons.iter().map(|s| capacity_of(s)).sum();
    let demand = sim.extensions().service_cache.prison_demand;
    (prisons, met_pct(places, demand))
}

fn capacity_of(s: &Structure) -> i32 {
    super::service_of(s.genre).map_or(0, |v| v.capacity)
}

/// Linear falloff in percent: 100 at the footprint, 0 just past `radius`.
fn falloff_pct(d: i32, radius: i32) -> i32 {
    if d > radius {
        0
    } else {
        100 * (radius + 1 - d) / (radius + 1)
    }
}

/// Hook body of `ext_crime`: the working prisons cut the crime in their radius, scaled by how
/// well their places meet the demand.
pub(crate) fn crime(sim: &Simulation, x: i32, y: i32, z: i32) -> i32 {
    if z == 0 || !sim.services_active() || sim.extensions().structure_list.is_empty() {
        return z;
    }
    let (prisons, effect) = working_prisons(sim);
    let cut: i32 = prisons
        .iter()
        .map(|s| PRISON_CRIME_CUT_PCT * falloff_pct(s.distance(x, y), s.kind().radius) / 100)
        .sum();
    let cut = cut.min(PRISON_CRIME_CUT_MAX_PCT) * effect / 100;
    z - z * cut / 100
}

/// Hook body of `ext_land_value`: the working prisons lower the land value nearby.
pub(crate) fn land_value(sim: &Simulation, x: i32, y: i32, v: i32) -> i32 {
    if !sim.services_active() || sim.extensions().structure_list.is_empty() {
        return v;
    }
    let (prisons, _) = working_prisons(sim);
    let malus: i32 = prisons
        .iter()
        .map(|s| PRISON_LAND_MALUS * falloff_pct(s.distance(x, y), PRISON_LAND_RADIUS) / 100)
        .sum();
    v - malus.min(PRISON_LAND_MALUS_CAP)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_valve_is_raised_up_to_the_ceiling_and_never_lowered() {
        assert_eq!(raised(0, 3, 500), 3);
        assert_eq!(raised(499, 3, 500), 500);
        assert_eq!(raised(500, 3, 500), 500);
        assert_eq!(raised(900, 3, 500), 900);
        assert_eq!(raised(-900, 3, 500), -897);
    }

    #[test]
    fn the_falloff_is_linear_and_ends_past_the_radius() {
        assert_eq!(falloff_pct(0, 9), 100);
        assert_eq!(falloff_pct(9, 9), 10);
        assert_eq!(falloff_pct(10, 9), 0);
    }
}
