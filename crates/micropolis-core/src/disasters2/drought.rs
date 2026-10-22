//! The drought: a slow residential valve and weaker pumps for a year.

use super::{DROUGHT_MONTHS, DROUGHT_VALVE, MESSAGE_DROUGHT};
use crate::simulation::{Simulation, CITYTIMES_PER_MONTH, NOWHERE, RES_VALVE_RANGE};

/// Whether a drought is running (the rule must be on too).
pub fn active(sim: &Simulation) -> bool {
    sim.disaster2_rules() && sim.extensions().disaster_state.drought_months > 0
}

/// Starts a drought of [`DROUGHT_MONTHS`] months (a running one starts over, it does not add up).
pub fn start(sim: &mut Simulation) {
    let month = current_month(sim);
    let ext = sim.extensions_mut();
    ext.disaster_state.drought_months = DROUGHT_MONTHS;
    ext.disaster_report.last_month = month;
    let no = NOWHERE as i16;
    sim.send_message(MESSAGE_DROUGHT, no, no, false, true);
    sync_water(sim);
}

/// The game month counter (months since the city's start).
fn current_month(sim: &Simulation) -> i64 {
    sim.city_time / i64::from(CITYTIMES_PER_MONTH)
}

/// One month of drought is over for each game month that went by since the last call (at most
/// [`DROUGHT_MONTHS`], whatever a jump of the clock). The first call only notes the month. Needs no
/// tax pass, so a drought also ends in a city without residents.
pub fn count_months(sim: &mut Simulation) {
    let now = current_month(sim);
    let ext = sim.extensions_mut();
    let last = ext.disaster_report.last_month;
    ext.disaster_report.last_month = now;
    if last < 0 {
        return;
    }
    let elapsed = (now - last).clamp(0, i64::from(DROUGHT_MONTHS)) as u16;
    let months = &mut ext.disaster_state.drought_months;
    *months = months.saturating_sub(elapsed);
}

/// The valves hook: a month of drought goes by per game month, then the residential valve loses
/// [`DROUGHT_VALVE`], inside its range.
pub fn valves(sim: &mut Simulation) {
    count_months(sim);
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
