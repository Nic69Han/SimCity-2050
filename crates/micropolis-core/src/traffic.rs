//! Port of `traffic.cpp`: traffic generation from a zone over the road network.
//!
//! Each C++ `Micropolis::` member is an `impl Simulation` method with the
//! snake_case name, except the two `makeTraffic` overloads: `make_traffic`
//! takes `(x, y)` and `make_traffic_from` takes a [`Position`].
//!
//! Sprite access (`getSprite`) lives in another module; see `shim_traffic.rs`.
//! World bounds come from the runtime world size instead of `WORLD_W` /
//! `WORLD_H`. Otherwise the logic, the RNG call order and the integer widths
//! follow the original.

use crate::position::{Direction, Position};
use crate::simulation::{Simulation, MAX_TRAFFIC_DISTANCE};
use crate::sprite::SPRITE_HELICOPTER;
use crate::tile::{
    Tile, COMBASE, DIRT, LASTPOWER, LASTRAIL, LHTHR, LOMASK, NUCLEAR, PORT, POWERBASE, ROADBASE,
    TELEBASE, TELELAST,
};

/// Destination zone of a trip (`ZoneType` in micropolis.h). The discriminant
/// indexes the target tables of [`Simulation::drive_done`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ZoneType {
    Commercial = 0,
    Industrial = 1,
    Residential = 2,
}

/// Perimeter offsets around a zone, as in `findPerimeterRoad`.
const PERIM_X: [i32; 12] = [-1, 0, 1, 2, 2, 2, 1, 0, -1, -2, -2, -2];
const PERIM_Y: [i32; 12] = [-2, -2, -2, -1, 0, 1, 2, 2, 2, 1, 0, -1];

/// Tile at `(x, y)` with the same meaning as an unchecked C++ `map[x][y]` read.
/// Callers test bounds first, so the default is never used.
fn map_value(sim: &Simulation, x: i32, y: i32) -> Tile {
    sim.tile(x, y).unwrap_or(DIRT)
}

impl Simulation {
    /// `makeTrafficAt(int x, int y, ZoneType dest)`.
    ///
    /// Does not clear the position stack first (unlike [`Self::make_traffic`]).
    /// Returns 1 if a connection was found, 0 otherwise.
    pub fn make_traffic_at(&mut self, x: i32, y: i32, dest: ZoneType) -> i16 {
        let pos = Position::new(x, y);
        if self.try_drive(pos, dest) {
            self.add_to_traffic_density_map();
            return 1;
        }
        0
    }

    /// `makeTraffic(int x, int y, ZoneType dest)`.
    pub fn make_traffic(&mut self, x: i32, y: i32, dest: ZoneType) -> i16 {
        self.make_traffic_from(Position::new(x, y), dest)
    }

    /// `makeTraffic(const Position &startPos, ZoneType dest)`.
    ///
    /// Returns 1 if a connection was found, 0 if not found, -1 if no road
    /// touches the zone perimeter.
    pub fn make_traffic_from(&mut self, start: Position, dest: ZoneType) -> i16 {
        self.cur_map_stack_pointer = 0; // Clear position stack

        let mut pos = start;
        if self.find_perimeter_road(&mut pos) {
            if self.try_drive(pos, dest) {
                self.add_to_traffic_density_map();
                return 1;
            }
            return 0;
        }
        -1
    }

    /// `addToTrafficDensityMap()`: adds traffic to every road tile on the
    /// position stack, and may send the helicopter to heavy traffic.
    pub fn add_to_traffic_density_map(&mut self) {
        // For each saved position of the drive
        while self.cur_map_stack_pointer > 0 {
            let pos = self.pull_pos();
            if self.on_map(pos.x, pos.y) {
                let tile = map_value(self, pos.x, pos.y) & LOMASK;

                if (ROADBASE..POWERBASE).contains(&tile) {
                    // Update traffic density.
                    let mut traffic = i32::from(self.traffic_density_map.world_get(pos.x, pos.y));
                    traffic += 50;
                    traffic = traffic.min(240);
                    self.traffic_density_map
                        .world_set(pos.x, pos.y, traffic as u8);

                    // Check for heavy traffic.
                    if traffic >= 240 && self.rng.random(5) == 0 {
                        self.traf_max_x = pos.x as i16;
                        self.traf_max_y = pos.y as i16;

                        // Direct helicopter towards heavy traffic
                        let dest_x = (i32::from(self.traf_max_x) * 16) as i16;
                        let dest_y = (i32::from(self.traf_max_y) * 16) as i16;
                        if let Some(idx) = self.get_sprite(SPRITE_HELICOPTER) {
                            let sprite = &mut self.sprites[idx];
                            if sprite.control == -1 {
                                sprite.dest_x = i32::from(dest_x);
                                sprite.dest_y = i32::from(dest_y);
                            }
                        }
                    }
                }
            }
        }
    }

    /// `pushPos(const Position &pos)`.
    pub fn push_pos(&mut self, pos: Position) {
        self.cur_map_stack_pointer += 1;
        let sp = self.cur_map_stack_pointer as usize;
        assert!(sp < MAX_TRAFFIC_DISTANCE + 1, "position stack overflow");
        self.cur_map_stack[sp] = pos;
    }

    /// `pullPos()`: returns the top-most position and pops it.
    pub fn pull_pos(&mut self) -> Position {
        assert!(self.cur_map_stack_pointer > 0, "position stack underflow");
        self.cur_map_stack_pointer -= 1;
        self.cur_map_stack[(self.cur_map_stack_pointer + 1) as usize]
    }

    /// `findPerimeterRoad(Position *pos)`: looks for a road on the zone
    /// perimeter. On success `pos` is moved onto that road tile.
    pub fn find_perimeter_road(&mut self, pos: &mut Position) -> bool {
        for z in 0..12 {
            let tx = pos.x + PERIM_X[z];
            let ty = pos.y + PERIM_Y[z];

            if self.on_map(tx, ty) && self.road_test(map_value(self, tx, ty)) {
                pos.x = tx;
                pos.y = ty;
                return true;
            }
        }
        false
    }

    /// `findPerimeterTelecom(const Position &pos)`. Not called (dead code in
    /// the original, behind `#if 0`). Kept for completeness, including its
    /// bug: the y coordinate is computed from `posX`.
    pub fn find_perimeter_telecom(&self, pos: Position) -> bool {
        for z in 0..12 {
            let tx = pos.x + PERIM_X[z];
            let ty = pos.x + PERIM_Y[z]; // sic: C++ uses posX here

            if self.on_map(tx, ty) {
                let tile = map_value(self, tx, ty) & LOMASK;
                if (TELEBASE..=TELELAST).contains(&tile) {
                    return true;
                }
            }
        }
        false
    }

    /// `tryDrive(const Position &startPos, ZoneType destZone)`: drives from
    /// `start` towards `dest`. On success the position stack holds some of the
    /// intermediate positions of the drive.
    ///
    /// The C++ `bug` note applies: after a dead end the stack is popped but
    /// `drive_pos` and `dir_last` are not restored.
    pub fn try_drive(&mut self, start: Position, dest: ZoneType) -> bool {
        let (w, h) = self.world_size();
        let mut dir_last = Direction::Invalid;
        let mut drive_pos = start;

        // Maximum distance to try
        let mut dist: i32 = 0;
        while dist < MAX_TRAFFIC_DISTANCE as i32 {
            let dir = self.try_go(drive_pos, dir_last);
            if dir != Direction::Invalid {
                // we found a road
                drive_pos.step(dir, w, h);
                dir_last = dir.rotate180();

                // Save pos every other move.
                // This also relates to Micropolis::trafficDensityMap::MAP_BLOCKSIZE
                if dist & 1 != 0 {
                    self.push_pos(drive_pos);
                }

                if self.drive_done(drive_pos, dest) {
                    // if destination is reached
                    return true; // pass
                }
            } else if self.cur_map_stack_pointer > 0 {
                // dead end, backup
                self.cur_map_stack_pointer -= 1;
                dist += 3;
            } else {
                return false; // give up at start
            }
            dist += 1;
        }

        false // gone MAX_TRAFFIC_DISTANCE
    }

    /// `tryGo(const Position &pos, Direction2 dirLast)`: drives one tile in a
    /// random allowed direction. Returns `Direction::Invalid` if no move.
    pub fn try_go(&mut self, pos: Position, dir_last: Direction) -> Direction {
        let mut directions = [Direction::Invalid; 4];

        // Find connections from current position.
        let mut dir = Direction::North;
        let mut count = 0;
        for slot in directions.iter_mut() {
            if dir != dir_last && self.road_test(self.get_tile_from_map(pos, dir, DIRT)) {
                // found a road in an allowed direction
                *slot = dir;
                count += 1;
            }
            dir = dir.rotate90();
        }

        if count == 0 {
            // dead end
            return Direction::Invalid;
        }

        // We have at least one way to go.
        if count == 1 {
            // only one solution
            if let Some(&d) = directions.iter().find(|&&d| d != Direction::Invalid) {
                return d;
            }
        }

        // more than one choice, draw a random number.
        let mut i = (self.rng.random16() & 3) as usize;
        while directions[i] == Direction::Invalid {
            i = (i + 1) & 3;
        }
        directions[i]
    }

    /// `getTileFromMap(const Position &pos, Direction2 dir, MapTile defaultTile)`:
    /// the tile next to `pos` in a N/E/S/W direction, or `default_tile` when
    /// off-world or for any other direction.
    pub fn get_tile_from_map(&self, pos: Position, dir: Direction, default_tile: Tile) -> Tile {
        let (w, h) = self.world_size();
        match dir {
            Direction::North => {
                if pos.y > 0 {
                    return map_value(self, pos.x, pos.y - 1) & LOMASK;
                }
                default_tile
            }
            Direction::East => {
                if pos.x < w - 1 {
                    return map_value(self, pos.x + 1, pos.y) & LOMASK;
                }
                default_tile
            }
            Direction::South => {
                if pos.y < h - 1 {
                    return map_value(self, pos.x, pos.y + 1) & LOMASK;
                }
                default_tile
            }
            Direction::West => {
                if pos.x > 0 {
                    return map_value(self, pos.x - 1, pos.y) & LOMASK;
                }
                default_tile
            }
            _ => default_tile,
        }
    }

    /// `driveDone(const Position &pos, ZoneType destZone)`: is one of the four
    /// neighbours a destination tile for `dest`?
    pub fn drive_done(&self, pos: Position, dest: ZoneType) -> bool {
        // commercial, industrial, residential destinations
        const TARGET_LOW: [Tile; 3] = [COMBASE, LHTHR, LHTHR];
        const TARGET_HIGH: [Tile; 3] = [NUCLEAR, PORT, COMBASE];

        let (w, h) = self.world_size();
        let l = TARGET_LOW[dest as usize]; // Lowest acceptable tile value
        let hi = TARGET_HIGH[dest as usize]; // Highest acceptable tile value
        let within = |z: Tile| z >= l && z <= hi;

        if pos.y > 0 && within(map_value(self, pos.x, pos.y - 1) & LOMASK) {
            return true;
        }
        if pos.x < w - 1 && within(map_value(self, pos.x + 1, pos.y) & LOMASK) {
            return true;
        }
        if pos.y < h - 1 && within(map_value(self, pos.x, pos.y + 1) & LOMASK) {
            return true;
        }
        if pos.x > 0 && within(map_value(self, pos.x - 1, pos.y) & LOMASK) {
            return true;
        }
        false
    }

    /// `roadTest(MapValue mv)`: can a car drive on this tile?
    pub fn road_test(&self, mv: Tile) -> bool {
        let tile = mv & LOMASK;

        if !(ROADBASE..=LASTRAIL).contains(&tile) {
            return false;
        }

        if (POWERBASE..LASTPOWER).contains(&tile) {
            return false;
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn road_test_table() {
        let sim = Simulation::with_default_size();
        assert!(!sim.road_test(DIRT));
        assert!(sim.road_test(ROADBASE));
        assert!(sim.road_test(LASTRAIL));
        assert!(!sim.road_test(POWERBASE));
        assert!(!sim.road_test(LASTPOWER - 1));
        assert!(sim.road_test(LASTPOWER));
        assert!(!sim.road_test(LASTRAIL + 1));
        // Status bits do not change the answer.
        assert!(sim.road_test(ROADBASE | crate::tile::BULLBIT));
    }

    #[test]
    fn position_stack_is_lifo() {
        let mut sim = Simulation::with_default_size();
        sim.push_pos(Position::new(1, 2));
        sim.push_pos(Position::new(3, 4));
        assert_eq!(sim.cur_map_stack_pointer, 2);
        assert_eq!(sim.pull_pos(), Position::new(3, 4));
        assert_eq!(sim.pull_pos(), Position::new(1, 2));
        assert_eq!(sim.cur_map_stack_pointer, 0);
    }
}
