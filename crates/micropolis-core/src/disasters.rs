//! Port of `disasters.cpp`: random disasters and scenario disasters (fire,
//! flood, earthquake, meltdown, fire bombs).
//!
//! Each C++ `Micropolis::` member is an `impl Simulation` method with the
//! snake_case name. The inline helpers `randomFire` and `randomRubble` from
//! micropolis.h are free functions here, [`random_fire`] and [`random_rubble`],
//! because they only need the generator.
//!
//! Calls into other modules (sprites, scenario simulation, front-end
//! messages) go through `shim_traffic.rs` for now. Notification-only calls
//! (`sendMessage`) are dropped there, as in PORTING.md rule 7.

use crate::position::Position;
use crate::rng::Rng;
use crate::simulation::{Scenario, Simulation};
use crate::tile::{
    Tile, ANIMBIT, BULLBIT, BURNBIT, CHANNEL, DIRT, FIRE, FLOOD, LASTZONE, LHTHR, LOMASK, NUCLEAR,
    RESBASE, RUBBLE, WATER_HIGH, WOODS5, ZONEBIT,
};

/// `MessageNumber` values from text.h, used with `send_message`.
const MESSAGE_FIRE_REPORTED: i16 = 20;
const MESSAGE_EARTHQUAKE: i16 = 23;
const MESSAGE_FIREBOMBING: i16 = 30;
const MESSAGE_FLOODING_REPORTED: i16 = 42;

/// Chance of a random disaster per game level (`DisChance` in `doDisasters`).
const DIS_CHANCE: [i16; 3] = [
    10 * 48, // Game level 0
    5 * 48,  // Game level 1
    60,      // Game level 2
];

/// Neighbour offsets for `makeFlood` and `doFlood`: north, east, south, west.
const DX: [i32; 4] = [0, 1, 0, -1];
const DY: [i32; 4] = [-1, 0, 1, 0];

/// Random fire tile (`randomFire()` in micropolis.h).
pub fn random_fire(rng: &mut Rng) -> Tile {
    (FIRE + (rng.random16() & 7) as Tile) | ANIMBIT
}

/// Random rubble tile (`randomRubble()` in micropolis.h).
pub fn random_rubble(rng: &mut Rng) -> Tile {
    (RUBBLE + (rng.random16() & 3) as Tile) | BULLBIT
}

/// Tile at `(x, y)`, or `DIRT` off the world. Callers check bounds first,
/// where the C++ indexes the map unchecked.
fn map_value(sim: &Simulation, x: i32, y: i32) -> Tile {
    sim.tile(x, y).unwrap_or(DIRT)
}

impl Simulation {
    /// `doDisasters()`: called once per simulation pass.
    pub fn do_disasters(&mut self) {
        if self.flood_count != 0 {
            self.flood_count -= 1;
        }

        if self.disaster_event != Scenario::None {
            self.scenario_disaster();
        }

        if !self.enable_disasters {
            // Disasters have been disabled
            return;
        }

        // The C++ falls back to LEVEL_EASY for out-of-range levels; GameLevel
        // cannot hold one.
        let x = self.game_level as usize;

        if self.rng.random(DIS_CHANCE[x]) == 0 {
            match self.rng.random(8) {
                0 | 1 => self.set_fire(),   // 2/9 chance a fire breaks out
                2 | 3 => self.make_flood(), // 2/9 chance for a flood
                4 => {
                    // 1/9 chance nothing happens (was airplane crash,
                    // which EA removed after 9/11, and requested it be
                    // removed from this code)
                }
                5 => self.make_tornado(),    // 1/9 chance tornado
                6 => self.make_earthquake(), // 1/9 chance earthquake
                _ => {
                    // 2/9 chance a scary monster arrives in a dirty town
                    if self.pollution_average > /* 80 */ 60 {
                        self.make_monster();
                    }
                }
            }
        }
    }

    /// `scenarioDisaster()`: the scripted disaster of the current scenario,
    /// then counts down `disaster_wait`.
    pub fn scenario_disaster(&mut self) {
        match self.disaster_event {
            Scenario::Dullsville => {}

            Scenario::SanFrancisco => {
                if self.disaster_wait == 1 {
                    self.make_earthquake();
                }
            }

            Scenario::Hamburg => {
                if self.disaster_wait % 10 == 0 {
                    self.make_fire_bombs();
                }
            }

            Scenario::Bern => {}

            Scenario::Tokyo => {
                if self.disaster_wait == 1 {
                    self.make_monster();
                }
            }

            Scenario::Detroit => {}

            Scenario::Boston => {
                if self.disaster_wait == 1 {
                    self.make_meltdown();
                }
            }

            Scenario::Rio => {
                if self.disaster_wait % 24 == 0 {
                    self.make_flood();
                }
            }

            // NOT_REACHED in the C++: `doDisasters` only calls this for a scenario.
            Scenario::None => {}
        }

        if self.disaster_wait > 0 {
            self.disaster_wait -= 1;
        } else {
            self.disaster_event = Scenario::None;
        }
    }

    /// `makeMeltdown()`: melts the first nuclear plant found (column-major
    /// scan). Does nothing if there is none.
    pub fn make_meltdown(&mut self) {
        let (w, h) = self.world_size();
        for x in 0..(w - 1) {
            for y in 0..(h - 1) {
                if map_value(self, x, y) & LOMASK == NUCLEAR {
                    self.do_meltdown(Position::new(x, y));
                    return;
                }
            }
        }
    }

    /// `fireBomb()`: one bomb explodes at a random location.
    pub fn fire_bomb(&mut self) {
        let (w, h) = self.world_size();
        let crash_x = i32::from(self.rng.random((w - 1) as i16));
        let crash_y = i32::from(self.rng.random((h - 1) as i16));
        self.make_explosion(crash_x, crash_y);
        self.send_message(
            MESSAGE_FIREBOMBING,
            crash_x as i16,
            crash_y as i16,
            true,
            true,
        );
    }

    /// `makeFireBombs()`: two or three bombs.
    pub fn make_fire_bombs(&mut self) {
        let mut count = 2 + (self.rng.random16() & 1);

        while count > 0 {
            self.fire_bomb();
            count -= 1;
        }

        // TODO: Schedule periodic fire bombs over time, every few ticks.
    }

    /// `makeEarthquake()`: shakes the city for 300..999 steps. Most hits turn a
    /// vulnerable tile to rubble, and one in four to fire.
    pub fn make_earthquake(&mut self) {
        let (w, h) = self.world_size();
        let strength = i32::from(self.rng.random(700)) + 300; // strength/duration of the earthquake

        self.do_earthquake(strength);

        self.send_message(
            MESSAGE_EARTHQUAKE,
            self.city_center_x,
            self.city_center_y,
            true,
            false,
        );

        for z in 0..strength {
            let x = i32::from(self.rng.random((w - 1) as i16));
            let y = i32::from(self.rng.random((h - 1) as i16));

            let tile = map_value(self, x, y);
            if self.vulnerable(i32::from(tile)) {
                let new_tile = if (z & 0x3) != 0 {
                    // 3 of 4 times reduce to rubble
                    random_rubble(&mut self.rng)
                } else {
                    // 1 of 4 times start fire
                    random_fire(&mut self.rng)
                };
                self.set_tile(x, y, new_tile);
            }
        }
    }

    /// `setFire()`: starts a fire at a random place, if it is a built-up,
    /// non-zone-centre tile.
    pub fn set_fire(&mut self) {
        let (w, h) = self.world_size();
        let x = i32::from(self.rng.random((w - 1) as i16));
        let y = i32::from(self.rng.random((h - 1) as i16));
        let z = map_value(self, x, y);

        if z & ZONEBIT == 0 {
            let z = z & LOMASK;
            if z > LHTHR && z < LASTZONE {
                let fire = random_fire(&mut self.rng);
                self.set_tile(x, y, fire);
                self.send_message(MESSAGE_FIRE_REPORTED, x as i16, y as i16, true, false);
            }
        }
    }

    /// `makeFire()`: user-requested fire. Tries 40 random spots and stops at
    /// the first burnable building.
    pub fn make_fire(&mut self) {
        let (w, h) = self.world_size();
        for _t in 0..40 {
            let x = i32::from(self.rng.random((w - 1) as i16));
            let y = i32::from(self.rng.random((h - 1) as i16));
            let z = map_value(self, x, y);

            if (z & ZONEBIT) == 0 && (z & BURNBIT) != 0 {
                let z = z & LOMASK;
                if z > 21 && z < LASTZONE {
                    let fire = random_fire(&mut self.rng);
                    self.set_tile(x, y, fire);
                    self.send_message(MESSAGE_FIRE_REPORTED, x as i16, y as i16, false, false);
                    return;
                }
            }
        }
    }

    /// `vulnerable(int tem)`: can an earthquake damage this tile?
    pub fn vulnerable(&self, tem: i32) -> bool {
        let tem2 = tem & i32::from(LOMASK);

        if tem2 < i32::from(RESBASE)
            || tem2 > i32::from(LASTZONE)
            || (tem & i32::from(ZONEBIT)) != 0
        {
            return false;
        }

        true
    }

    /// `makeFlood()`: floods one floodable tile next to a river edge. Gives up
    /// after 300 tries.
    pub fn make_flood(&mut self) {
        let (w, h) = self.world_size();
        for _z in 0..300 {
            let x = i32::from(self.rng.random((w - 1) as i16));
            let y = i32::from(self.rng.random((h - 1) as i16));
            let c = map_value(self, x, y) & LOMASK;

            if c > CHANNEL && c <= WATER_HIGH {
                // if riveredge
                for t in 0..4 {
                    let xx = x + DX[t];
                    let yy = y + DY[t];
                    if self.on_map(xx, yy) {
                        let c = map_value(self, xx, yy);

                        // tile is floodable
                        if c == DIRT || (c & (BULLBIT | BURNBIT)) == (BULLBIT | BURNBIT) {
                            self.set_tile(xx, yy, FLOOD);
                            self.flood_count = 30;
                            self.send_message(
                                MESSAGE_FLOODING_REPORTED,
                                xx as i16,
                                yy as i16,
                                true,
                                false,
                            );
                            return;
                        }
                    }
                }
            }
        }
    }

    /// `doFlood(const Position &pos)`: while the flood lasts, spreads it to
    /// neighbours with 1/8 chance each. Afterwards, recedes with 1/16 chance.
    pub fn do_flood(&mut self, pos: Position) {
        if self.flood_count > 0 {
            // Flood is not over yet
            for z in 0..4 {
                if (self.rng.random16() & 7) == 0 {
                    // 12.5% chance
                    let xx = pos.x + DX[z];
                    let yy = pos.y + DY[z];
                    if self.on_map(xx, yy) {
                        let c = map_value(self, xx, yy);
                        let t = c & LOMASK;

                        if (c & BURNBIT) == BURNBIT || c == DIRT || (WOODS5..FLOOD).contains(&t) {
                            if (c & ZONEBIT) == ZONEBIT {
                                self.fire_zone(Position::new(xx, yy), c);
                            }
                            let flood = FLOOD + self.rng.random(2) as Tile;
                            self.set_tile(xx, yy, flood);
                        }
                    }
                }
            }
        } else if (self.rng.random16() & 15) == 0 {
            // 1/16 chance
            self.set_tile(pos.x, pos.y, DIRT);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_tiles_are_in_range() {
        let mut rng = Rng::new(5);
        for _ in 0..200 {
            let f = random_fire(&mut rng);
            assert!((FIRE..FIRE + 8).contains(&(f & LOMASK)));
            assert!(f & ANIMBIT != 0);
            let r = random_rubble(&mut rng);
            assert!((RUBBLE..RUBBLE + 4).contains(&(r & LOMASK)));
            assert!(r & BULLBIT != 0);
        }
    }

    #[test]
    fn vulnerable_rules() {
        let sim = Simulation::with_default_size();
        assert!(!sim.vulnerable(i32::from(RESBASE) - 1));
        assert!(sim.vulnerable(i32::from(RESBASE)));
        assert!(sim.vulnerable(i32::from(LASTZONE)));
        assert!(!sim.vulnerable(i32::from(LASTZONE) + 1));
        assert!(!sim.vulnerable(i32::from(RESBASE) | i32::from(ZONEBIT)));
    }
}
