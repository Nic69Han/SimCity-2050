//! The UFO: a strip of destroyed tiles.

use super::{draw, MESSAGE_UFO, UFO_LENGTH};
use crate::simulation::Simulation;

/// The four directions of a strip: north, east, south, west.
const DIRECTIONS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

/// Sends a UFO over the city: from a drawn tile, in a drawn direction, [`UFO_LENGTH`] tiles are
/// destroyed like the monster does (`destroy_map_tile`: water and bare ground are spared). The strip
/// stops at the edge of the map. Returns where it came from.
pub fn start(sim: &mut Simulation) -> (i32, i32) {
    let (w, h) = sim.world_size();
    let (sx, sy) = (draw(sim, w), draw(sim, h));
    let (dx, dy) = DIRECTIONS[draw(sim, DIRECTIONS.len() as i32) as usize];
    for step in 0..UFO_LENGTH {
        let (x, y) = (sx + dx * step, sy + dy * step);
        if !sim.on_map(x, y) {
            break;
        }
        sim.destroy_map_tile((x << 4) + 8, (y << 4) + 8);
    }
    sim.send_message(MESSAGE_UFO, sx as i16, sy as i16, true, true);
    (sx, sy)
}
