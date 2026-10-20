//! What the garbage and its buildings do to a block: pollution and land value.

use super::{BUILDING_POLLUTION, LAND_VALUE_DIV, POLLUTION_DIV};
use crate::simulation::Simulation;

/// The most garbage on the tiles of the `size` x `size` block whose top-left tile is `(x, y)`.
fn block_pile(sim: &Simulation, x: i32, y: i32, size: i32) -> i32 {
    let (w, h) = sim.world_size();
    let state = &sim.extensions().waste_state;
    let mut most = 0;
    for tx in x..(x + size).min(w) {
        for ty in y..(y + size).min(h) {
            most = most.max(i32::from(state.pile_at((tx * h + ty) as u32)));
        }
    }
    most
}

/// Pollution of the working landfills, incinerators and plants at the block: the sum over the
/// buildings, each falling off linearly with the distance to its footprint.
fn building_pollution(sim: &Simulation, x: i32, y: i32) -> i32 {
    let mut total = 0;
    for s in sim.extensions().structure_list.as_slice() {
        let Some(&(_, power, radius)) = BUILDING_POLLUTION.iter().find(|b| b.0 == s.genre) else {
            continue;
        };
        let d = s.distance(x, y);
        if d <= radius && sim.structure_works(s) {
            total += power * (radius + 1 - d) / (radius + 1);
        }
    }
    total
}

/// Pollution `p` of the block at world tile `(x, y)` with the garbage piled there and the
/// buildings around. The caller clamps. Inert while the rules do not act.
pub(crate) fn pollution(sim: &Simulation, x: i32, y: i32, p: i32) -> i32 {
    if !sim.waste_active() {
        return p;
    }
    let size = sim.pollution_density_map.block_size();
    p + block_pile(sim, x, y, size) / POLLUTION_DIV + building_pollution(sim, x, y)
}

/// Land value `v` of the block at world tile `(x, y)` less what the garbage piled there costs.
/// The caller clamps. Inert while the rules do not act.
pub(crate) fn land_value(sim: &Simulation, x: i32, y: i32, v: i32) -> i32 {
    if !sim.waste_active() {
        return v;
    }
    let size = sim.land_value_map.block_size();
    v - block_pile(sim, x, y, size) / LAND_VALUE_DIV
}
