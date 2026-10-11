//! TEMPORARY stubs for functions whose modules are not integrated yet
//! (zone, sprite, simulate, evaluate/budget). No logic here; each stub is
//! deleted when its real module lands.

use crate::position::Position;
use crate::simulation::{CityClass, Simulation};
use crate::tile::Tile;

pub(crate) const SPRITE_HELICOPTER: i32 = 2;

pub(crate) struct SimSprite {
    pub control: i16,
    pub dest_x: i16,
    pub dest_y: i16,
}

impl Simulation {
    // sprite.cpp
    pub(crate) fn get_sprite(&mut self, _kind: i32) -> Option<&mut SimSprite> {
        todo!("sprite")
    }
    pub(crate) fn make_explosion(&mut self, _x: i32, _y: i32) {
        todo!("sprite")
    }
    pub(crate) fn make_monster(&mut self) {
        todo!("sprite")
    }
    pub(crate) fn make_tornado(&mut self) {
        todo!("sprite")
    }
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
    // evaluate.cpp
    pub(crate) fn get_population(&self) -> i64 {
        todo!("evaluate")
    }
    pub(crate) fn get_city_class(&self, _pop: i64) -> CityClass {
        todo!("evaluate")
    }
    pub(crate) fn change_eval(&mut self) {
        todo!("evaluate")
    }
    // simulate.cpp
    pub(crate) fn do_sim_init(&mut self) {
        todo!("simulate")
    }
    pub(crate) fn sim_update(&mut self) {
        todo!("simulate")
    }
}
