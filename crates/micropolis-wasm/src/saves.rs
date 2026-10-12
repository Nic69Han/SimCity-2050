//! wasm adapter: saving and loading city files (translation only, ARCHITECTURE.md rule 4).
//!
//! `save_city` writes the city of any map size: a plain `.cty` for 120x100 (byte for byte the
//! original format) and an extended `MCTY` file for the other sizes (see `micropolis_core::fileio`).
//! `load_city` reads both, detecting the format from the bytes. Every error is the core's
//! `CityFileError`, shown as `<code>: <detail>` (`cty_bad_size`, `cty_bad_magic`,
//! `cty_bad_version`, `cty_size_out_of_range`, `cty_truncated`). A refused file leaves the city
//! untouched. The generator is seeded with the same seed as `load_cty`, so the same file always
//! gives the same city.
//!
//! The plain functions below hold the logic and are what the native tests run: `JsError` can only
//! be built on the wasm target.

use crate::{City, LOAD_SEED};
use micropolis_core::fileio::CityFileError;
use wasm_bindgen::prelude::*;

/// The city file of `city`, any size.
pub fn save_bytes(city: &City) -> Vec<u8> {
    city.sim.save_city()
}

/// Replaces the city of `city` by the one in `bytes` (any size, seeded with `LOAD_SEED`).
pub fn load_bytes(city: &mut City, bytes: &[u8]) -> Result<(), CityFileError> {
    city.sim.load_city(bytes, LOAD_SEED)
}

#[wasm_bindgen]
impl City {
    /// The city file of this city, for a map of any size: a `.cty` for 120x100, an extended
    /// `MCTY` file otherwise.
    pub fn save_city(&self) -> Result<Vec<u8>, JsError> {
        Ok(save_bytes(self))
    }

    /// Replaces this city by the city of a city file (a `.cty` or an `MCTY` file of any size
    /// from 80x67 to 512x512). On error, the message is `<code>: <detail>` and the city is
    /// unchanged.
    pub fn load_city(&mut self, bytes: &[u8]) -> Result<(), JsError> {
        load_bytes(self, bytes).map_err(|e| JsError::new(&e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sizes::new_sized_city;

    fn round_trip(w: i32, h: i32) {
        let city = new_sized_city(w, h, 6).expect("valid size");
        let bytes = save_bytes(&city);
        let mut back = new_sized_city(80, 67, 1).expect("valid size");
        load_bytes(&mut back, &bytes).expect("a file this crate wrote");
        assert_eq!((back.width(), back.height()), (w, h), "{w}x{h}");
        assert_eq!(
            save_bytes(&back),
            bytes,
            "{w}x{h}: saved again differs after one load"
        );
        assert_eq!(back.tiles(), {
            let mut again = new_sized_city(80, 67, 1).expect("valid size");
            load_bytes(&mut again, &bytes).unwrap();
            again.tiles()
        });
    }

    #[test]
    fn round_trips_at_several_sizes() {
        round_trip(97, 83);
        round_trip(120, 100);
        round_trip(300, 250);
    }

    #[test]
    fn a_120x100_city_is_a_cty() {
        let city = new_sized_city(120, 100, 2).expect("valid size");
        assert_eq!(save_bytes(&city).len(), micropolis_core::fileio::CTY_SIZE);
    }

    #[test]
    fn error_codes_are_the_core_codes() {
        let mut city = new_sized_city(97, 83, 1).expect("valid size");
        let code =
            |bytes: &[u8], city: &mut City| load_bytes(city, bytes).expect_err("refused").code();
        assert_eq!(code(&[1, 2, 3], &mut city), "cty_truncated");
        assert_eq!(code(&vec![0u8; 27_121], &mut city), "cty_bad_magic");
        let mut bad_version = save_bytes(&city);
        bad_version[5] = 9;
        assert_eq!(code(&bad_version, &mut city), "cty_bad_version");
        let mut bad_size = save_bytes(&city);
        bad_size[6..8].copy_from_slice(&40u16.to_be_bytes());
        assert_eq!(code(&bad_size, &mut city), "cty_size_out_of_range");
        let mut longer = save_bytes(&city);
        longer.push(0);
        assert_eq!(code(&longer, &mut city), "cty_bad_size");
    }

    #[test]
    fn a_refused_file_changes_nothing() {
        let mut city = new_sized_city(97, 83, 1).expect("valid size");
        let before = save_bytes(&city);
        assert!(load_bytes(&mut city, &before[..50]).is_err());
        assert_eq!(save_bytes(&city), before);
    }
}
