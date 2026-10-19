//! The cars: a path of tiles, a position on it in sixteenths of a tile, and the rule that
//! saturated tiles slow a car down.

/// Sixteenths of a tile a car covers per tick on an empty road.
pub const MAX_SPEED: u32 = 8;
/// Sixteenths of a tile per tick on a fully saturated tile.
pub const MIN_SPEED: u32 = 1;
/// Sixteenths in a tile.
pub const TILE_16: u32 = 16;

/// Which way of the round trip a driving car is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Leg {
    /// Home to the job zone.
    Out,
    /// Job zone back home.
    Back,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Car {
    pub id: u32,
    /// Tile index of the centre of the home zone.
    pub home: u32,
    /// Tile index of the centre of the job zone.
    pub job: u32,
    pub leg: Leg,
    /// Tiles to drive, first = where it started, last = the road of the destination.
    pub path: Vec<u32>,
    /// Index in `path` of the tile the car is on.
    pub at: usize,
    /// Sixteenths of a tile already driven towards `path[at + 1]` (< 16).
    pub progress: u32,
    /// Fleet tick at which the leg began.
    pub born: u64,
}

/// A car parked at the access road of its job zone. It is not on the road: it adds no load and
/// is not reported as a vehicle. Once `ready_at` has passed it waits for a return search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parked {
    pub id: u32,
    pub home: u32,
    pub job: u32,
    /// Fleet tick from which the car may start driving home.
    pub ready_at: u64,
    /// Return searches that found no path so far.
    pub failed: u32,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saturated_tiles_slow_a_car() {
        assert_eq!(speed_at(0), MAX_SPEED);
        assert_eq!(speed_at(255), MIN_SPEED);
        assert!((0..255u8).all(|l| speed_at(l) >= speed_at(l + 1)));
    }

    #[test]
    fn a_car_covers_a_tile_slower_on_a_full_road() {
        let ticks = |load| {
            let mut c = Car {
                id: 1,
                home: 0,
                job: 0,
                leg: Leg::Out,
                path: vec![0, 1],
                at: 0,
                progress: 0,
                born: 0,
            };
            let mut n = 0;
            while !c.arrived() {
                c.advance(load);
                n += 1;
            }
            n
        };
        assert_eq!(ticks(0), 2);
        assert_eq!(ticks(255), 16);
    }
}
