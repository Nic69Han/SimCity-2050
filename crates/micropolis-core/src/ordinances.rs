//! Ordinances (docs/game-design-v02.md): the player's city-wide decisions, each with a monthly
//! cost and a modest effect on crime, pollution, land value and demand.
//!
//! Platform phase: this module is delivered empty. The functions below have the signatures the
//! hooks of [`extensions`](crate::extensions) call and return their input unchanged; the
//! ordinances workstream fills them in. The active ordinances are the bits of
//! [`Extensions::ordinances`] (bit `n` = ordinance `n`); they are saved in their own chunk.
//!
//! Rules for the workstream: no random number, no allocation in a hook, every loop bounded.

use crate::extensions::Extensions;
use crate::position::Position;
use crate::simulation::Simulation;
use crate::traffic::ZoneType;

/// Net cost of the active ordinances for one tax collection, in dollars (a cost is positive).
pub(crate) fn monthly_balance(_sim: &Simulation) -> i32 {
    0
}

/// Crime `z` (0..=250) at world tile `(x, y)`, after the ordinances.
pub(crate) fn crime(_sim: &Simulation, _x: i32, _y: i32, z: i32) -> i32 {
    z
}

/// Pollution `p` (0..=255) at world tile `(x, y)`, after the ordinances.
pub(crate) fn pollution(_sim: &Simulation, _x: i32, _y: i32, p: i32) -> i32 {
    p
}

/// Land value `v` (1..=250) at world tile `(x, y)`, after the ordinances.
pub(crate) fn land_value(_sim: &Simulation, _x: i32, _y: i32, v: i32) -> i32 {
    v
}

/// Adjusts the zoning valves after `set_valves` computed them.
pub(crate) fn valves(_sim: &mut Simulation) {}

/// Whether the ordinances let a zone of `kind` at `pos` grow.
pub(crate) fn zone_can_grow(_sim: &Simulation, _pos: Position, _kind: ZoneType) -> bool {
    true
}

/// The bytes of the ordinances chunk: the active set, as a big-endian `u32`; nothing when no
/// ordinance is active.
pub(crate) fn encode(ext: &Extensions) -> Vec<u8> {
    if ext.ordinances == 0 {
        Vec::new()
    } else {
        ext.ordinances.to_be_bytes().to_vec()
    }
}

/// The active set stored in `bytes` (empty: none). `Err` with the reason when the chunk is not
/// exactly four bytes.
pub(crate) fn decode(bytes: &[u8]) -> Result<u32, &'static str> {
    match bytes.len() {
        0 => Ok(0),
        4 => Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
        _ => Err("ordinances chunk is not 4 bytes"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_chunk_round_trips_and_is_absent_when_nothing_is_active() {
        let mut ext = Extensions::default();
        assert!(encode(&ext).is_empty());
        ext.ordinances = 0b1010_0001;
        assert_eq!(decode(&encode(&ext)), Ok(0b1010_0001));
        assert_eq!(decode(&[]), Ok(0));
        assert!(decode(&[1, 2, 3]).is_err());
    }
}
