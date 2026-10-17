//! wasm adapter: saving and loading city files (translation only, ARCHITECTURE.md rule 4).
//!
//! `save_city` writes the city of any map size: a plain `.cty` for 120x100 (byte for byte the
//! original format) while its relief is not edited, its relief rules are off and no extended rule
//! is on, and an extended `MCTY` file otherwise (version 2 carries the relief block, version 3
//! also the extensions block; see `micropolis_core::fileio`). `load_city` reads all of them,
//! detecting the format from the bytes, and restores the relief, the rules and the extended
//! rules of an `MCTY` version 2 or 3 file. Every error is the core's `CityFileError`, shown as
//! `<code>: <detail>` (`cty_bad_size`, `cty_bad_magic`, `cty_bad_version`,
//! `cty_size_out_of_range`, `cty_truncated`, `cty_bad_relief`, `cty_bad_extension`). A refused file leaves the city
//! untouched. The generator is seeded with the same seed as `load_cty`, so the same file always
//! gives the same city.
//!
//! The plain functions below hold the logic and are what the native tests run: `JsError` can only
//! be built on the wasm target.

use crate::{City, LOAD_SEED};
use micropolis_core::fileio::CityFileError;
use wasm_bindgen::prelude::*;

/// Code of `save_cty` on a city whose relief was edited or whose relief rules are on: a plain
/// `.cty` has no relief block, so the city can only be saved with `save_city`.
pub const ERR_RELIEF_NOT_SAVEABLE: &str = "relief_not_saveable";

/// Code of `save_cty` on a city with an extended rule on or a network that holds something: a plain
/// `.cty` has no extensions block, so the city can only be saved with `save_city`.
pub const ERR_EXTENSIONS_NOT_SAVEABLE: &str = "extensions_not_saveable";

/// The city file of `city`, any size.
pub fn save_bytes(city: &City) -> Vec<u8> {
    city.sim.save_city()
}

/// The plain `.cty` bytes of `city`: 120x100 only (`size_not_saveable` otherwise, as before), and
/// only when the relief is neither edited nor governed by the rules (`relief_not_saveable`),
/// since a `.cty` cannot hold them and would lose them silently.
pub fn save_cty_bytes(city: &City) -> Result<Vec<u8>, &'static str> {
    if !crate::sizes::is_cty_size(city.width(), city.height()) {
        return Err(crate::sizes::ERR_SIZE_NOT_SAVEABLE);
    }
    if city.sim.relief_edited() || city.sim.relief_rules() {
        return Err(ERR_RELIEF_NOT_SAVEABLE);
    }
    if city.sim.needs_extension_block() {
        return Err(ERR_EXTENSIONS_NOT_SAVEABLE);
    }
    Ok(city.sim.save_cty())
}

/// Replaces the city of `city` by the one in `bytes` (any size, seeded with `LOAD_SEED`).
pub fn load_bytes(city: &mut City, bytes: &[u8]) -> Result<(), CityFileError> {
    city.sim.load_city(bytes, LOAD_SEED)
}

#[wasm_bindgen]
impl City {
    /// The city file of this city, for a map of any size: a `.cty` for 120x100 (unless its relief
    /// was edited or its relief rules are on), an extended `MCTY` file otherwise.
    pub fn save_city(&self) -> Result<Vec<u8>, JsError> {
        Ok(save_bytes(self))
    }

    /// Replaces this city by the city of a city file (a `.cty` or an `MCTY` file of any size
    /// from 80x67 to 512x512, version 1 to 3). An `MCTY` file with a relief block restores the
    /// relief and the relief rules, one with an extensions block the extended rules. On error, the message is `<code>: <detail>` and the city is
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
    fn an_edited_relief_and_the_rules_survive_save_and_load() {
        let mut city = new_sized_city(120, 100, 6).expect("valid size");
        city.sim.relief_mut().set_height_at(10, 10, 40);
        city.sim.set_relief_rules(true);
        let bytes = save_bytes(&city);
        assert_eq!(&bytes[..4], b"MCTY");
        let mut back = new_sized_city(80, 67, 1).expect("valid size");
        load_bytes(&mut back, &bytes).expect("a file this crate wrote");
        assert_eq!(back.sim.relief().as_slice(), city.sim.relief().as_slice());
        assert!(back.sim.relief_rules());
        assert!(back.sim.relief_edited());
    }

    #[test]
    fn save_cty_refuses_what_a_cty_cannot_hold() {
        let mut city = new_sized_city(120, 100, 6).expect("valid size");
        assert!(save_cty_bytes(&city).is_ok());
        city.sim.set_relief_rules(true);
        assert_eq!(save_cty_bytes(&city), Err(ERR_RELIEF_NOT_SAVEABLE));
        let big = new_sized_city(97, 83, 6).expect("valid size");
        assert_eq!(
            save_cty_bytes(&big),
            Err(crate::sizes::ERR_SIZE_NOT_SAVEABLE)
        );
    }

    #[test]
    fn extended_rules_survive_save_and_load_and_a_cty_cannot_hold_them() {
        let mut city = new_sized_city(120, 100, 6).expect("valid size");
        city.sim.extensions_mut().water_rules = true;
        city.sim.water_mut().pipes.set(5, 5, 1);
        assert_eq!(save_cty_bytes(&city), Err(ERR_EXTENSIONS_NOT_SAVEABLE));
        let bytes = save_bytes(&city);
        assert_eq!(&bytes[..4], b"MCTY");
        let mut back = new_sized_city(80, 67, 1).expect("valid size");
        load_bytes(&mut back, &bytes).expect("a file this crate wrote");
        assert!(back.sim.extensions().water_rules);
        assert_eq!(back.sim.water(), city.sim.water());
    }

    #[test]
    fn a_corrupt_extensions_block_is_cty_bad_extension_and_changes_nothing() {
        let mut city = new_sized_city(97, 83, 1).expect("valid size");
        city.sim.extensions_mut().transit_rules = true;
        let mut bytes = save_bytes(&city);
        let len = bytes.len();
        bytes[len - 6] = 9; // the tag of the only chunk
        let before = save_bytes(&city);
        let err = load_bytes(&mut city, &bytes).expect_err("refused");
        assert_eq!(err.code(), "cty_bad_extension");
        assert_eq!(save_bytes(&city), before);
    }

    #[test]
    fn a_corrupt_relief_block_is_cty_bad_relief() {
        let mut city = new_sized_city(97, 83, 1).expect("valid size");
        city.sim.relief_mut().set_height_at(3, 3, 20);
        let mut bytes = save_bytes(&city);
        let len = bytes.len();
        bytes[len - 5] ^= 1;
        let err = load_bytes(&mut city, &bytes).expect_err("refused");
        assert_eq!(err.code(), "cty_bad_relief");
    }

    #[test]
    fn a_refused_file_changes_nothing() {
        let mut city = new_sized_city(97, 83, 1).expect("valid size");
        let before = save_bytes(&city);
        assert!(load_bytes(&mut city, &before[..50]).is_err());
        assert_eq!(save_bytes(&city), before);
    }
}
