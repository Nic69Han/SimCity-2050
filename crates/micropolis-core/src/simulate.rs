//! Port of `simulate.cpp` and of the simulation-loop part of `main.cpp`
//! (`simFrame`, `simulate`, `doSimInit`, census, tax, map scan, tile rules,
//! `simHeat`, `simLoop`, `simTick`, `simUpdate`) plus `doTimeStuff` from
//! `update.cpp`.
//!
//! Conventions:
//! * Map coordinates are `i32`; tiles are read and written through
//!   `sim_tile` / `sim_set_tile`, which index the column-major tile array.
//! * Every C++ `getRandom16()` / `getRandom(n)` call maps to
//!   `self.rng.random16()` / `self.rng.random(n)`, in the same order.
//! * Functions owned by other modules are called as `self.name(..)` and are
//!   stubbed in `shim_simulate.rs` until integration.
//! * The C++ `callback(...)` notifications that only refresh a front-end
//!   (`updateDate`, `changeCensus`, `simRobots`, `blinkFlag`) are dropped.
//! * Divergences from the C++ are listed on the functions that have them.

use crate::position::Position;
use crate::simulation::{
    CityClass, GameLevel, Scenario, Simulation, HISTORY_LEN, MAX_FIRE_STATION_EFFECT,
    MAX_POLICE_STATION_EFFECT, MAX_ROAD_EFFECT,
};
use crate::tile::{
    Tile, ALLBITS, ANIMBIT, BNCNBIT, BULLBIT, BURNBIT, CONDBIT, LOMASK, PWRBIT, ZONEBIT,
};
use crate::tile_chars::*;

// ---- constants (simulate.cpp) ----------------------------------------------

/// How often (in city times) the short term census is taken.
const CENSUS_FREQUENCY_10: i64 = 4;
/// How often (in city times) the long term census is taken.
const CENSUS_FREQUENCY_120: i64 = CENSUS_FREQUENCY_10 * 12;
/// How often (in city times) taxes are collected.
const TAX_FREQUENCY: i64 = 48;

/// `MapType` indices (`micropolis.h`), used for `new_map_flags`.
const MAP_TYPE_ALL: usize = 0;
const MAP_TYPE_RES: usize = 1;
const MAP_TYPE_COM: usize = 2;
const MAP_TYPE_IND: usize = 3;
const MAP_TYPE_POWER: usize = 4;
const MAP_TYPE_ROAD: usize = 5;
const MAP_TYPE_TRAFFIC_DENSITY: usize = 8;
const MAP_TYPE_DYNAMIC: usize = 14;

/// `MessageNumber` values (`text.h`).
const MESSAGE_NUCLEAR_MELTDOWN: i16 = 43;

/// `SpriteType::SPRITE_SHIP` (`micropolis.h`).
const SPRITE_SHIP: i32 = 4;

/// `taxTable` of `setValves` (indexed by `cityTax + gameLevel`, 0..=20).
const TAX_TABLE: [i16; 21] = [
    200, 150, 120, 100, 80, 50, 30, 0, -10, -40, -100, -150, -200, -250, -300, -350, -400, -450,
    -500, -550, -600,
];

/// `clamp` as written in micropolis.h (lower bound wins over NaN handling).
fn clamp_c<T: PartialOrd>(val: T, lower: T, upper: T) -> T {
    if val < lower {
        return lower;
    }
    if val > upper {
        return upper;
    }
    val
}

/// C++ `(short)f` for a `float` `f`: the value goes through a 32-bit integer
/// and keeps its low 16 bits (what x86 `cvttss2si` followed by truncation
/// does, also for out-of-range values). Rust's `as i16` would saturate instead.
fn f32_to_short(v: f32) -> i16 {
    (v as i32) as i16
}

/// `min` / `max` as written in micropolis.h.
fn min_c<T: PartialOrd>(a: T, b: T) -> T {
    if a < b {
        a
    } else {
        b
    }
}

fn max_c<T: PartialOrd>(a: T, b: T) -> T {
    if a > b {
        a
    } else {
        b
    }
}

/// `randomRubble()` (micropolis.h): `(RUBBLE + (getRandom16() & 3)) | BULLBIT`.
fn random_rubble_tile(rng: &mut crate::rng::Rng) -> Tile {
    (RUBBLE + (rng.random16() & 3) as u16) | BULLBIT
}

/// `randomFire()` (micropolis.h): `(FIRE + (getRandom16() & 7)) | ANIMBIT`.
fn random_fire_tile(rng: &mut crate::rng::Rng) -> Tile {
    (FIRE + (rng.random16() & 7) as u16) | ANIMBIT
}

impl Simulation {
    // ---- tile access (column-major: index = x * world_h + y) ----------------

    /// Tile at a map position that the C++ code assumes is inside the world.
    fn sim_tile(&self, x: i32, y: i32) -> Tile {
        let (_, h) = self.world_size();
        self.tiles[(x as usize) * (h as usize) + (y as usize)]
    }

    fn sim_set_tile(&mut self, x: i32, y: i32, t: Tile) {
        let (_, h) = self.world_size();
        self.tiles[(x as usize) * (h as usize) + (y as usize)] = t;
    }

    fn sim_random_rubble(&mut self) -> Tile {
        random_rubble_tile(&mut self.rng)
    }

    fn sim_random_fire(&mut self) -> Tile {
        random_fire_tile(&mut self.rng)
    }

    // ---- simFrame / simulate (simulate.cpp) ---------------------------------

    /// Port of `Micropolis::simFrame`: advance the simulation by one frame,
    /// skipping frames according to the speed.
    pub fn sim_frame(&mut self) {
        if self.sim_speed == 0 {
            return;
        }

        self.speed_cycle = self.speed_cycle.wrapping_add(1);
        if self.speed_cycle > 1023 {
            self.speed_cycle = 0;
        }

        if self.sim_speed == 1 && (self.speed_cycle % 5) != 0 {
            return;
        }

        if self.sim_speed == 2 && (self.speed_cycle % 3) != 0 {
            return;
        }

        self.simulate();
    }

    /// Port of `Micropolis::simulate`: run one of the 16 phases of the
    /// simulator and advance `phase_cycle`.
    pub fn simulate(&mut self) {
        const SPEED_POWER_SCAN: [i16; 3] = [2, 4, 5];
        const SPEED_POLLUTION_TERRAIN_LAND_VALUE_SCAN: [i16; 3] = [2, 7, 17];
        const SPEED_CRIME_SCAN: [i16; 3] = [1, 8, 18];
        const SPEED_POPULATION_DENSITY_SCAN: [i16; 3] = [1, 9, 19];
        const SPEED_FIRE_ANALYSIS: [i16; 3] = [1, 10, 20];

        let speed_index = clamp_c(self.sim_speed - 1, 0, 2) as usize;
        let (w, _) = self.world_size();

        // Extended rule (inert unless the cars are on): the only place the agents run.
        self.ext_agents_tick();

        // The simulator has 16 different phases, which we cycle through
        // according to phaseCycle, which is incremented and wrapped at the end.
        if self.init_sim_load != 0 {
            self.phase_cycle = 0;
        } else {
            self.phase_cycle &= 15;
        }

        match self.phase_cycle {
            0 => {
                self.sim_cycle = self.sim_cycle.wrapping_add(1);
                if self.sim_cycle > 1023 {
                    self.sim_cycle = 0; // This is cosmic!
                }

                if self.do_initial_eval {
                    self.do_initial_eval = false;
                    self.city_evaluation();
                }

                self.city_time += 1;
                self.city_tax_average = self.city_tax_average.wrapping_add(self.city_tax);

                if (self.sim_cycle & 1) == 0 {
                    self.set_valves();
                }

                self.clear_census();
            }
            1..=8 => {
                // Scan 1/8 of the map for each of the 8 phases 1..8.
                let p = self.phase_cycle as i32;
                self.map_scan((p - 1) * w / 8, p * w / 8);
            }
            9 => {
                if self.city_time % CENSUS_FREQUENCY_10 == 0 {
                    self.take_10_census();
                }

                if self.city_time % CENSUS_FREQUENCY_120 == 0 {
                    self.take_120_census();
                }

                if self.city_time % TAX_FREQUENCY == 0 {
                    self.collect_tax();
                    self.city_evaluation();
                }
            }
            10 => {
                if self.sim_cycle % 5 == 0 {
                    self.dec_rate_of_growth_map();
                }

                self.dec_traffic_map();

                for t in [
                    MAP_TYPE_TRAFFIC_DENSITY,
                    MAP_TYPE_ROAD,
                    MAP_TYPE_ALL,
                    MAP_TYPE_RES,
                    MAP_TYPE_COM,
                    MAP_TYPE_IND,
                    MAP_TYPE_DYNAMIC,
                ] {
                    self.new_map_flags[t] = 1;
                }

                self.send_messages();
            }
            11 => {
                let idx = speed_index;
                if self.sim_cycle % SPEED_POWER_SCAN[idx] == 0 {
                    self.do_power_scan();
                    self.new_map_flags[MAP_TYPE_POWER] = 1;
                    self.new_power = true; // post-release change
                }
            }
            12 => {
                if self.sim_cycle % SPEED_POLLUTION_TERRAIN_LAND_VALUE_SCAN[speed_index] == 0 {
                    self.pollution_terrain_land_value_scan();
                }
            }
            13 => {
                if self.sim_cycle % SPEED_CRIME_SCAN[speed_index] == 0 {
                    self.crime_scan();
                }
            }
            14 => {
                if self.sim_cycle % SPEED_POPULATION_DENSITY_SCAN[speed_index] == 0 {
                    self.population_density_scan();
                }
            }
            15 => {
                if self.sim_cycle % SPEED_FIRE_ANALYSIS[speed_index] == 0 {
                    self.fire_analysis();
                }

                self.do_disasters();
            }
            _ => {}
        }

        // Go on to the next phase.
        self.phase_cycle = (self.phase_cycle + 1) & 15;
    }

    /// Port of `Micropolis::doSimInit`: prepare the engine for a city that was
    /// just created (`initSimLoad == 2`) or loaded (`initSimLoad == 1`).
    pub fn do_sim_init(&mut self) {
        self.phase_cycle = 0;
        self.sim_cycle = 0;

        if self.init_sim_load == 2 {
            // if new city
            self.init_sim_memory_full();
        }

        if self.init_sim_load == 1 {
            // if city just loaded
            self.sim_load_init_full();
        }

        self.set_valves();
        self.clear_census();
        let (w, _) = self.world_size();
        self.map_scan(0, w);
        self.do_power_scan();
        self.new_power = true; // post rel
        self.pollution_terrain_land_value_scan();
        self.crime_scan();
        self.population_density_scan();
        self.fire_analysis();
        self.new_map = 1;
        self.census_changed = true;
        self.total_pop = 1;
        self.do_initial_eval = true;
    }

    /// Port of `Micropolis::doNilPower`: for every zone tile, copy the power
    /// bit from `powerGridMap` (through `setZonePower`).
    pub fn do_nil_power(&mut self) {
        let (w, h) = self.world_size();
        for x in 0..w {
            for y in 0..h {
                if self.sim_tile(x, y) & ZONEBIT != 0 {
                    let _ = self.set_zone_power(Position::new(x, y));
                }
            }
        }
    }

    /// Port of `Micropolis::decTrafficMap`: tends to empty `trafficDensityMap`.
    pub fn dec_traffic_map(&mut self) {
        let bs = self.traffic_density_map.block_size();
        let (w, h) = self.world_size();
        let mut x = 0;
        while x < w {
            let mut y = 0;
            while y < h {
                let z = self.traffic_density_map.world_get(x, y) as i16;
                if z != 0 {
                    if z <= 24 {
                        self.traffic_density_map.world_set(x, y, 0);
                    } else {
                        let decayed = if z > 200 { z - 34 } else { z - 24 };
                        // Extended rules (inert unless active); the clamp keeps the map's range.
                        let t = self.ext_traffic(x, y, i32::from(decayed)).clamp(0, 255);
                        self.traffic_density_map.world_set(x, y, t as u8);
                    }
                }
                y += bs;
            }
            x += bs;
        }
    }

    /// Port of `Micropolis::decRateOfGrowthMap`: moves every rate of growth
    /// value one step towards zero, clamped to +-200.
    pub fn dec_rate_of_growth_map(&mut self) {
        let (mw, mh) = self.rate_of_growth_map.size();
        for x in 0..mw {
            for y in 0..mh {
                let mut z = self.rate_of_growth_map.get(x, y);
                if z == 0 {
                    continue;
                }

                if z > 0 {
                    z -= 1;
                    z = clamp_c(z, -200, 200);
                    self.rate_of_growth_map.set(x, y, z);
                    continue;
                }

                if z < 0 {
                    z += 1;
                    z = clamp_c(z, -200, 200);
                    self.rate_of_growth_map.set(x, y, z);
                }
            }
        }
    }

    /// Port of `Micropolis::initSimMemory`, complete (the partial version in
    /// `simulation.rs` lacks `evalInit` and `doPowerScan`). Integration: replace
    /// `Simulation::init_sim_memory` with a call to this.
    pub fn init_sim_memory_full(&mut self) {
        self.set_common_inits_full();

        for x in 0..HISTORY_LEN {
            self.res_hist[x] = 0;
            self.com_hist[x] = 0;
            self.ind_hist[x] = 0;
            self.money_hist[x] = 128;
            self.crime_hist[x] = 0;
            self.pollution_hist[x] = 0;
        }

        self.crime_ramp = 0;
        self.pollution_ramp = 0;
        self.total_pop = 0;
        self.res_valve = 0;
        self.com_valve = 0;
        self.ind_valve = 0;
        self.res_cap = false; // Do not block residential growth
        self.com_cap = false; // Do not block commercial growth
        self.ind_cap = false; // Do not block industrial growth

        self.external_market = 6.0;
        self.disaster_event = Scenario::None;
        self.score_type = Scenario::None;

        // This clears powermem
        self.power_stack_pointer = 0;
        self.do_power_scan();
        self.new_power = true; // post rel

        self.init_sim_load = 0;
    }

    /// Port of `Micropolis::simLoadInit`, complete. The partial version in
    /// `fileio.rs` lacks `doNilPower`, the `cityTime` clamp, `setGameLevel`,
    /// the `evalInit` of `setCommonInits`, and the scenario tables. Integration:
    /// `fileio::sim_load_init` should be replaced by a call to this.
    pub fn sim_load_init_full(&mut self) {
        // Disaster delay table for each scenario.
        const DISASTER_WAIT_TABLE: [i16; 9] = [
            0,      // No scenario (free playing)
            2,      // Dullsville (boredom)
            10,     // San francisco (earth quake)
            4 * 10, // Hamburg (fire bombs)
            20,     // Bern (traffic)
            3,      // Tokyo (scary monster)
            5,      // Detroit (crime)
            5,      // Boston (nuclear meltdown)
            2 * 48, // Rio (flooding)
        ];

        // Time to wait before score calculation for each scenario.
        const SCORE_WAIT_TABLE: [i16; 9] = [
            0,       // No scenario (free playing)
            30 * 48, // Dullsville (boredom)
            5 * 48,  // San francisco (earth quake)
            5 * 48,  // Hamburg (fire bombs)
            10 * 48, // Bern (traffic)
            5 * 48,  // Tokyo (scary monster)
            10 * 48, // Detroit (crime)
            5 * 48,  // Boston (nuclear meltdown)
            10 * 48, // Rio (flooding)
        ];

        self.external_market = self.misc_hist[1] as f32;
        self.res_pop = self.misc_hist[2];
        self.com_pop = self.misc_hist[3];
        self.ind_pop = self.misc_hist[4];
        self.res_valve = self.misc_hist[5];
        self.com_valve = self.misc_hist[6];
        self.ind_valve = self.misc_hist[7];
        self.crime_ramp = self.misc_hist[10];
        self.pollution_ramp = self.misc_hist[11];
        self.land_value_average = self.misc_hist[12];
        self.crime_average = self.misc_hist[13];
        self.pollution_average = self.misc_hist[14];
        // Out-of-range levels fall back to LEVEL_FIRST, as in the original.
        self.game_level = GameLevel::from_i16(self.misc_hist[15]).unwrap_or(GameLevel::Easy);

        if self.city_time < 0 {
            self.city_time = 0;
        }

        if self.external_market == 0.0 {
            self.external_market = 4.0;
        }

        // Set game level
        let level = self.game_level;
        self.set_game_level(level);

        self.set_common_inits_full();

        // Load cityClass
        self.city_class = match self.misc_hist[16] {
            1 => CityClass::Town,
            2 => CityClass::City,
            3 => CityClass::Capital,
            4 => CityClass::Metropolis,
            5 => CityClass::Megalopolis,
            _ => CityClass::Village,
        };

        self.city_score = if (1..=999).contains(&self.misc_hist[17]) {
            self.misc_hist[17]
        } else {
            500
        };

        self.res_cap = false;
        self.com_cap = false;
        self.ind_cap = false;

        self.city_tax_average = ((self.city_time % 48) * 7) as i16; // post

        // Set power map.
        self.power_grid_map.fill(1);

        self.do_nil_power();

        if self.scenario != Scenario::None {
            let idx = self.scenario as usize;
            self.disaster_event = self.scenario;
            self.disaster_wait = DISASTER_WAIT_TABLE[idx];
            self.score_type = self.disaster_event;
            self.score_wait = SCORE_WAIT_TABLE[idx];
        } else {
            self.disaster_event = Scenario::None;
            self.disaster_wait = 0;
            self.score_type = Scenario::None;
            self.score_wait = 0;
        }

        self.road_effect = MAX_ROAD_EFFECT;
        self.police_effect = MAX_POLICE_STATION_EFFECT;
        self.fire_effect = MAX_FIRE_STATION_EFFECT;
        self.init_sim_load = 0;
    }

    /// Port of `Micropolis::setCommonInits`, complete (includes `evalInit`).
    /// Integration: replace `Simulation::set_common_inits` with a call to this.
    pub fn set_common_inits_full(&mut self) {
        self.eval_init();
        self.road_effect = MAX_ROAD_EFFECT;
        self.police_effect = MAX_POLICE_STATION_EFFECT;
        self.fire_effect = MAX_FIRE_STATION_EFFECT;
        self.tax_flag = false;
        self.tax_fund = 0;
    }

    /// Port of `Micropolis::setValves`: compute the residential, commercial
    /// and industrial zoning valves from population, labour and tax.
    ///
    /// Keeps the original's `resRatio = min(indRatio, indRatioMax)` (the
    /// `comRatio`/`resRatio` clamps are overwritten by it), and its float
    /// arithmetic order.
    pub fn set_valves(&mut self) {
        const TAX_MAX: i16 = 20;
        const EXT_MARKET_PARAM: [f32; 3] = [1.2, 1.1, 0.98];

        // TODO in the original: make configurable parameters.
        let res_pop_denom: i16 = 8;
        let labor_base_max: f32 = 1.3;
        let internal_market_denom: f32 = 3.7;
        let projected_ind_pop_min: f32 = 5.0;
        let com_ratio_max: f32 = 2.0;
        let ind_ratio_max: f32 = 2.0;
        let tax_table_scale: f32 = 600.0;

        self.misc_hist[1] = f32_to_short(self.external_market);
        self.misc_hist[2] = self.res_pop;
        self.misc_hist[3] = self.com_pop;
        self.misc_hist[4] = self.ind_pop;
        self.misc_hist[5] = self.res_valve;
        self.misc_hist[6] = self.com_valve;
        self.misc_hist[7] = self.ind_valve;
        self.misc_hist[10] = self.crime_ramp;
        self.misc_hist[11] = self.pollution_ramp;
        self.misc_hist[12] = self.land_value_average;
        self.misc_hist[13] = self.crime_average;
        self.misc_hist[14] = self.pollution_average;
        self.misc_hist[15] = self.game_level as i16;
        self.misc_hist[16] = self.city_class as i16;
        self.misc_hist[17] = self.city_score;

        let normalized_res_pop: f32 = self.res_pop as f32 / res_pop_denom as f32;
        self.total_pop_last = self.total_pop;
        self.total_pop =
            f32_to_short(normalized_res_pop + self.com_pop as f32 + self.ind_pop as f32);

        // The original also computes the projected residential population
        // (employment, migration, births) here, but its only use is the
        // `resRatio` that the next-but-one statements overwrite, so it is omitted.

        // Compute laborBase
        let temp: f32 = (self.com_hist[1] as i32 + self.ind_hist[1] as i32) as f32;
        let mut labor_base: f32 = if temp > 0.0 {
            self.res_hist[1] as f32 / temp
        } else {
            1.0
        };
        labor_base = clamp_c(labor_base, 0.0, labor_base_max);

        let internal_market = (normalized_res_pop + self.com_pop as f32 + self.ind_pop as f32)
            / internal_market_denom;

        let projected_com_pop = internal_market * labor_base;

        let mut projected_ind_pop =
            self.ind_pop as f32 * labor_base * EXT_MARKET_PARAM[self.game_level as usize];
        projected_ind_pop = max_c(projected_ind_pop, projected_ind_pop_min);

        let mut com_ratio: f32 = if self.com_pop > 0 {
            projected_com_pop / self.com_pop as f32
        } else {
            projected_com_pop
        };

        let mut ind_ratio: f32 = if self.ind_pop > 0 {
            projected_ind_pop / self.ind_pop as f32
        } else {
            projected_ind_pop
        };

        // The original clamps `resRatio` to resRatioMax and then overwrites it
        // with `min(indRatio, indRatioMax)`; only the latter survives.
        com_ratio = min_c(com_ratio, com_ratio_max);
        let res_ratio = min_c(ind_ratio, ind_ratio_max);

        // Global tax and game level effects.
        let z: i16 = min_c(
            (self.city_tax as i32 + self.game_level as i32) as i16,
            TAX_MAX,
        );
        let tax = TAX_TABLE[z as usize] as f32;
        let res_ratio = (res_ratio - 1.0) * tax_table_scale + tax;
        com_ratio = (com_ratio - 1.0) * tax_table_scale + tax;
        ind_ratio = (ind_ratio - 1.0) * tax_table_scale + tax;

        // Ratios are velocity changes to valves.
        self.res_valve = clamp_c(
            self.res_valve as i32 + f32_to_short(res_ratio) as i32,
            -crate::simulation::RES_VALVE_RANGE,
            crate::simulation::RES_VALVE_RANGE,
        ) as i16;
        self.com_valve = clamp_c(
            self.com_valve as i32 + f32_to_short(com_ratio) as i32,
            -crate::simulation::COM_VALVE_RANGE,
            crate::simulation::COM_VALVE_RANGE,
        ) as i16;
        self.ind_valve = clamp_c(
            self.ind_valve as i32 + f32_to_short(ind_ratio) as i32,
            -crate::simulation::IND_VALVE_RANGE,
            crate::simulation::IND_VALVE_RANGE,
        ) as i16;

        if self.res_cap && self.res_valve > 0 {
            self.res_valve = 0; // Need a stadium, so cap resValve.
        }

        if self.com_cap && self.com_valve > 0 {
            self.com_valve = 0; // Need a airport, so cap comValve.
        }

        if self.ind_cap && self.ind_valve > 0 {
            self.ind_valve = 0; // Need an seaport, so cap indValve.
        }

        self.valve_flag = true;
        // Extended rules (inert unless active).
        self.ext_valves();
    }

    /// Port of `Micropolis::clearCensus`: reset the per-census counters before
    /// the map scan.
    pub fn clear_census(&mut self) {
        self.powered_zone_count = 0;
        self.unpowered_zone_count = 0;
        self.fire_pop = 0;
        self.road_total = 0;
        self.rail_total = 0;
        self.res_pop = 0;
        self.com_pop = 0;
        self.ind_pop = 0;
        self.res_zone_pop = 0;
        self.com_zone_pop = 0;
        self.ind_zone_pop = 0;
        self.hospital_pop = 0;
        self.church_pop = 0;
        self.police_station_pop = 0;
        self.fire_station_pop = 0;
        self.stadium_pop = 0;
        self.coal_power_pop = 0;
        self.nuclear_power_pop = 0;
        self.seaport_pop = 0;
        self.airport_pop = 0;
        self.power_stack_pointer = 0; // Reset before Mapscan

        self.fire_station_map.clear();
        // fireStationEffectMap is not cleared (rev293 in the original).
        self.police_station_map.clear();
        // policeStationEffectMap is not cleared (rev293 in the original).
    }

    /// Port of `Micropolis::take10Census`: the monthly snapshot. Split into
    /// history, the front-end notification and the needs computation, so the
    /// Rust tests can run the first and last parts without the notification.
    pub fn take_10_census(&mut self) {
        self.census_10_history();
        self.change_census();
        self.census_10_needs();
    }

    /// First half of `take10Census`: shift the 10-year histories and store the
    /// new monthly values.
    pub fn census_10_history(&mut self) {
        // TODO: Make configurable parameters.
        let res_pop_denom: i16 = 8;

        // Put census numbers in the historical graphs and scroll the data.
        self.res_hist10_max = 0;
        self.com_hist10_max = 0;
        self.ind_hist10_max = 0;

        for x in (0..=118usize).rev() {
            self.res_hist10_max = max_c(self.res_hist10_max, self.res_hist[x]);
            self.com_hist10_max = max_c(self.com_hist10_max, self.com_hist[x]);
            self.ind_hist10_max = max_c(self.ind_hist10_max, self.ind_hist[x]);

            self.res_hist[x + 1] = self.res_hist[x];
            self.com_hist[x + 1] = self.com_hist[x];
            self.ind_hist[x + 1] = self.ind_hist[x];
            self.crime_hist[x + 1] = self.crime_hist[x];
            self.pollution_hist[x + 1] = self.pollution_hist[x];
            self.money_hist[x + 1] = self.money_hist[x];
        }

        self.graph10_max = self.res_hist10_max;
        self.graph10_max = max_c(self.graph10_max, self.com_hist10_max);
        self.graph10_max = max_c(self.graph10_max, self.ind_hist10_max);

        self.res_hist[0] = self.res_pop / res_pop_denom;
        self.com_hist[0] = self.com_pop;
        self.ind_hist[0] = self.ind_pop;

        self.crime_ramp = (self.crime_ramp as i32
            + (self.crime_average as i32 - self.crime_ramp as i32) / 4)
            as i16;
        self.crime_hist[0] = min_c(self.crime_ramp, 255);

        self.pollution_ramp = (self.pollution_ramp as i32
            + (self.pollution_average as i32 - self.pollution_ramp as i32) / 4)
            as i16;
        self.pollution_hist[0] = min_c(self.pollution_ramp, 255);

        // scale to 0..255
        let x = ((self.cash_flow as i32 / 20) + 128) as i16;
        self.money_hist[0] = clamp_c(x, 0, 255);
    }

    /// Second half of `take10Census`: update the hospital and church needs.
    pub fn census_10_needs(&mut self) {
        let res_pop_scaled = self.res_pop >> 8;

        if self.hospital_pop < res_pop_scaled {
            self.need_hospital = 1;
        }

        if self.hospital_pop > res_pop_scaled {
            self.need_hospital = -1;
        }

        if self.hospital_pop == res_pop_scaled {
            self.need_hospital = 0;
        }

        let faithful_pop = res_pop_scaled as i32 + self.faith as i32;

        if (self.church_pop as i32) < faithful_pop {
            self.need_church = 1;
        }

        if (self.church_pop as i32) > faithful_pop {
            self.need_church = -1;
        }

        if (self.church_pop as i32) == faithful_pop {
            self.need_church = 0;
        }
    }

    /// Port of `Micropolis::take120Census`: the yearly snapshot of the long
    /// term histories.
    pub fn take_120_census(&mut self) {
        self.census_120_history();
        self.change_census();
    }

    /// Body of `take120Census` before the front-end notification.
    pub fn census_120_history(&mut self) {
        // TODO: Make configurable parameters.
        let res_pop_denom: i16 = 8;

        // Long Term Graphs
        self.res_hist120_max = 0;
        self.com_hist120_max = 0;
        self.ind_hist120_max = 0;

        for x in (120..=238usize).rev() {
            self.res_hist120_max = max_c(self.res_hist120_max, self.res_hist[x]);
            self.com_hist120_max = max_c(self.com_hist120_max, self.com_hist[x]);
            self.ind_hist120_max = max_c(self.ind_hist120_max, self.ind_hist[x]);

            self.res_hist[x + 1] = self.res_hist[x];
            self.com_hist[x + 1] = self.com_hist[x];
            self.ind_hist[x + 1] = self.ind_hist[x];
            self.crime_hist[x + 1] = self.crime_hist[x];
            self.pollution_hist[x + 1] = self.pollution_hist[x];
            self.money_hist[x + 1] = self.money_hist[x];
        }

        self.graph120_max = self.res_hist120_max;
        self.graph120_max = max_c(self.graph120_max, self.com_hist120_max);
        self.graph120_max = max_c(self.graph120_max, self.ind_hist120_max);

        self.res_hist[120] = self.res_pop / res_pop_denom;
        self.com_hist[120] = self.com_pop;
        self.ind_hist[120] = self.ind_pop;
        self.crime_hist[120] = self.crime_hist[0];
        self.pollution_hist[120] = self.pollution_hist[0];
        self.money_hist[120] = self.money_hist[0];
    }

    /// Pure part of `collectTax`: the police, fire, road and tax funds for the
    /// given city state, as `(policeFund, fireFund, roadFund, taxFund)`.
    pub fn tax_amounts(&self) -> (i64, i64, i64, i64) {
        const R_LEVELS: [f32; 3] = [0.7, 0.9, 1.2];
        const F_LEVELS: [f32; 3] = [1.4, 1.2, 0.8];

        let g = self.game_level as usize;
        let police_fund = self.police_station_pop as i64 * 100;
        let fire_fund = self.fire_station_pop as i64 * 100;
        let road_fund =
            ((self.road_total as i32 + (self.rail_total as i32 * 2)) as f32 * R_LEVELS[g]) as i64;
        let base = (self.total_pop as i64 * self.land_value_average as i64) / 120;
        let tax_fund = ((base * self.city_tax as i64) as f32 * F_LEVELS[g]) as i64;
        (police_fund, fire_fund, road_fund, tax_fund)
    }

    /// Port of `Micropolis::collectTax`. The `doBudget()` call (budget module)
    /// happens for a populated city.
    pub fn collect_tax(&mut self) {
        self.cash_flow = 0;

        // If the Tax Port is clear
        if !self.tax_flag {
            self.city_tax_average = 0;

            let (police_fund, fire_fund, road_fund, tax_fund) = self.tax_amounts();
            self.police_fund = police_fund;
            self.fire_fund = fire_fund;
            self.road_fund = road_fund;
            self.tax_fund = tax_fund;

            if self.total_pop > 0 {
                // There are people to tax.
                self.cash_flow = (tax_fund - (police_fund + fire_fund + road_fund)) as i16;
                self.do_budget();
                // Extended rules (inert unless active): their costs, once per collection.
                self.ext_monthly_balance();
            } else {
                // Nobody lives here.
                self.road_effect = MAX_ROAD_EFFECT;
                self.police_effect = MAX_POLICE_STATION_EFFECT;
                self.fire_effect = MAX_FIRE_STATION_EFFECT;
            }
        }
    }

    /// Port of `Micropolis::updateFundEffects`: scale road, police and fire
    /// effects by the funded fraction.
    pub fn update_fund_effects(&mut self) {
        // Compute road effects of funding
        self.road_effect = MAX_ROAD_EFFECT;
        if self.road_fund > 0 {
            // Multiply with funding fraction
            self.road_effect = ((self.road_effect as f32 * self.road_spend as f32)
                / self.road_fund as f32) as i32 as i16 as i32;
        }

        // Compute police station effects of funding
        self.police_effect = MAX_POLICE_STATION_EFFECT;
        if self.police_fund > 0 {
            self.police_effect = ((self.police_effect as f32 * self.police_spend as f32)
                / self.police_fund as f32) as i32 as i16 as i32;
        }

        // Compute fire station effects of funding
        self.fire_effect = MAX_FIRE_STATION_EFFECT;
        if self.fire_fund > 0 {
            self.fire_effect = ((self.fire_effect as f32 * self.fire_spend as f32)
                / self.fire_fund as f32) as i32 as i16 as i32;
        }

        self.must_draw_budget = true;
    }

    /// Port of `Micropolis::mapScan`: visit the columns `x1..x2` and dispatch
    /// each tile to its handler (fire, flood, radiation, road, zone, rail,
    /// tiny explosion rubble).
    pub fn map_scan(&mut self, x1: i32, x2: i32) {
        let (_, h) = self.world_size();
        for x in x1..x2 {
            for y in 0..h {
                let map_val = self.sim_tile(x, y);
                if map_val == DIRT {
                    continue;
                }

                let tile = map_val & LOMASK; // Mask off status bits

                if tile < FLOOD {
                    continue;
                }

                // tile >= FLOOD
                let pos = Position::new(x, y);

                if tile < ROADBASE {
                    if tile >= FIREBASE {
                        self.fire_pop = self.fire_pop.wrapping_add(1);
                        if (self.rng.random16() & 3) == 0 {
                            self.do_fire(pos); // 1 in 4 times
                        }
                        continue;
                    }

                    if tile < RADTILE {
                        self.do_flood(pos);
                    } else {
                        self.do_rad_tile(pos);
                    }

                    continue;
                }

                if self.new_power && (map_val & CONDBIT) != 0 {
                    // Copy PWRBIT from powerGridMap
                    let _ = self.set_zone_power(pos);
                }

                if (ROADBASE..POWERBASE).contains(&tile) {
                    self.do_road(pos);
                    continue;
                }

                if map_val & ZONEBIT != 0 {
                    // process Zones
                    self.do_zone(pos);
                    continue;
                }

                if (RAILBASE..RESBASE).contains(&tile) {
                    self.do_rail(pos);
                    continue;
                }

                if (SOMETINYEXP..=LASTTINYEXP).contains(&tile) {
                    // clear AniRubble
                    let r = self.sim_random_rubble();
                    self.sim_set_tile(x, y, r);
                }
            }
        }
    }

    /// Port of `Micropolis::doRail`: count the track, generate a train and
    /// let the track deteriorate when road effect is low.
    pub fn do_rail(&mut self, pos: Position) {
        self.rail_total = self.rail_total.wrapping_add(1);

        self.generate_train(pos.x, pos.y);

        if self.road_effect < (15 * MAX_ROAD_EFFECT / 16) {
            // roadEffect < 15/16 of max road, enable deteriorating rail
            if (self.rng.random16() & 511) == 0 {
                let cur_value = self.sim_tile(pos.x, pos.y);
                if (cur_value & CONDBIT) == 0 {
                    // Otherwise the '(getRandom16() & 31)' makes no sense
                    if self.road_effect < (self.rng.random16() & 31) {
                        let tile = cur_value & LOMASK;
                        let v = if tile < RAILBASE + 2 {
                            RIVER
                        } else {
                            self.sim_random_rubble()
                        };
                        self.sim_set_tile(pos.x, pos.y, v);
                    }
                }
            }
        }
    }

    /// Port of `Micropolis::doRadTile`: radioactive decay.
    pub fn do_rad_tile(&mut self, pos: Position) {
        if (self.rng.random16() & 4095) == 0 {
            self.sim_set_tile(pos.x, pos.y, DIRT); // Radioactive decay
        }
    }

    /// Port of `Micropolis::doRoad`: count the road, let it deteriorate, try
    /// the bridge logic, and update the road tile to match the traffic.
    pub fn do_road(&mut self, pos: Position) {
        const DENSITY_TABLE: [i32; 3] = [ROADBASE as i32, LTRFBASE as i32, HTRFBASE as i32];

        self.road_total = self.road_total.wrapping_add(1);

        let map_value = self.sim_tile(pos.x, pos.y);
        let tile = map_value & LOMASK;

        // roadEffect < 15/16 of max road enables a deteriorating road. The
        // RNG draws happen in the original's order (511, then the CONDBIT test,
        // then 31), because `&&` short-circuits in the same sequence.
        if self.road_effect < (15 * MAX_ROAD_EFFECT / 16)
            && (self.rng.random16() & 511) == 0
            && (map_value & CONDBIT) == 0
            && self.road_effect < (self.rng.random16() & 31)
        {
            let v = if (tile & 15) < 2 || (tile & 15) == 15 {
                RIVER
            } else {
                self.sim_random_rubble()
            };
            self.sim_set_tile(pos.x, pos.y, v);
            return;
        }

        if (map_value & BURNBIT) == 0 {
            // If Bridge
            self.road_total = self.road_total.wrapping_add(4); // Bridge counts as 4 road tiles
            if self.do_bridge(pos, tile) {
                return;
            }
        }

        let tden: i32 = if tile < LTRFBASE {
            0
        } else if tile < HTRFBASE {
            1
        } else {
            self.road_total = self.road_total.wrapping_add(1); // Heavy traffic counts as 2 roads.
            2
        };

        let mut traffic_density = (self.traffic_density_map.world_get(pos.x, pos.y) as i32) >> 6;

        if traffic_density > 1 {
            traffic_density -= 1;
        }

        if tden != traffic_density {
            // tden 0..2
            let mut z: i32 =
                ((tile as i32 - ROADBASE as i32) & 15) + DENSITY_TABLE[traffic_density as usize];
            z |= (map_value & (ALLBITS & !ANIMBIT)) as i32;

            if traffic_density > 0 {
                z |= ANIMBIT as i32;
            }

            self.sim_set_tile(pos.x, pos.y, z as u16);
        }
    }

    /// Port of `Micropolis::doBridge`. The boat distance is computed up front,
    /// which is equivalent: `getBoatDistance` has no side effects and the RNG
    /// is only drawn in `do_bridge_with_distance`.
    pub fn do_bridge(&mut self, pos: Position, tile: Tile) -> bool {
        let boat_distance = self.get_boat_distance(pos);
        self.do_bridge_with_distance(pos, tile, boat_distance)
    }

    /// Body of `doBridge` with the distance to the nearest boat given.
    pub fn do_bridge_with_distance(
        &mut self,
        pos: Position,
        tile: Tile,
        boat_distance: i32,
    ) -> bool {
        const HDX: [i32; 7] = [-2, 2, -2, -1, 0, 1, 2];
        const HDY: [i32; 7] = [-1, -1, 0, 0, 0, 0, 0];
        const HBRTAB: [Tile; 7] = [
            HBRDG1 | BULLBIT,
            HBRDG3 | BULLBIT,
            HBRDG0 | BULLBIT,
            RIVER,
            BRWH | BULLBIT,
            RIVER,
            HBRDG2 | BULLBIT,
        ];
        const HBRTAB2: [Tile; 7] = [
            RIVER,
            RIVER,
            HBRIDGE | BULLBIT,
            HBRIDGE | BULLBIT,
            HBRIDGE | BULLBIT,
            HBRIDGE | BULLBIT,
            HBRIDGE | BULLBIT,
        ];
        const VDX: [i32; 7] = [0, 1, 0, 0, 0, 0, 1];
        const VDY: [i32; 7] = [-2, -2, -1, 0, 1, 2, 2];
        const VBRTAB: [Tile; 7] = [
            VBRDG0 | BULLBIT,
            VBRDG1 | BULLBIT,
            RIVER,
            BRWV | BULLBIT,
            RIVER,
            VBRDG2 | BULLBIT,
            VBRDG3 | BULLBIT,
        ];
        const VBRTAB2: [Tile; 7] = [
            VBRIDGE | BULLBIT,
            RIVER,
            VBRIDGE | BULLBIT,
            VBRIDGE | BULLBIT,
            VBRIDGE | BULLBIT,
            VBRIDGE | BULLBIT,
            RIVER,
        ];

        if tile == BRWV {
            // Vertical bridge close
            if (self.rng.random16() & 3) == 0 && boat_distance > 340 {
                for z in 0..7 {
                    // Close
                    let x = pos.x + VDX[z];
                    let y = pos.y + VDY[z];

                    if self.on_map(x, y) && (self.sim_tile(x, y) & LOMASK) == (VBRTAB[z] & LOMASK) {
                        self.sim_set_tile(x, y, VBRTAB2[z]);
                    }
                }
            }
            return true;
        }

        if tile == BRWH {
            // Horizontal bridge close
            if (self.rng.random16() & 3) == 0 && boat_distance > 340 {
                for z in 0..7 {
                    // Close
                    let x = pos.x + HDX[z];
                    let y = pos.y + HDY[z];

                    if self.on_map(x, y) && (self.sim_tile(x, y) & LOMASK) == (HBRTAB[z] & LOMASK) {
                        self.sim_set_tile(x, y, HBRTAB2[z]);
                    }
                }
            }
            return true;
        }

        if boat_distance < 300 || (self.rng.random16() & 7) == 0 {
            if tile & 1 != 0 {
                if pos.x < self.world_size().0 - 1 && self.sim_tile(pos.x + 1, pos.y) == CHANNEL {
                    // Vertical open
                    for z in 0..7 {
                        let x = pos.x + VDX[z];
                        let y = pos.y + VDY[z];

                        if self.on_map(x, y) {
                            let mp = self.sim_tile(x, y) as i32;
                            if mp == CHANNEL as i32 || (mp & 15) == (VBRTAB2[z] & 15) as i32 {
                                self.sim_set_tile(x, y, VBRTAB[z]);
                            }
                        }
                    }
                    return true;
                }
                false
            } else {
                if pos.y > 0 && self.sim_tile(pos.x, pos.y - 1) == CHANNEL {
                    // Horizontal open
                    for z in 0..7 {
                        let x = pos.x + HDX[z];
                        let y = pos.y + HDY[z];

                        if self.on_map(x, y) {
                            let mp = self.sim_tile(x, y) as i32;
                            if (mp & 15) == (HBRTAB2[z] & 15) as i32 || mp == CHANNEL as i32 {
                                self.sim_set_tile(x, y, HBRTAB[z]);
                            }
                        }
                    }
                    return true;
                }
                false
            }
        } else {
            false
        }
    }

    /// Port of `Micropolis::getBoatDistance`: Manhattan distance from the
    /// bridge to the nearest active ship, or 99999 when there is none.
    pub fn get_boat_distance(&self, pos: Position) -> i32 {
        let mut dist = 99999;
        let mx = pos.x * 16 + 8;
        let my = pos.y * 16 + 8;

        for (sx, sy) in self.ship_hotspots() {
            let spr_dist = (sx - mx).abs() + (sy - my).abs();
            dist = min_c(dist, spr_dist);
        }
        dist
    }

    /// Port of `Micropolis::doFire`: spread fire to burnable neighbours and,
    /// with some chance, burn out to rubble.
    pub fn do_fire(&mut self, pos: Position) {
        const DX: [i32; 4] = [-1, 0, 1, 0];
        const DY: [i32; 4] = [0, -1, 0, 1];

        // Try to set neighbouring tiles on fire as well
        for z in 0..4 {
            if (self.rng.random16() & 7) == 0 {
                let x_tem = pos.x + DX[z];
                let y_tem = pos.y + DY[z];

                if self.on_map(x_tem, y_tem) {
                    let c = self.sim_tile(x_tem, y_tem);
                    if (c & BURNBIT) == 0 {
                        continue;
                    }

                    if c & ZONEBIT != 0 {
                        // Neighbour is a zone and burnable
                        self.fire_zone(Position::new(x_tem, y_tem), c);

                        if (c & LOMASK) > IZB {
                            // Explode
                            self.make_explosion_at(x_tem * 16 + 8, y_tem * 16 + 8);
                        }
                    }

                    let f = self.sim_random_fire();
                    self.sim_set_tile(x_tem, y_tem, f);
                }
            }
        }

        // Compute likelihood of fire running out of fuel
        let mut rate: i16 = 10; // Likelihood of extinguishing (bigger means less chance)
        let z = self.fire_station_effect_map.world_get(pos.x, pos.y);

        if z > 0 {
            rate = 3;
            if z > 20 {
                rate = 2;
            }
            if z > 100 {
                rate = 1;
            }
        }

        // Decide whether to put out the fire.
        if self.rng.random(rate) == 0 {
            let r = self.sim_random_rubble();
            self.sim_set_tile(pos.x, pos.y, r);
        }
    }

    /// Port of `Micropolis::fireZone`: reduce the zone's growth rate and make
    /// its remaining tiles bulldozable.
    pub fn fire_zone(&mut self, pos: Position, ch: Tile) {
        let value = self.rate_of_growth_map.world_get(pos.x, pos.y) as i32;
        let value = clamp_c(value - 20, -200, 200);
        self.rate_of_growth_map
            .world_set(pos.x, pos.y, value as i16);

        let ch = ch & LOMASK;

        let xy_max: i32 = if ch < PORTBASE {
            2
        } else if ch == AIRPORT {
            5
        } else {
            4
        };

        // Make remaining tiles of the zone bulldozable
        for x in -1..xy_max {
            for y in -1..xy_max {
                let x_tem = pos.x + x;
                let y_tem = pos.y + y;

                if !self.on_map(x_tem, y_tem) {
                    continue;
                }

                if (self.sim_tile(x_tem, y_tem) & LOMASK) >= ROADBASE {
                    // post release
                    let t = self.sim_tile(x_tem, y_tem) | BULLBIT;
                    self.sim_set_tile(x_tem, y_tem, t);
                }
            }
        }
    }

    /// Port of `Micropolis::repairZone`: rebuild the tiles of a zone around
    /// its centre, one tile type after another.
    pub fn repair_zone(&mut self, pos: Position, z_cent: Tile, z_size: i16) {
        let mut tile: Tile = z_cent.wrapping_sub(2).wrapping_sub(z_size as u16);

        // y and x loops one position shifted to compensate for the centre-tile position.
        for y in -1..(z_size as i32 - 1) {
            for x in -1..(z_size as i32 - 1) {
                let xx = pos.x + x;
                let yy = pos.y + y;

                tile = tile.wrapping_add(1);

                if self.on_map(xx, yy) {
                    let map_value = self.sim_tile(xx, yy);

                    if map_value & ZONEBIT != 0 {
                        continue;
                    }

                    if map_value & ANIMBIT != 0 {
                        continue;
                    }

                    let map_tile = map_value & LOMASK;

                    if !(RUBBLE..ROADBASE).contains(&map_tile) {
                        self.sim_set_tile(xx, yy, tile | CONDBIT | BURNBIT);
                    }
                }
            }
        }
    }

    /// Port of `Micropolis::doSpecialZone`: update power plants, fire and
    /// police stations, stadiums, airports and ports.
    pub fn do_special_zone(&mut self, pos: Position, power_on: bool) {
        // Bigger numbers reduce chance of nuclear melt down
        const MELTDOWN_TABLE: [i16; 3] = [30000, 20000, 10000];

        let tile = self.sim_tile(pos.x, pos.y) & LOMASK;

        match tile {
            POWERPLANT => {
                self.coal_power_pop = self.coal_power_pop.wrapping_add(1);

                if (self.city_time & 7) == 0 {
                    self.repair_zone(pos, POWERPLANT, 4); // post
                }

                self.push_power_stack(pos);
                self.coal_smoke(pos);
            }
            NUCLEAR => {
                if self.enable_disasters
                    && self.rng.random(MELTDOWN_TABLE[self.game_level as usize]) == 0
                {
                    self.do_meltdown(pos);
                    return;
                }

                self.nuclear_power_pop = self.nuclear_power_pop.wrapping_add(1);

                if (self.city_time & 7) == 0 {
                    self.repair_zone(pos, NUCLEAR, 4); // post
                }

                self.push_power_stack(pos);
            }
            FIRESTATION => {
                self.fire_station_pop = self.fire_station_pop.wrapping_add(1);

                if (self.city_time & 7) == 0 {
                    self.repair_zone(pos, FIRESTATION, 3); // post
                }

                // if powered get effect, else from the funding ratio
                let mut z = if power_on {
                    self.fire_effect
                } else {
                    self.fire_effect / 2
                };

                let mut pos2 = pos;
                let found_road = self.find_perimeter_road(&mut pos2);

                if !found_road {
                    z /= 2; // post FD's need roads
                }

                let value = self.fire_station_map.world_get(pos2.x, pos2.y) as i32 + z;
                self.fire_station_map
                    .world_set(pos2.x, pos2.y, value as i16);
            }
            POLICESTATION => {
                self.police_station_pop = self.police_station_pop.wrapping_add(1);

                if (self.city_time & 7) == 0 {
                    self.repair_zone(pos, POLICESTATION, 3); // post
                }

                let mut z = if power_on {
                    self.police_effect
                } else {
                    self.police_effect / 2
                };

                let mut pos2 = pos;
                let found_road = self.find_perimeter_road(&mut pos2);

                if !found_road {
                    z /= 2; // post PD's need roads
                }

                let value = self.police_station_map.world_get(pos2.x, pos2.y) as i32 + z;
                self.police_station_map
                    .world_set(pos2.x, pos2.y, value as i16);
            }
            STADIUM => {
                // Empty stadium
                self.stadium_pop = self.stadium_pop.wrapping_add(1);

                if (self.city_time & 15) == 0 {
                    self.repair_zone(pos, STADIUM, 4);
                }

                if power_on {
                    // Every now and then, display a match
                    if ((self.city_time + pos.x as i64 + pos.y as i64) & 31) == 0 {
                        self.draw_stadium(pos, FULLSTADIUM);
                        self.sim_set_tile(pos.x + 1, pos.y, FOOTBALLGAME1 + ANIMBIT);
                        self.sim_set_tile(pos.x + 1, pos.y + 1, FOOTBALLGAME2 + ANIMBIT);
                    }
                }
            }
            FULLSTADIUM => {
                // Full stadium
                self.stadium_pop = self.stadium_pop.wrapping_add(1);

                if ((self.city_time + pos.x as i64 + pos.y as i64) & 7) == 0 {
                    // Stop the match
                    self.draw_stadium(pos, STADIUM);
                }
            }
            AIRPORT => {
                self.airport_pop = self.airport_pop.wrapping_add(1);

                if (self.city_time & 7) == 0 {
                    self.repair_zone(pos, AIRPORT, 6);
                }

                // If powered, display a rotating radar
                if power_on {
                    if (self.sim_tile(pos.x + 1, pos.y - 1) & LOMASK) == RADAR {
                        self.sim_set_tile(
                            pos.x + 1,
                            pos.y - 1,
                            RADAR0 + ANIMBIT + CONDBIT + BURNBIT,
                        );
                    }
                } else {
                    self.sim_set_tile(pos.x + 1, pos.y - 1, RADAR + CONDBIT + BURNBIT);
                }

                if power_on {
                    // Handle the airport only if there is power
                    self.do_airport(pos);
                }
            }
            PORT => {
                self.seaport_pop = self.seaport_pop.wrapping_add(1);

                if (self.city_time & 15) == 0 {
                    self.repair_zone(pos, PORT, 4);
                }

                // If port has power and there is no ship, generate one
                if power_on && !self.sprite_of_kind_exists(SPRITE_SHIP) {
                    self.generate_ship();
                }
            }
            _ => {}
        }
    }

    /// Port of `Micropolis::drawStadium`: draw a stadium (full or empty) with
    /// its centre at `center`.
    pub fn draw_stadium(&mut self, center: Position, z: Tile) {
        let mut z = z.wrapping_sub(5);

        for y in (center.y - 1)..(center.y + 3) {
            for x in (center.x - 1)..(center.x + 3) {
                self.sim_set_tile(x, y, z | BNCNBIT);
                z = z.wrapping_add(1);
            }
        }

        let t = self.sim_tile(center.x, center.y) | ZONEBIT | PWRBIT;
        self.sim_set_tile(center.x, center.y, t);
    }

    /// Port of `Micropolis::doAirport`: now and then generate an airplane or
    /// a helicopter.
    pub fn do_airport(&mut self, pos: Position) {
        if self.rng.random(5) == 0 {
            self.generate_plane(pos);
            return;
        }

        if self.rng.random(12) == 0 {
            self.generate_copter(pos);
        }
    }

    /// Port of `Micropolis::coalSmoke`: draw the smoke tiles around a coal
    /// power plant.
    pub fn coal_smoke(&mut self, pos: Position) {
        const SM_TB: [Tile; 4] = [COALSMOKE1, COALSMOKE2, COALSMOKE3, COALSMOKE4];
        const DX: [i32; 4] = [1, 2, 1, 2];
        const DY: [i32; 4] = [-1, -1, 0, 0];

        for x in 0..4 {
            self.sim_set_tile(
                pos.x + DX[x],
                pos.y + DY[x],
                SM_TB[x] | ANIMBIT | CONDBIT | PWRBIT | BURNBIT,
            );
        }
    }

    /// Port of `Micropolis::doMeltdown`: a nuclear power plant melts down.
    pub fn do_meltdown(&mut self, pos: Position) {
        self.make_explosion(pos.x - 1, pos.y - 1);
        self.make_explosion(pos.x - 1, pos.y + 2);
        self.make_explosion(pos.x + 2, pos.y - 1);
        self.make_explosion(pos.x + 2, pos.y + 2);

        // Whole power plant is at fire
        for x in (pos.x - 1)..(pos.x + 3) {
            for y in (pos.y - 1)..(pos.y + 3) {
                let f = self.sim_random_fire();
                self.sim_set_tile(x, y, f);
            }
        }

        // Add lots of radiation tiles around the plant
        for _ in 0..200 {
            let x = pos.x - 20 + self.rng.random(40) as i32;
            let y = pos.y - 15 + self.rng.random(30) as i32;

            if !self.on_map(x, y) {
                // Ignore off-map positions
                continue;
            }

            let t = self.sim_tile(x, y);

            if t & ZONEBIT != 0 {
                continue; // Ignore zones
            }

            if (t & BURNBIT) != 0 || t == DIRT {
                self.sim_set_tile(x, y, RADTILE); // Make tile radio-active
            }
        }

        // Report disaster to the user
        self.send_message(
            MESSAGE_NUCLEAR_MELTDOWN,
            pos.x as i16,
            pos.y as i16,
            true,
            true,
        );
    }

    // ---- simHeat / simLoop / simTick / simUpdate (main.cpp) -----------------

    /// Port of `Micropolis::simHeat`: one step of the heat/cellular-automaton
    /// effect on the tile map. `cell_src` keeps the state between steps, as
    /// the original `cellSrc` buffer does, and `heat_a` is the function-static
    /// accumulator of the original.
    ///
    /// Divergence: the original's `heatWrap == 4` writes two corner cells past
    /// the end of its buffer (undefined behaviour); those two writes are skipped.
    /// For odd world widths the reverse column pass is skipped after the last
    /// column (the original would process a column past the map).
    pub fn sim_heat(&mut self) {
        let (w, h) = self.world_size();
        let (wu, hu) = (w as usize, h as usize);
        let sc = hu + 2; // SRCCOL
        if self.cell_src.len() != (wu + 2) * sc {
            self.cell_src = vec![0; (wu + 2) * sc];
        }
        let mut cell = std::mem::take(&mut self.cell_src);
        let fl = self.heat_flow;

        // Copy wrapping edges (see the diagram in main.cpp).
        let tile = |i: usize| self.tiles[i] as i16;
        match self.heat_wrap {
            0 => {}
            1 => {
                for x in 0..wu {
                    let s = (x + 1) * sc + 1;
                    for y in 0..hu {
                        cell[s + y] = tile(x * hu + y);
                    }
                }
            }
            2 => {
                for x in 0..wu {
                    let s = (x + 1) * sc + 1;
                    cell[s - 1] = cell[s + hu - 1];
                    cell[s + hu] = cell[s];
                }
                cell.copy_within(sc * wu..sc * wu + sc, 0);
                cell.copy_within(sc..2 * sc, sc * (wu + 1));
            }
            3 => {
                for x in 0..wu {
                    let s = (x + 1) * sc + 1;
                    for y in 0..hu {
                        cell[s + y] = tile(x * hu + y);
                    }
                    cell[s - 1] = cell[s + hu - 1];
                    cell[s + hu] = cell[s];
                }
                cell.copy_within(sc * wu..sc * wu + sc, 0);
                cell.copy_within(sc..2 * sc, sc * (wu + 1));
            }
            4 => {
                let s0 = sc + 1;
                cell[s0] = tile(0);
                cell[s0 + 1 + hu] = tile(hu - 1);
                // The original also writes src[(1+W)*SRCCOL] and
                // src[(2+W)*SRCCOL-1]: past the end of cellSrc (skipped here).
                for x in 0..wu {
                    let s = (x + 1) * sc + 1;
                    for y in 0..hu {
                        cell[s + y] = tile(x * hu + y);
                    }
                    cell[s - 1] = cell[s];
                    cell[s + hu] = cell[s + hu - 1];
                }
                cell.copy_within(sc * wu..sc * wu + sc, sc * (wu + 1));
                cell.copy_within(sc..2 * sc, 0);
            }
            other => panic!("simHeat: heatWrap {other} out of range"),
        }

        let mut a = self.heat_a;
        let rule = self.heat_rule;
        let f_fl = fl;
        let f16 = fl as i16;

        // Gather the 3x3 neighbourhood of interior cell (x, y): column x+1 and
        // row y+1 are the centre, as in the original sliding window.
        let idx = |col: usize, row: usize| col * sc + row;
        let mut visit = |tiles: &mut [Tile], x: usize, y: usize| {
            let nw = cell[idx(x, y)] as i32;
            let n = cell[idx(x + 1, y)] as i32;
            let ne = cell[idx(x + 2, y)] as i32;
            let w = cell[idx(x, y + 1)] as i32;
            let c = cell[idx(x + 1, y + 1)] as i32;
            let e = cell[idx(x + 2, y + 1)] as i32;
            let sw = cell[idx(x, y + 2)] as i32;
            let s = cell[idx(x + 1, y + 2)] as i32;
            let se = cell[idx(x + 2, y + 2)] as i32;
            let out: u16 = if rule == 0 {
                a += nw + n + ne + w + e + sw + s + se + f_fl;
                let v =
                    (((a >> 3) & LOMASK as i32) | ANIMBIT as i32 | BURNBIT as i32 | BULLBIT as i32)
                        as u16;
                a &= 7;
                v
            } else {
                // Values are `short` in the original: wrap to 16 bits.
                let mut c16 = c as i16;
                let mut n16 = n as i16;
                let mut s16 = s as i16;
                let mut e16 = e as i16;
                let mut w16 = w as i16;
                let mut ne16 = ne as i16;
                let mut nw16 = nw as i16;
                let mut se16 = se as i16;
                let mut sw16 = sw as i16;
                c16 = c16.wrapping_sub(f16);
                n16 = n16.wrapping_sub(f16);
                s16 = s16.wrapping_sub(f16);
                e16 = e16.wrapping_sub(f16);
                w16 = w16.wrapping_sub(f16);
                ne16 = ne16.wrapping_sub(f16);
                nw16 = nw16.wrapping_sub(f16);
                se16 = se16.wrapping_sub(f16);
                sw16 = sw16.wrapping_sub(f16);
                let (c, n, s, e, w) = (c16 as i32, n16 as i32, s16 as i32, e16 as i32, w16 as i32);
                let (ne, nw, se, sw) = (ne16 as i32, nw16 as i32, se16 as i32, sw16 as i32);
                // anneal
                let sum = (c & 1)
                    + (n & 1)
                    + (s & 1)
                    + (e & 1)
                    + (w & 1)
                    + (ne & 1)
                    + (nw & 1)
                    + (se & 1)
                    + (sw & 1);
                let cell_val: i32 = if sum > 5 || sum == 4 {
                    // brian's brain
                    let twos = (n & 2)
                        + (s & 2)
                        + (e & 2)
                        + (w & 2)
                        + (ne & 2)
                        + (nw & 2)
                        + (se & 2)
                        + (sw & 2);
                    ((c << 1) & 0x3fc)
                        | (if ((c >> 1) & 3) == 0 && twos == (2 << 1) {
                            2
                        } else {
                            0
                        })
                        | 1
                } else {
                    // anti-life
                    let sum2 = ((n & 2)
                        + (s & 2)
                        + (e & 2)
                        + (w & 2)
                        + (ne & 2)
                        + (nw & 2)
                        + (se & 2)
                        + (sw & 2))
                        >> 1;
                    (((c ^ 2) << 1) & 0x3fc)
                        | (if c & 2 != 0 {
                            if sum2 != 5 {
                                2
                            } else {
                                0
                            }
                        } else if sum2 != 5 && sum2 != 6 {
                            2
                        } else {
                            0
                        })
                };
                (((f_fl + cell_val) & LOMASK as i32)
                    | ANIMBIT as i32
                    | BURNBIT as i32
                    | BULLBIT as i32) as u16
            };
            let i = x * hu + y;
            tiles[i] = out;
        };

        // Clipper traversal: column x forward, column x+1 backward, alternating.
        let mut x = 0usize;
        let tiles = &mut self.tiles;
        while x < wu {
            for y in 0..hu {
                visit(tiles, x, y);
            }
            x += 1;
            if x < wu {
                for y in (0..hu).rev() {
                    visit(tiles, x, y);
                }
            }
            x += 1;
        }

        self.heat_a = a;
        self.cell_src = cell;
    }

    /// Port of `Micropolis::simLoop`: run the heat steps or one simulation
    /// frame, then move the sprites.
    pub fn sim_loop(&mut self, do_sim: bool) {
        if self.heat_steps != 0 {
            for _ in 0..self.heat_steps {
                self.sim_heat();
            }

            self.move_objects();

            self.new_map = 1;
        } else {
            if do_sim {
                self.sim_frame();
            }

            self.move_objects();
        }

        self.sim_loops += 1;
    }

    /// Port of `Micropolis::simTick`: advance the simulation by one tick
    /// (`simPasses` loops when running), then update the displayed heads.
    pub fn sim_tick(&mut self) {
        if self.sim_speed != 0 {
            self.sim_pass = 0;
            while self.sim_pass < self.sim_passes {
                self.sim_loop(true);
                self.sim_pass += 1;
            }
        }
        self.sim_update();
    }

    /// Port of `Micropolis::simUpdate`. The blink flag (clock based) and
    /// the front-end refresh calls are part of the UI and are dropped.
    pub fn sim_update(&mut self) {
        if self.sim_speed != 0 && self.heat_steps == 0 {
            self.tiles_animated = false;
        }

        self.do_update_heads();
        self.graph_doer();
        self.update_budget();
        self.score_doer();
    }
}
