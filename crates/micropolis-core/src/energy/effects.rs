//! What the plants do to a block: air pollution.

use super::{curve, is_plant_genre, spec_of};
use crate::simulation::Simulation;

/// Pollution intensity of the running catalog plants at distance `d` of a block (0 when the
/// plant is stopped, pollutes nothing or is out of reach): falls off linearly to 0 past the
/// radius.
fn pollution_of(genre: u8, age: u32, d: i32) -> i32 {
    let Some(spec) = spec_of(genre) else { return 0 };
    if spec.pollution == 0 || curve::power_at(spec, age) == 0 || d > spec.radius {
        return 0;
    }
    spec.pollution * (spec.radius + 1 - d) / (spec.radius + 1)
}

/// Pollution `p` of the block at world tile `(x, y)` with the plants around it. The caller
/// clamps. Inert while the rules do not act.
pub(crate) fn pollution(sim: &Simulation, x: i32, y: i32, p: i32) -> i32 {
    if !sim.energy_active() {
        return p;
    }
    let ext = sim.extensions();
    let mut total = 0;
    for s in ext.structure_list.as_slice() {
        if is_plant_genre(s.genre) && sim.structure_works(s) {
            let age = ext.energy_state.age_of(s.x, s.y);
            total += pollution_of(s.genre, age, s.distance(x, y));
        }
    }
    p + total
}

impl Simulation {
    /// Sum of the intensities of the running catalog plants (what the statistics report).
    pub(crate) fn energy_pollution_made(&self) -> i64 {
        let ext = self.extensions();
        ext.structure_list
            .as_slice()
            .iter()
            .filter(|s| is_plant_genre(s.genre) && self.structure_works(s))
            .map(|s| i64::from(pollution_of(s.genre, ext.energy_state.age_of(s.x, s.y), 0)))
            .sum()
    }
}
