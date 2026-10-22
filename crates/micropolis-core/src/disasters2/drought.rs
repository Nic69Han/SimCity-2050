//! The drought: a slow residential valve and weaker pumps for a year.

use super::{DROUGHT_MONTHS, DROUGHT_VALVE, MESSAGE_DROUGHT, MONTHS_PER_PASS};
use crate::simulation::{Simulation, NOWHERE, RES_VALVE_RANGE};

/// Whether a drought is running (the rule must be on too).
pub fn active(sim: &Simulation) -> bool {
    sim.disaster2_rules() && sim.extensions().disaster_state.drought_months > 0
}

/// Starts a drought of [`DROUGHT_MONTHS`] months (a running one starts over, it does not add up).
pub fn start(sim: &mut Simulation) {
    sim.extensions_mut().disaster_state.drought_months = DROUGHT_MONTHS;
    let no = NOWHERE as i16;
    sim.send_message(MESSAGE_DROUGHT, no, no, false, true);
    sync_water(sim);
}

/// A yearly pass: [`MONTHS_PER_PASS`] months of drought are over.
pub fn pass(sim: &mut Simulation) {
    let months = &mut sim.extensions_mut().disaster_state.drought_months;
    *months = months.saturating_sub(MONTHS_PER_PASS);
}

/// The valves hook: the residential valve loses [`DROUGHT_VALVE`], inside its range.
pub fn valves(sim: &mut Simulation) {
    if active(sim) {
        let v = i32::from(sim.res_valve) - i32::from(DROUGHT_VALVE);
        sim.res_valve = v.max(-RES_VALVE_RANGE) as i16;
    }
}

/// Makes the pumps match the drought: halved reach while it runs with the water rule on.
pub fn sync_water(sim: &mut Simulation) {
    let weak = active(sim) && sim.water_rules();
    if sim.water().is_weak() != weak {
        sim.water_mut().set_weak(weak);
    }
}
