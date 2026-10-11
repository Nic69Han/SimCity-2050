//! Port of `position.h` / `position.cpp`.

use crate::DEFAULT_WORLD_H as WORLD_H;
use crate::DEFAULT_WORLD_W as WORLD_W;

/// Eight compass directions plus an invalid marker, as in the original.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Direction {
    Invalid = 0,
    North,
    NorthEast,
    East,
    SouthEast,
    South,
    SouthWest,
    West,
    NorthWest,
}

impl Direction {
    const ALL: [Direction; 8] = [
        Direction::North,
        Direction::NorthEast,
        Direction::East,
        Direction::SouthEast,
        Direction::South,
        Direction::SouthWest,
        Direction::West,
        Direction::NorthWest,
    ];

    /// Rotate by `count` steps of 45 degrees, wrapping around (`rotate45`).
    pub fn rotate45(self, count: i32) -> Direction {
        debug_assert!(self != Direction::Invalid);
        let idx = (self as i32 - Direction::North as i32 + count).rem_euclid(8);
        Self::ALL[idx as usize]
    }
    pub fn rotate90(self) -> Direction {
        self.rotate45(2)
    }
    pub fn rotate180(self) -> Direction {
        self.rotate45(4)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

impl Position {
    pub fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }

    pub fn offset(self, dx: i32, dy: i32) -> Self {
        Self::new(self.x + dx, self.y + dy)
    }

    pub fn in_bounds(self, w: i32, h: i32) -> bool {
        self.x >= 0 && self.x < w && self.y >= 0 && self.y < h
    }

    /// Move one step. Returns `false` (and clamps into the world) if the
    /// step would leave the world of size `w` x `h`.
    ///
    /// DIVERGENCE FROM C++: the original has two bugs here. `NORTH_EAST`
    /// lacks a `break` and falls through into `EAST`; `SOUTH_WEST` moves
    /// unconditionally and always reports failure. This port implements the
    /// evident intent.
    pub fn step(&mut self, dir: Direction, w: i32, h: i32) -> bool {
        let (dx, dy) = match dir {
            Direction::Invalid => return true,
            Direction::North => (0, -1),
            Direction::NorthEast => (1, -1),
            Direction::East => (1, 0),
            Direction::SouthEast => (1, 1),
            Direction::South => (0, 1),
            Direction::SouthWest => (-1, 1),
            Direction::West => (-1, 0),
            Direction::NorthWest => (-1, -1),
        };
        let nx = self.x + dx;
        let ny = self.y + dy;
        if nx >= 0 && nx < w && ny >= 0 && ny < h {
            self.x = nx;
            self.y = ny;
            true
        } else {
            self.x = self.x.clamp(0, w - 1);
            self.y = self.y.clamp(0, h - 1);
            false
        }
    }

    /// Convenience for the default 120x100 world.
    pub fn step_default(&mut self, dir: Direction) -> bool {
        self.step(dir, WORLD_W, WORLD_H)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotations() {
        assert_eq!(Direction::North.rotate90(), Direction::East);
        assert_eq!(Direction::NorthWest.rotate45(1), Direction::North);
        assert_eq!(Direction::East.rotate180(), Direction::West);
        assert_eq!(Direction::North.rotate45(-1), Direction::NorthWest);
    }

    #[test]
    fn step_inside() {
        let mut p = Position::new(5, 5);
        assert!(p.step(Direction::NorthEast, 10, 10));
        assert_eq!(p, Position::new(6, 4));
        assert!(p.step(Direction::SouthWest, 10, 10));
        assert_eq!(p, Position::new(5, 5));
    }

    #[test]
    fn step_blocked_at_edges() {
        let mut p = Position::new(0, 0);
        assert!(!p.step(Direction::NorthWest, 10, 10));
        assert_eq!(p, Position::new(0, 0));
        let mut p = Position::new(9, 0);
        // Legacy C++ would slide EAST here; we refuse the diagonal move.
        assert!(!p.step(Direction::NorthEast, 10, 10));
        assert_eq!(p, Position::new(9, 0));
    }

    #[test]
    fn works_on_huge_worlds() {
        let mut p = Position::new(2_998, 4_000);
        assert!(p.step(Direction::SouthEast, 3_000, 5_000));
        assert!(!p.step(Direction::East, 3_000, 5_000));
    }
}
