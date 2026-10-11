//! Port of `stubs.cpp`: funds, sounds, map invalidation, and the accessors of
//! the density/effect maps.
//!
//! Not ported (front-end or platform plumbing with no engine state):
//! `FrontendMessage*` classes, `tickCount` (wall clock), `newPtr`/`freePtr`,
//! `doPlayNewCity`/`doReallyStartGame`/`doStartLoad`/`doStartScenario` (never
//! called by the original), `callback` (replaced by the event queue), and the
//! `get*MapBuffer` functions (raw pointers for a UI). `initGame` and
//! `setTile` already exist in `simulation.rs`.

use crate::events::{Event, Update};
use crate::simulation::Simulation;
use crate::tile::Tile;
use crate::tile_chars::DIRT;

impl Simulation {
    /// Port of `spend`: deduct `dollars` from the funds. The C++ converts the
    /// `Quad` result to `int`, which is reproduced here.
    pub fn spend(&mut self, dollars: i32) {
        let v = (self.total_funds - dollars as i64) as i32;
        self.set_funds(v);
    }

    /// Port of `setFunds`: set the funds and flag the display for update.
    pub fn set_funds(&mut self, dollars: i32) {
        self.total_funds = dollars as i64;
        self.update_funds();
    }

    /// Port of `doEarthquake`: a shaking map, with its rumble everywhere.
    pub fn do_earthquake(&mut self, strength: i32) {
        self.make_sound("city", "ExplosionLow", -1, -1);
        self.push_event(Event::StartEarthquake(strength));
    }

    /// Port of `invalidateMaps`: the maps are no longer valid.
    pub fn invalidate_maps(&mut self) {
        self.map_serial = self.map_serial.wrapping_add(1);
        self.push_event(Event::Updated(Update::Map));
    }

    /// Port of `makeSound`: sounds are only sent when sound is enabled.
    /// `x`/`y` are tile coordinates, `-1` for everywhere.
    pub fn make_sound(&mut self, channel: &'static str, sound: &'static str, x: i32, y: i32) {
        if self.enable_sound {
            self.push_event(Event::Sound {
                channel,
                sound,
                x,
                y,
            });
        }
    }

    /// Port of `getTile`: off-map positions read as `DIRT`.
    pub fn get_tile(&self, x: i32, y: i32) -> i32 {
        self.tile(x, y).map_or(DIRT as i32, |t: Tile| t as i32)
    }

    /// Port of `getPowerGrid` (world coordinates, `0` off-map).
    pub fn get_power_grid(&self, x: i32, y: i32) -> i32 {
        self.power_grid_map.world_get(x, y) as i32
    }

    /// Port of `setPowerGrid` (world coordinates, ignored off-map).
    pub fn set_power_grid(&mut self, x: i32, y: i32, power: i32) {
        self.power_grid_map.world_set(x, y, power as u8);
    }

    /// Port of `getPopulationDensity(int, int)` (map coordinates).
    pub fn get_population_density(&self, x: i32, y: i32) -> i32 {
        self.population_density_map.get(x, y) as i32
    }

    /// Port of `setPopulationDensity`.
    pub fn set_population_density(&mut self, x: i32, y: i32, density: i32) {
        self.population_density_map.set(x, y, density as u8);
    }

    /// Port of `getRateOfGrowth`.
    pub fn get_rate_of_growth(&self, x: i32, y: i32) -> i32 {
        self.rate_of_growth_map.get(x, y) as i32
    }

    /// Port of `setRateOfGrowth`.
    pub fn set_rate_of_growth(&mut self, x: i32, y: i32, rate: i32) {
        self.rate_of_growth_map.set(x, y, rate as i16);
    }

    /// Port of `getTrafficDensity`.
    pub fn get_traffic_density(&self, x: i32, y: i32) -> i32 {
        self.traffic_density_map.get(x, y) as i32
    }

    /// Port of `setTrafficDensity`.
    pub fn set_traffic_density(&mut self, x: i32, y: i32, density: i32) {
        self.traffic_density_map.set(x, y, density as u8);
    }

    /// Port of `getPollutionDensity`.
    pub fn get_pollution_density(&self, x: i32, y: i32) -> i32 {
        self.pollution_density_map.get(x, y) as i32
    }

    /// Port of `setPollutionDensity`.
    pub fn set_pollution_density(&mut self, x: i32, y: i32, density: i32) {
        self.pollution_density_map.set(x, y, density as u8);
    }

    /// Port of `getCrimeRate`.
    pub fn get_crime_rate(&self, x: i32, y: i32) -> i32 {
        self.crime_rate_map.get(x, y) as i32
    }

    /// Port of `setCrimeRate`.
    pub fn set_crime_rate(&mut self, x: i32, y: i32, rate: i32) {
        self.crime_rate_map.set(x, y, rate as u8);
    }

    /// Port of `getLandValue`.
    pub fn get_land_value(&self, x: i32, y: i32) -> i32 {
        self.land_value_map.get(x, y) as i32
    }

    /// Port of `setLandValue`.
    pub fn set_land_value(&mut self, x: i32, y: i32, value: i32) {
        self.land_value_map.set(x, y, value as u8);
    }

    /// Port of `getFireCoverage` (fire station effect map).
    pub fn get_fire_coverage(&self, x: i32, y: i32) -> i32 {
        self.fire_station_effect_map.get(x, y) as i32
    }

    /// Port of `setFireCoverage`.
    pub fn set_fire_coverage(&mut self, x: i32, y: i32, coverage: i32) {
        self.fire_station_effect_map.set(x, y, coverage as i16);
    }

    /// Port of `getPoliceCoverage` (police station effect map).
    pub fn get_police_coverage(&self, x: i32, y: i32) -> i32 {
        self.police_station_effect_map.get(x, y) as i32
    }

    /// Port of `setPoliceCoverage`.
    pub fn set_police_coverage(&mut self, x: i32, y: i32, coverage: i32) {
        self.police_station_effect_map.set(x, y, coverage as i16);
    }
}
