//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.
//!
//! Owners: `sprite.cpp` (getSprite, makeExplosion, makeMonster, makeTornado),
//! `simulate.cpp` (doMeltdown, fireZone), `stubs.cpp` (doEarthquake) and
//! `message.cpp` (sendMessage). `sendMessage` and `doEarthquake` only notify a
//! front-end (PORTING.md rule 7), so their shims drop the notification.

use crate::position::Position;
use crate::simulation::Simulation;
use crate::tile::Tile;

/// `SPRITE_HELICOPTER` from the `SpriteType` enum in micropolis.h.
pub(crate) const SPRITE_HELICOPTER: i32 = 2;

/// Stand-in for the sprite module's `SimSprite`: only the fields traffic uses.
pub(crate) struct SimSprite {
    pub control: i16,
    pub dest_x: i16,
    pub dest_y: i16,
}

impl Simulation {
    /// `getSprite(int type)`: the live sprite of that type, if any.
    pub(crate) fn get_sprite(&mut self, _kind: i32) -> Option<&mut SimSprite> {
        todo!()
    }

    /// `makeExplosion(int x, int y)`.
    pub(crate) fn make_explosion(&mut self, _x: i32, _y: i32) {
        todo!()
    }

    /// `makeMonster()`.
    pub(crate) fn make_monster(&mut self) {
        todo!()
    }

    /// `makeTornado()`.
    pub(crate) fn make_tornado(&mut self) {
        todo!()
    }

    /// `doMeltdown(const Position &pos)`.
    pub(crate) fn do_meltdown(&mut self, _pos: Position) {
        todo!()
    }

    /// `fireZone(const Position &pos, MapValue ch)`.
    pub(crate) fn fire_zone(&mut self, _pos: Position, _ch: Tile) {
        todo!()
    }

    /// `doEarthquake(int strength)`: only plays a sound and calls the front-end.
    pub(crate) fn do_earthquake(&mut self, _strength: i32) {}

    /// `sendMessage(short, short, short, bool, bool)`: front-end notification only.
    pub(crate) fn send_message(
        &mut self,
        _mesg: i16,
        _x: i16,
        _y: i16,
        _picture: bool,
        _important: bool,
    ) {
    }
}
