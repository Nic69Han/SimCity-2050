//! The meteor: a crater of rubble and a fire.

use super::{draw, MESSAGE_METEOR};
use crate::disasters::{random_fire, random_rubble};
use crate::relief::is_water;
use crate::simulation::Simulation;

/// Side of the crater, in tiles.
pub const CRATER_SIDE: i32 = 3;

/// Drops a meteor: a drawn centre (the whole crater stays on the map), classic rubble on every
/// tile of the 3 x 3 crater that is not water, and a classic fire on the centre (water spared too).
/// Returns the centre.
pub fn start(sim: &mut Simulation) -> (i32, i32) {
    let (w, h) = sim.world_size();
    let r = CRATER_SIDE / 2;
    let (cx, cy) = (r + draw(sim, w - 2 * r), r + draw(sim, h - 2 * r));
    for x in cx - r..=cx + r {
        for y in cy - r..=cy + r {
            if sim.tile(x, y).is_some_and(is_water) {
                continue;
            }
            let tile = if (x, y) == (cx, cy) {
                random_fire(&mut sim.rng)
            } else {
                random_rubble(&mut sim.rng)
            };
            sim.set_tile(x, y, tile);
        }
    }
    sim.send_message(MESSAGE_METEOR, cx as i16, cy as i16, true, true);
    (cx, cy)
}
