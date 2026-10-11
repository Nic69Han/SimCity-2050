//! TEMPORARY stubs for functions whose modules are not integrated yet
//! (zone, sprite, simulate, evaluate/budget). No logic here; each stub is
//! deleted when its real module lands.

use crate::position::Position;
use crate::simulation::Simulation;
use crate::tile::Tile;

impl Simulation {
    pub(crate) fn do_meltdown(&mut self, _pos: Position) {
        todo!("sprite")
    }
    // simulate.cpp / misc (fireZone lives with the disaster code in the C++ sprite/simulate files)
    pub(crate) fn fire_zone(&mut self, _pos: Position, _ch: Tile) {
        todo!("zone")
    }
    pub(crate) fn repair_zone(&mut self, _pos: Position, _z_cent: Tile, _z_size: i16) {
        todo!("simulate")
    }
    pub(crate) fn do_special_zone(&mut self, _pos: Position, _power_on: bool) {
        todo!("simulate")
    }
    // simulate.cpp
    pub(crate) fn do_sim_init(&mut self) {
        todo!("simulate")
    }
    pub(crate) fn sim_update(&mut self) {
        todo!("simulate")
    }
}
