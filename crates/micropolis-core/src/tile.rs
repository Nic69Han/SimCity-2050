//! Tile representation: a `u16` holding a tile character (low 10 bits) and
//! status bits (high 6 bits). Same layout as Micropolis, so `.cty` save files
//! stay compatible.

pub use crate::tile_chars::*;

pub type Tile = u16;

pub const PWRBIT: Tile = 0x8000; // tile has power
pub const CONDBIT: Tile = 0x4000; // tile conducts electricity
pub const BURNBIT: Tile = 0x2000; // tile can burn
pub const BULLBIT: Tile = 0x1000; // tile is bulldozable
pub const ANIMBIT: Tile = 0x0800; // tile is animated
pub const ZONEBIT: Tile = 0x0400; // centre tile of a zone

pub const ALLBITS: Tile = ZONEBIT | ANIMBIT | BULLBIT | BURNBIT | CONDBIT | PWRBIT;
pub const LOMASK: Tile = 0x03ff;

pub const BLBNBIT: Tile = BULLBIT | BURNBIT;
pub const BLBNCNBIT: Tile = BULLBIT | BURNBIT | CONDBIT;
pub const BNCNBIT: Tile = BURNBIT | CONDBIT;

/// Tile character without status bits.
#[inline]
pub fn character(t: Tile) -> Tile {
    t & LOMASK
}

/// Status bits without the tile character.
#[inline]
pub fn bits(t: Tile) -> Tile {
    t & ALLBITS
}

#[inline]
pub fn is_conductive(t: Tile) -> bool {
    t & CONDBIT != 0
}

#[inline]
pub fn is_powered(t: Tile) -> bool {
    t & PWRBIT != 0
}

#[inline]
pub fn is_zone_center(t: Tile) -> bool {
    t & ZONEBIT != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bit_layout_is_disjoint_and_complete() {
        assert_eq!(ALLBITS & LOMASK, 0);
        assert_eq!(ALLBITS | LOMASK, 0xffff);
    }

    #[test]
    fn helpers() {
        let t = RIVER | PWRBIT | CONDBIT;
        assert_eq!(character(t), RIVER);
        assert!(is_powered(t) && is_conductive(t) && !is_zone_center(t));
        assert_eq!(bits(t), PWRBIT | CONDBIT);
    }

    #[test]
    fn selected_constants_match_cpp() {
        assert_eq!(DIRT, 0);
        assert_eq!(RIVER, 2);
        assert_eq!(WOODS, 37);
        assert_eq!(RUBBLE, 44);
        assert_eq!(RADTILE, 52);
    }
}
