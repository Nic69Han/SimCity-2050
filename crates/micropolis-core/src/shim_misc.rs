//! Temporary shims for functions owned by other modules, so this module compiles alone.
//! DELETED by the integrator at merge time. Never put real logic here.
//!
//! Owned by `evaluate.cpp` (ported by the evaluate agent):
//! `getPopulation`, `getCityClass`, `changeEval`.

use crate::simulation::{CityClass, Simulation};

impl Simulation {
    /// `Micropolis::getPopulation` (evaluate.cpp).
    pub(crate) fn get_population(&self) -> i64 {
        todo!("evaluate module: get_population")
    }

    /// `Micropolis::getCityClass` (evaluate.cpp).
    pub(crate) fn get_city_class(&self, _city_pop: i64) -> CityClass {
        todo!("evaluate module: get_city_class")
    }

    /// `Micropolis::changeEval` (evaluate.cpp).
    pub(crate) fn change_eval(&mut self) {
        todo!("evaluate module: change_eval")
    }
}
