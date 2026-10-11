//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.

use crate::simulation::Simulation;
use crate::tile::Tile;
use crate::tool::{ConnectTileCommand, ToolEffects, ToolResult};

impl Simulation {
    /// connect.cpp: `Micropolis::connectTile`.
    pub(crate) fn connect_tile(
        &mut self,
        _x: i32,
        _y: i32,
        _cmd: ConnectTileCommand,
        _effects: &mut ToolEffects,
    ) -> ToolResult {
        todo!("connect.rs: connectTile")
    }

    /// generate.cpp: `Micropolis::isTree`.
    pub(crate) fn is_tree(&self, _cell: Tile) -> bool {
        todo!("generate.rs: isTree")
    }

    /// generate.cpp: `Micropolis::smoothTreesAt(x, y, preserve, effects)`.
    /// Named `smooth_trees_at_effects` because the three-argument C++
    /// overload `smoothTreesAt(x, y, preserve)` needs its own name in Rust.
    pub(crate) fn smooth_trees_at_effects(
        &mut self,
        _x: i32,
        _y: i32,
        _preserve: bool,
        _effects: &mut ToolEffects,
    ) {
        todo!("generate.rs: smoothTreesAt")
    }
}
