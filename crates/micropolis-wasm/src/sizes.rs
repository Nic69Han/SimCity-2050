//! wasm adapter: map sizes (translation only, ARCHITECTURE.md rule 4).
//!
//! `City::new_sized` starts a new random city on a map of any size the engine accepts
//! (80x67 minimum, 512x512 maximum; the original game is 120x100). Every map can be saved:
//! `save_city` (saves.rs) writes a plain `.cty` for 120x100 and an extended city file for other
//! sizes. `save_cty` still writes only the plain `.cty` format, so it refuses any other size with
//! the code `size_not_saveable`.
//!
//! Error values are stable codes (the JavaScript error message). The checks live in plain
//! functions returning `&'static str` codes, so the native tests can run them: `JsError` can
//! only be built on the wasm target.

use crate::{City, NEW_CITY_PASSES, NEW_CITY_SPEED, STARTING_YEAR};
use micropolis_core::fileio::{CITY_MAX_HEIGHT, CITY_MAX_WIDTH, CITY_MIN_HEIGHT, CITY_MIN_WIDTH};
use micropolis_core::simulation::Simulation;
use micropolis_core::{DEFAULT_WORLD_H, DEFAULT_WORLD_W};
use wasm_bindgen::prelude::*;

/// Smallest map the engine accepts: the original terrain generator needs room for its
/// island, river and lake placements (80 wide, 67 high).
pub const MIN_WIDTH: i32 = CITY_MIN_WIDTH;
pub const MIN_HEIGHT: i32 = CITY_MIN_HEIGHT;
/// Largest map the page offers.
pub const MAX_WIDTH: i32 = CITY_MAX_WIDTH;
pub const MAX_HEIGHT: i32 = CITY_MAX_HEIGHT;

/// Stable error codes.
pub const ERR_SIZE_OUT_OF_RANGE: &str = "size_out_of_range";
pub const ERR_SIZE_NOT_SAVEABLE: &str = "size_not_saveable";

/// Whether a `width` x `height` map is one the engine accepts.
pub fn check_size(width: i32, height: i32) -> Result<(), &'static str> {
    if (MIN_WIDTH..=MAX_WIDTH).contains(&width) && (MIN_HEIGHT..=MAX_HEIGHT).contains(&height) {
        Ok(())
    } else {
        Err(ERR_SIZE_OUT_OF_RANGE)
    }
}

/// The new random city of [`City::new_sized`]: the same starting year, speed and passes as
/// [`City::new_random_city`], on a map of the given size.
pub fn new_sized_city(width: i32, height: i32, seed: i32) -> Result<City, &'static str> {
    check_size(width, height)?;
    let mut sim = Simulation::new(width, height);
    sim.starting_year = STARTING_YEAR;
    sim.new_random_city(seed);
    sim.set_speed(NEW_CITY_SPEED);
    sim.set_passes(NEW_CITY_PASSES);
    Ok(City { sim })
}

/// Whether a map of this size is the original 120x100, the only size a plain `.cty` describes.
pub fn is_cty_size(width: i32, height: i32) -> bool {
    (width, height) == (DEFAULT_WORLD_W, DEFAULT_WORLD_H)
}

#[wasm_bindgen]
impl City {
    /// A new random city on a `width` x `height` map, generated from `seed`. Throws
    /// `size_out_of_range` when the size is outside 80x67 .. 512x512.
    pub fn new_sized(width: i32, height: i32, seed: i32) -> Result<City, JsError> {
        new_sized_city(width, height, seed).map_err(JsError::new)
    }

    /// The map size limits as `[min_width, min_height, max_width, max_height]`.
    pub fn size_limits() -> Vec<i32> {
        vec![MIN_WIDTH, MIN_HEIGHT, MAX_WIDTH, MAX_HEIGHT]
    }

    /// Whether the city can be saved: always true, since `save_city` writes every size.
    pub fn is_saveable(&self) -> bool {
        true
    }

    /// Makes this city the city of `other` (made by `new_sized`), in place: this JavaScript
    /// object stays the same, so the page's tools and playback keep their reference. `other`
    /// is consumed and must not be used afterwards.
    pub fn adopt(&mut self, other: City) {
        self.sim = other.sim;
    }

    /// The city file of any size (the same as `save_city`, kept for the page).
    pub fn save_checked(&self) -> Result<Vec<u8>, JsError> {
        self.save_city()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_are_inclusive() {
        assert_eq!(check_size(80, 67), Ok(()));
        assert_eq!(check_size(512, 512), Ok(()));
        assert_eq!(check_size(120, 100), Ok(()));
        assert_eq!(check_size(79, 67), Err(ERR_SIZE_OUT_OF_RANGE));
        assert_eq!(check_size(80, 66), Err(ERR_SIZE_OUT_OF_RANGE));
        assert_eq!(check_size(513, 100), Err(ERR_SIZE_OUT_OF_RANGE));
        assert_eq!(check_size(100, 513), Err(ERR_SIZE_OUT_OF_RANGE));
        assert_eq!(check_size(0, 0), Err(ERR_SIZE_OUT_OF_RANGE));
        assert_eq!(check_size(-120, 100), Err(ERR_SIZE_OUT_OF_RANGE));
    }

    #[test]
    fn only_the_original_size_is_a_cty_size() {
        assert!(is_cty_size(120, 100));
        assert!(!is_cty_size(100, 80));
        assert!(!is_cty_size(120, 101));
        assert!(!is_cty_size(300, 250));
    }

    #[test]
    fn new_sized_city_has_the_requested_size() {
        let city = new_sized_city(160, 120, 3).expect("valid size");
        assert_eq!((city.width(), city.height()), (160, 120));
        assert_eq!(city.tiles().len(), 160 * 120);
        assert_eq!(city.speed(), NEW_CITY_SPEED as i32);
        assert!(city.is_saveable());
        assert_eq!(city.year(), STARTING_YEAR as i32);
    }

    #[test]
    fn new_sized_rejects_out_of_range_sizes() {
        assert!(matches!(
            new_sized_city(79, 100, 1),
            Err(ERR_SIZE_OUT_OF_RANGE)
        ));
        assert!(matches!(
            new_sized_city(120, 600, 1),
            Err(ERR_SIZE_OUT_OF_RANGE)
        ));
    }

    #[test]
    fn new_sized_is_deterministic_per_seed_and_size() {
        let a = new_sized_city(97, 83, 5).expect("valid size");
        let b = new_sized_city(97, 83, 5).expect("valid size");
        let c = new_sized_city(97, 83, 6).expect("valid size");
        assert_eq!(a.tiles(), b.tiles());
        assert_ne!(a.tiles(), c.tiles());
    }

    #[test]
    fn size_120x100_is_the_original_city() {
        // The same map as `City::new_random_city` on the default size.
        let sized = new_sized_city(120, 100, 9).expect("valid size");
        let mut plain = City::new(1);
        plain.new_random_city(9);
        assert_eq!(sized.tiles(), plain.tiles());
        assert!(sized.is_saveable());
        assert_eq!(
            sized.save_cty().unwrap().len(),
            micropolis_core::fileio::CTY_SIZE
        );
    }

    #[test]
    fn save_checked_writes_every_size() {
        // 120x100 is a plain .cty; another size is an extended file (saves.rs, save_city).
        let original = new_sized_city(120, 100, 9).expect("valid size");
        assert_eq!(
            original.save_checked().unwrap().len(),
            micropolis_core::fileio::CTY_SIZE
        );
        let big = new_sized_city(160, 120, 9).expect("valid size");
        let bytes = big.save_checked().unwrap();
        assert_eq!(&bytes[..4], b"MCTY");
        assert!(big.is_saveable());
    }
}
