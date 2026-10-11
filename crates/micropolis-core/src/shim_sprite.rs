//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.

use crate::simulation::Simulation;
use crate::tile::Tile;

// MessageNumber values from text.h (C++ enum starts at MESSAGE_NEED_MORE_RESIDENTIAL = 1).
pub(crate) const MESSAGE_HEAVY_TRAFFIC: i32 = 41;
pub(crate) const MESSAGE_PLANE_CRASHED: i32 = 24;
pub(crate) const MESSAGE_SHIP_CRASHED: i32 = 25;
pub(crate) const MESSAGE_TRAIN_CRASHED: i32 = 26;
pub(crate) const MESSAGE_HELICOPTER_CRASHED: i32 = 27;
pub(crate) const MESSAGE_EXPLOSION_REPORTED: i32 = 32;
pub(crate) const MESSAGE_MONSTER_SIGHTED: i32 = 21;
pub(crate) const MESSAGE_TORNADO_SIGHTED: i32 = 22;

impl Simulation {
    /// Owned by `message.rs` (`sendMessage`).
    pub(crate) fn send_message(
        &mut self,
        _mesg: i32,
        _x: i32,
        _y: i32,
        _picture: bool,
        _important: bool,
    ) {
        todo!("send_message: owned by the message module")
    }

    /// Owned by `tool.rs` (`tally`).
    pub(crate) fn tally(&self, _tile_value: Tile) -> bool {
        todo!("tally: owned by the tool module")
    }

    /// Owned by `tool.rs` (`bulldozerTool`).
    pub(crate) fn bulldozer_tool(&mut self, _x: i32, _y: i32) {
        todo!("bulldozer_tool: owned by the tool module")
    }
}
