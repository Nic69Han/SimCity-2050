//! The disasters on a [`Simulation`]: the switch, the trigger, the stats and the yearly pass. See
//! the module documentation of [`crate::disasters2`].

use super::{
    drought, meteor, riot, ufo, DisasterState, CHANCE_RANGE, DROUGHT_CHANCE, KIND_DROUGHT,
    KIND_LAST, KIND_METEOR, KIND_RIOT, KIND_UFO, METEOR_CHANCE, RIOT_CHANCE, UFO_CHANCE,
};
use crate::simulation::Simulation;

/// Numbers of [`Simulation::disaster2_stats`].
pub const STATS_SIZE: usize = 4;

/// What [`Simulation::trigger_disaster`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisasterResult {
    /// The disaster happened.
    Done = 1,
    /// The rule is off.
    RulesOff = 0,
    /// Unknown kind, or a riot without residential zone.
    Impossible = -1,
}

/// A draw in `0..n` (`n >= 1`) from the engine's generator.
pub(super) fn draw(sim: &mut Simulation, n: i32) -> i32 {
    i32::from(sim.rng.random((n - 1).clamp(0, i32::from(i16::MAX)) as i16))
}

/// One yearly chance, per mille.
fn chance(sim: &mut Simulation, per_mille: i16) -> bool {
    draw(sim, i32::from(CHANCE_RANGE)) < i32::from(per_mille)
}

impl Simulation {
    /// Whether the extended disasters are on (off by default: the engine is the original).
    pub fn disaster2_rules(&self) -> bool {
        self.extensions().disasters2
    }

    /// Turns the extended disasters on or off. Off ends a drought at once and forgets the last one.
    pub fn set_disaster2_rules(&mut self, on: bool) {
        let ext = self.extensions_mut();
        ext.disasters2 = on;
        if !on {
            ext.disaster_state = DisasterState::default();
            ext.disaster_report = Default::default();
        }
        drought::sync_water(self);
    }

    /// Forgets the state of a rule that is off (a loaded file).
    pub(crate) fn repair_disasters(&mut self) {
        if !self.disaster2_rules() {
            self.extensions_mut().disaster_state = DisasterState::default();
        }
    }

    /// Starts the disaster `kind` now (1 riot, 2 UFO, 3 meteor, 4 drought), whatever the chance and
    /// `enable_disasters`, and the crime for a riot. `RulesOff` with the rule off, `Impossible` for
    /// another kind or a riot in a city without residential zone.
    pub fn trigger_disaster(&mut self, kind: i32) -> DisasterResult {
        if !self.disaster2_rules() {
            return DisasterResult::RulesOff;
        }
        if !(1..=KIND_LAST).contains(&kind) {
            return DisasterResult::Impossible;
        }
        match self.start_disaster(kind) {
            Some(()) => DisasterResult::Done,
            None => DisasterResult::Impossible,
        }
    }

    /// Starts `kind` (valid, rule on) and records it. `None` when it cannot happen.
    fn start_disaster(&mut self, kind: i32) -> Option<()> {
        let at = match kind {
            KIND_RIOT => riot::start(self)?,
            KIND_UFO => ufo::start(self),
            KIND_METEOR => meteor::start(self),
            _ => {
                drought::start(self);
                (-1, -1)
            }
        };
        let report = &mut self.extensions_mut().disaster_report;
        (report.last, report.x, report.y) = (kind as u8, at.0, at.1);
        Some(())
    }

    /// `[months_of_drought_left, last_disaster (0..=4), x, y]` (x, y: -1 when none). All 0 (and
    /// -1) while the rule is off.
    pub fn disaster2_stats(&self) -> [i32; STATS_SIZE] {
        if !self.disaster2_rules() {
            return [0, 0, -1, -1];
        }
        let ext = self.extensions();
        let last = ext.disaster_report;
        [
            i32::from(ext.disaster_state.drought_months),
            i32::from(last.last),
            last.x,
            last.y,
        ]
    }
}

/// The yearly pass: each kind may happen (see the module documentation). Draws nothing and
/// changes nothing while the rule or `enable_disasters` is off (the drought runs down in the
/// valves hook, month by month). Returns 0 (disasters cost nothing here).
pub(crate) fn monthly_balance(sim: &mut Simulation) -> i32 {
    if !sim.disaster2_rules() {
        return 0;
    }
    if sim.enable_disasters {
        if riot::condition(sim) && chance(sim, RIOT_CHANCE) {
            let _ = sim.start_disaster(KIND_RIOT);
        }
        if chance(sim, UFO_CHANCE) {
            let _ = sim.start_disaster(KIND_UFO);
        }
        if chance(sim, METEOR_CHANCE) {
            let _ = sim.start_disaster(KIND_METEOR);
        }
        if !drought::active(sim) && chance(sim, DROUGHT_CHANCE) {
            let _ = sim.start_disaster(KIND_DROUGHT);
        }
    }
    drought::sync_water(sim);
    0
}

/// The valves hook: the drought.
pub(crate) fn valves(sim: &mut Simulation) {
    if !sim.disaster2_rules() {
        return;
    }
    drought::valves(sim);
    drought::sync_water(sim);
}
