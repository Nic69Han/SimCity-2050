//! Port of `scan.cpp` — see PORTING.md. (Owned by one porting agent.)
//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.

use crate::position::Position;
use crate::simulation::Simulation;

// Owned by the zone module (zone.cpp). Used by `get_population_density`.
impl Simulation {
    #[allow(dead_code)]
    pub(crate) fn do_free_pop(&self, _pos: Position) -> i16 {
        todo!("zone module: doFreePop")
    }

    #[allow(dead_code)]
    pub(crate) fn get_res_zone_pop(&self, _tile: u16) -> i16 {
        todo!("zone module: getResZonePop")
    }

    #[allow(dead_code)]
    pub(crate) fn get_com_zone_pop(&self, _tile: u16) -> i16 {
        todo!("zone module: getComZonePop")
    }

    #[allow(dead_code)]
    pub(crate) fn get_ind_zone_pop(&self, _tile: u16) -> i16 {
        todo!("zone module: getIndZonePop")
    }
}
