//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.

use crate::position::{Direction, Position};
use crate::simulation::Simulation;
use crate::tile::Tile;

impl Simulation {
    /// Owned by the traffic module (`traffic.cpp` `getTileFromMap`).
    pub(crate) fn get_tile_from_map(
        &self,
        _pos: Position,
        _dir: Direction,
        _default_tile: Tile,
    ) -> Tile {
        todo!("get_tile_from_map: owned by the traffic module")
    }

    /// Owned by the initialize module (`initialize.cpp` `resetMapState`).
    pub(crate) fn reset_map_state(&mut self) {
        todo!("reset_map_state: owned by the initialize module")
    }

    /// Owned by the initialize module (`initialize.cpp` `resetEditorState`).
    pub(crate) fn reset_editor_state(&mut self) {
        todo!("reset_editor_state: owned by the initialize module")
    }

    /// Owned by the sprite/tool front-end plumbing (`stubs.cpp` `invalidateMaps`).
    pub(crate) fn invalidate_maps(&mut self) {
        todo!("invalidate_maps: owned by the misc module")
    }

    /// Owned by the budget module (`update.cpp` `updateFunds`).
    pub(crate) fn update_funds(&mut self) {
        todo!("update_funds: owned by the budget module")
    }

    /// Owned by the simulate module (`simulate.cpp` `doSimInit`).
    pub(crate) fn do_sim_init(&mut self) {
        todo!("do_sim_init: owned by the simulate module")
    }

    /// Owned by the simulate module (`main.cpp` `simUpdate`).
    pub(crate) fn sim_update(&mut self) {
        todo!("sim_update: owned by the simulate module")
    }
}
