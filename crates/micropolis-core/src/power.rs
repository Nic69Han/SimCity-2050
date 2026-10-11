//! Port of `power.cpp` — see PORTING.md.
//!
//! Power-grid scan: starting from the powered plants, flood-fill along
//! conductive tiles (`CONDBIT`) and record the powered tiles in
//! `Simulation::power_grid_map`. Copying those bits into the tiles' `PWRBIT`
//! is done by `doNilPower` / `setZonePower` (simulate.cpp / zone.cpp), not here.

use crate::position::{Direction, Position};
use crate::simulation::{Simulation, NOWHERE};
use crate::tile::{Tile, CONDBIT};

/// Number of tiles that a coal power plant can supply power to.
const COAL_POWER_STRENGTH: i64 = 700;
/// Number of tiles that a nuclear power plant can supply power to.
const NUCLEAR_POWER_STRENGTH: i64 = 2000;

/// `MESSAGE_NOT_ENOUGH_POWER` from text.h (enum index 40).
const MESSAGE_NOT_ENOUGH_POWER: i16 = 40;

/// The four cardinal directions in the order the C++ loop visits them
/// (`DIR2_BEGIN` followed by `increment90`).
const CARDINALS: [Direction; 4] = [
    Direction::North,
    Direction::East,
    Direction::South,
    Direction::West,
];

impl Simulation {
    /// Port of `Micropolis::testForConductive`: is there a conducting tile
    /// next to `pos` in direction `test_dir` that is not yet powered?
    pub fn test_for_conductive(&self, pos: Position, test_dir: Direction) -> bool {
        let (w, h) = self.world_size();
        let mut moved = pos;
        if moved.step(test_dir, w, h) {
            let t: Tile = self.tile(moved.x, moved.y).unwrap_or(0);
            if t & CONDBIT == CONDBIT && self.power_grid_map.world_get(moved.x, moved.y) == 0 {
                return true;
            }
        }
        false
    }

    /// Port of `Micropolis::doPowerScan`: rebuild `power_grid_map` from the
    /// coal and nuclear plant counts.
    pub fn do_power_scan(&mut self) {
        let (w, h) = self.world_size();

        // Clear power map.
        self.power_grid_map.clear();

        // Power that the combined coal and nuclear power plants can deliver.
        let max_power: i64 = self.coal_power_pop as i64 * COAL_POWER_STRENGTH
            + self.nuclear_power_pop as i64 * NUCLEAR_POWER_STRENGTH;

        let mut num_power: i64 = 0; // Amount of power used.

        while self.power_stack_pointer > 0 {
            let mut pos = self.pull_power_stack();
            let mut any_dir = Direction::Invalid;
            loop {
                num_power += 1;
                if num_power > max_power {
                    self.send_message(MESSAGE_NOT_ENOUGH_POWER, NOWHERE, NOWHERE, false, false);
                    return;
                }
                if any_dir != Direction::Invalid {
                    pos.step(any_dir, w, h);
                }
                self.power_grid_map.world_set(pos.x, pos.y, 1);
                let mut con_num = 0;
                for &dir in CARDINALS.iter() {
                    if con_num >= 2 {
                        break;
                    }
                    if self.test_for_conductive(pos, dir) {
                        con_num += 1;
                        any_dir = dir;
                    }
                }
                if con_num > 1 {
                    self.push_power_stack(pos);
                }
                if con_num == 0 {
                    break;
                }
            }
        }
    }

    /// Port of `Micropolis::pushPowerStack`: push if there is room
    /// (the original keeps two entries free).
    pub fn push_power_stack(&mut self, pos: Position) {
        if self.power_stack_pointer + 2 < self.power_stack.len() {
            self.power_stack_pointer += 1;
            self.power_stack[self.power_stack_pointer] = pos;
        }
    }

    /// Port of `Micropolis::pullPowerStack`. Must only be called with a
    /// non-empty stack.
    pub fn pull_power_stack(&mut self) -> Position {
        assert!(self.power_stack_pointer > 0);
        self.power_stack_pointer -= 1;
        self.power_stack[self.power_stack_pointer + 1]
    }
}
