//! The cars: a path of tiles, a position on it in sixteenths of a tile, and the rule that
//! saturated tiles slow a car down.

/// Sixteenths of a tile a car covers per tick on an empty road.
pub const MAX_SPEED: u32 = 8;
/// Sixteenths of a tile per tick on a fully saturated tile.
pub const MIN_SPEED: u32 = 1;
/// Sixteenths in a tile.
pub const TILE_16: u32 = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Car {
    pub id: u32,
    /// Tile index of the centre of the home zone.
    pub home: u32,
    /// Tiles to drive, first = where it started, last = the road of the destination.
    pub path: Vec<u32>,
    /// Index in `path` of the tile the car is on.
    pub at: usize,
    /// Sixteenths of a tile already driven towards `path[at + 1]` (< 16).
    pub progress: u32,
    /// Fleet tick at which the trip began.
    pub born: u64,
}

/// Speed (sixteenths of a tile per tick) on a tile of the given load: from [`MAX_SPEED`] on an
/// empty tile down to [`MIN_SPEED`] on a full one.
pub fn speed_at(load: u8) -> u32 {
    MAX_SPEED - (MAX_SPEED - MIN_SPEED) * u32::from(load) / 255
}

impl Car {
    pub fn tile(&self) -> u32 {
        self.path[self.at]
    }

    pub fn arrived(&self) -> bool {
        self.at + 1 >= self.path.len()
    }

    /// Drives one tick on a tile of load `load`; moves to the next tile when a tile is covered.
    pub fn advance(&mut self, load: u8) {
        if self.arrived() {
            return;
        }
        self.progress += speed_at(load);
        if self.progress >= TILE_16 {
            self.progress -= TILE_16;
            self.at += 1;
        }
    }
}
