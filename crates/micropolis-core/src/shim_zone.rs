//! Port of `zone.cpp` — see PORTING.md. (Owned by one porting agent.)
//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.

use crate::position::Position;
use crate::simulation::Simulation;
use crate::tile::Tile;
#[cfg(test)]
use std::cell::Cell;

/// `ZoneType` from micropolis.h. Owned by the traffic module; duplicated here
/// until integration, when the traffic module's definition replaces it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ZoneType {
    Commercial,
    Industrial,
    Residential,
}

#[cfg(test)]
thread_local! {
    /// Value returned by the TEST-only stub of `make_traffic`. The gold tests set
    /// it before each zone call. Each test runs on its own thread.
    pub(crate) static TEST_TRAFFIC_RESULT: Cell<i16> = const { Cell::new(1) };
}

impl Simulation {
    /// traffic.cpp `makeTraffic(const Position &startPos, ZoneType dest)`.
    #[cfg(not(test))]
    pub(crate) fn make_traffic(&mut self, pos: Position, dest: ZoneType) -> i16 {
        let _ = (pos, dest);
        todo!("traffic module")
    }

    /// TEST-only stub: returns the value the test selected, no traffic logic.
    #[cfg(test)]
    pub(crate) fn make_traffic(&mut self, _pos: Position, _dest: ZoneType) -> i16 {
        TEST_TRAFFIC_RESULT.with(|c| c.get())
    }

    /// simulate.cpp `repairZone(const Position &pos, MapTile zCent, short zSize)`.
    pub(crate) fn repair_zone(&mut self, pos: Position, z_cent: Tile, z_size: i16) {
        let _ = (pos, z_cent, z_size);
        todo!("simulate module")
    }

    /// simulate.cpp `doSpecialZone(const Position &pos, bool powerOn)`.
    pub(crate) fn do_special_zone(&mut self, pos: Position, power_on: bool) {
        let _ = (pos, power_on);
        todo!("simulate module")
    }
}
