//! What the deals do to a block: crime, air pollution and land value. The building must stand
//! (power is not needed: a bad neighbour is one in the dark too).

use super::{deal_of, DealSpec, Drawback};
use crate::simulation::Simulation;

/// The sum of `pick` over the standing deal buildings, at their distance from `(x, y)`.
fn total(sim: &Simulation, x: i32, y: i32, pick: fn(&DealSpec) -> Drawback) -> i32 {
    if !sim.reward_active() {
        return 0;
    }
    let list = sim.extensions().structure_list.as_slice();
    list.iter()
        .filter_map(|s| deal_of(s.genre).map(|d| (s, d)))
        .filter(|(s, _)| sim.is_intact(s))
        .map(|(s, d)| pick(d).at(s.distance(x, y)))
        .sum()
}

/// Crime `z` of the block at world tile `(x, y)` with the deals around it. The caller clamps.
pub(crate) fn crime(sim: &Simulation, x: i32, y: i32, z: i32) -> i32 {
    z + total(sim, x, y, |d| d.crime)
}

/// Pollution `p` of the block at world tile `(x, y)` with the deals around it. The caller clamps.
pub(crate) fn pollution(sim: &Simulation, x: i32, y: i32, p: i32) -> i32 {
    p + total(sim, x, y, |d| d.pollution)
}

/// Land value `v` of the block at world tile `(x, y)` less the deals' malus. The caller clamps.
pub(crate) fn land_value(sim: &Simulation, x: i32, y: i32, v: i32) -> i32 {
    v - total(sim, x, y, |d| d.land_malus)
}
