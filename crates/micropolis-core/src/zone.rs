//! Port of `zone.cpp`: zone growth and decline.
//!
//! Every `Micropolis::` member of the C++ file is ported here, with the same
//! RNG call order and evaluation order. Deliberate divergences, both with no
//! effect on engine state:
//! - `callback("simulateChurch", ...)` is a front-end notification and is dropped.
//! - The `printf` for an unexpected zone is a diagnostic and is dropped.
//!
//! Integer widths follow the C++: `short` is `i16` (wrapping where it can
//! overflow), `int` is `i32`, `MapTile`/`MapValue` are `u16`.

use crate::position::Position;
use crate::traffic::ZoneType;
#[cfg(test)]
use std::cell::Cell;

#[cfg(test)]
thread_local! {
    /// Value returned instead of the real `make_traffic` in unit tests, which
    /// mirror a C++ harness that stubs `makeTraffic`. Each test runs on its own thread.
    pub(crate) static TEST_TRAFFIC_RESULT: Cell<i16> = const { Cell::new(1) };
}
use crate::simulation::Simulation;
use crate::tile::{
    Tile, ANIMBIT, BLBNCNBIT, BNCNBIT, BULLBIT, BURNBIT, CONDBIT, LOMASK, PWRBIT, ZONEBIT,
};
use crate::tile_chars::*;

const ASCBIT: Tile = ANIMBIT | CONDBIT | BURNBIT;
const REGBIT: Tile = CONDBIT | BURNBIT;

impl Simulation {
    /// `makeTraffic(pos, dest)`; unit tests substitute a scripted result.
    fn zone_make_traffic(&mut self, pos: Position, dest: ZoneType) -> i16 {
        #[cfg(test)]
        {
            let _ = (pos, dest);
            TEST_TRAFFIC_RESULT.with(|c| c.get())
        }
        #[cfg(not(test))]
        {
            self.make_traffic_from(pos, dest)
        }
    }

    /// `map[x][y]` (full value with status bits). Callers guarantee the position
    /// is in the world, as the C++ does.
    fn map_at(&self, x: i32, y: i32) -> Tile {
        self.tile(x, y).expect("zone tile access outside the world")
    }

    /// `map[x][y] = value`, ignored outside the world (the C++ guards with testBounds).
    fn put_map(&mut self, x: i32, y: i32, value: Tile) {
        self.set_tile(x, y, value);
    }

    /// Handle zone (`doZone`). Dispatches on the centre tile of the zone.
    pub fn do_zone(&mut self, pos: Position) {
        // Set Power Bit in Map from powerGridMap.
        let zone_power = self.set_zone_power(pos);

        if zone_power {
            self.powered_zone_count = self.powered_zone_count.wrapping_add(1);
        } else {
            self.unpowered_zone_count = self.unpowered_zone_count.wrapping_add(1);
        }

        let tile = self.map_at(pos.x, pos.y) & LOMASK;

        // Special zones.
        if tile > PORTBASE && tile < CHURCH1BASE {
            self.do_special_zone(pos, zone_power);
            return;
        }

        // Residential zones.
        if tile < HOSPITAL {
            self.do_residential(pos, zone_power);
            return;
        }

        // Hospitals and churches.
        if tile < COMBASE || (CHURCH1BASE..=CHURCH7LAST).contains(&tile) {
            self.do_hospital_church(pos);
            return;
        }

        // Commercial zones.
        if tile < INDBASE {
            self.do_commercial(pos, zone_power);
            return;
        }

        // Industrial zones.
        if tile < CHURCH1BASE {
            self.do_industrial(pos, zone_power);
        }
        // Otherwise: "UNEXPOECTED ZONE" in C++, a diagnostic only.
    }

    /// Repair or remove a hospital or church (`doHospitalChurch`).
    pub fn do_hospital_church(&mut self, pos: Position) {
        let tile = self.map_at(pos.x, pos.y) & LOMASK;

        if tile == HOSPITAL {
            self.hospital_pop = self.hospital_pop.wrapping_add(1);

            if (self.city_time & 15) == 0 {
                self.repair_zone(pos, HOSPITAL, 3);
            }

            if self.need_hospital == -1 && self.rng.random(20) == 0 {
                // Too many hospitals: remove this one.
                self.zone_plop(pos, i32::from(RESBASE));
            }
        } else if matches!(
            tile,
            CHURCH0 | CHURCH1 | CHURCH2 | CHURCH3 | CHURCH4 | CHURCH5 | CHURCH6 | CHURCH7
        ) {
            self.church_pop = self.church_pop.wrapping_add(1);

            if (self.city_time & 15) == 0 {
                self.repair_zone(pos, tile, 3);
            }

            if self.need_church == -1 && self.rng.random(20) == 0 {
                // Too many churches: remove this one. (The C++ then skips its
                // "simulateChurch" front-end notification, which is dropped here.)
                self.zone_plop(pos, i32::from(RESBASE));
            }
        }
    }

    /// Animate the smoke of an industrial zone (`setSmoke`).
    pub fn set_smoke(&mut self, pos: Position, zone_power: bool) {
        const ANI_THIS: [bool; 8] = [true, false, true, true, false, false, true, true];
        const DX1: [i32; 8] = [-1, 0, 1, 0, 0, 0, 0, 1];
        const DY1: [i32; 8] = [-1, 0, -1, -1, 0, 0, -1, -1];
        const ANI_TAB_A: [i32; 8] = [0, 0, 32, 40, 0, 0, 48, 56];
        const ANI_TAB_B: [i32; 8] = [0, 0, 36, 44, 0, 0, 52, 60];
        const ANI_TAB_C: [i32; 8] = [
            IND1 as i32,
            0,
            IND2 as i32,
            IND4 as i32,
            0,
            0,
            IND6 as i32,
            IND8 as i32,
        ];
        const ANI_TAB_D: [i32; 8] = [
            IND1 as i32,
            0,
            IND3 as i32,
            IND5 as i32,
            0,
            0,
            IND7 as i32,
            IND9 as i32,
        ];

        let tile = self.map_at(pos.x, pos.y) & LOMASK;

        if tile < IZB {
            return;
        }

        let z = (((i32::from(tile) - IZB as i32) >> 3) & 7) as usize;

        if ANI_THIS[z] {
            let xx = pos.x + DX1[z];
            let yy = pos.y + DY1[z];

            if self.on_map(xx, yy) {
                if zone_power {
                    // The C++ assigns the same position twice; the second wins.
                    if i32::from(self.map_at(xx, yy) & LOMASK) == ANI_TAB_C[z] {
                        self.put_map(xx, yy, ASCBIT | (SMOKEBASE + ANI_TAB_A[z] as u16));
                        self.put_map(xx, yy, ASCBIT | (SMOKEBASE + ANI_TAB_B[z] as u16));
                    }
                } else if i32::from(self.map_at(xx, yy) & LOMASK) > ANI_TAB_C[z] {
                    self.put_map(xx, yy, REGBIT | ANI_TAB_C[z] as u16);
                    self.put_map(xx, yy, REGBIT | ANI_TAB_D[z] as u16);
                }
            }
        }
    }

    /// Add a new hospital or church if one is needed (`makeHospital`).
    pub fn make_hospital(&mut self, pos: Position) {
        if self.need_hospital > 0 {
            self.zone_plop(pos, HOSPITAL as i32 - 4);
            self.need_hospital = 0;
            return;
        }

        if self.need_church > 0 {
            let church_type = i32::from(self.rng.random(7)); // 0 to 7 inclusive
            let tile = if church_type == 0 {
                CHURCH0 as i32
            } else {
                CHURCH1 as i32 + (church_type - 1) * 9
            };

            self.zone_plop(pos, tile - 4);
            self.need_church = 0;
        }
    }

    /// Land value at `pos` minus pollution, bucketed to 0..=3 (`getLandPollutionValue`).
    pub fn get_land_pollution_value(&self, pos: Position) -> i16 {
        let land_val = i16::from(self.land_value_map.world_get(pos.x, pos.y))
            - i16::from(self.pollution_density_map.world_get(pos.x, pos.y));

        if land_val < 30 {
            0
        } else if land_val < 80 {
            1
        } else if land_val < 150 {
            2
        } else {
            3
        }
    }

    /// Update the rate of growth at `pos` by `amount` (`incRateOfGrowth`).
    pub fn inc_rate_of_growth(&mut self, pos: Position, amount: i32) {
        let value = i32::from(self.rate_of_growth_map.world_get(pos.x, pos.y));
        let value = (value + amount * 4).clamp(-200, 200);
        self.rate_of_growth_map
            .world_set(pos.x, pos.y, value as i16);
    }

    /// Put down a 3x3 zone around the centre tile at `pos` (`zonePlop`).
    /// Returns false if a fire or flood is next to the site.
    ///
    /// The C++ `base` argument is an `int` and advances for every tile of the
    /// 3x3 block, including tiles outside the world.
    pub fn zone_plop(&mut self, pos: Position, mut base: i32) -> bool {
        const ZX: [i32; 9] = [-1, 0, 1, -1, 0, 1, -1, 0, 1];
        const ZY: [i32; 9] = [-1, -1, -1, 0, 0, 0, 1, 1, 1];

        // Check for fire or flood.
        for z in 0..9 {
            let xx = pos.x + ZX[z];
            let yy = pos.y + ZY[z];

            if self.on_map(xx, yy) {
                let x = self.map_at(xx, yy) & LOMASK;

                if (FLOOD..ROADBASE).contains(&x) {
                    return false;
                }
            }
        }

        for z in 0..9 {
            let xx = pos.x + ZX[z];
            let yy = pos.y + ZY[z];

            if self.on_map(xx, yy) {
                self.put_map(xx, yy, (base + BNCNBIT as i32) as u16);
            }

            base += 1;
        }

        self.set_zone_power(pos);
        let centre = self.map_at(pos.x, pos.y) | (ZONEBIT + BULLBIT);
        self.put_map(pos.x, pos.y, centre);

        true
    }

    /// Count the single-tile houses in the 3x3 block around `pos` (`doFreePop`).
    pub fn do_free_pop(&self, pos: Position) -> i16 {
        let mut count: i16 = 0;

        for x in pos.x - 1..=pos.x + 1 {
            for y in pos.y - 1..=pos.y + 1 {
                if self.on_map(x, y) {
                    let tile = self.map_at(x, y) & LOMASK;
                    if (LHTHR..=HHTHR).contains(&tile) {
                        count += 1;
                    }
                }
            }
        }

        count
    }

    /// Copy the power-grid value at `pos` into the map. Returns whether the
    /// tile has power (`setZonePower`).
    pub fn set_zone_power(&mut self, pos: Position) -> bool {
        let map_value = self.map_at(pos.x, pos.y);
        let tile = map_value & LOMASK;

        if tile == NUCLEAR || tile == POWERPLANT {
            self.put_map(pos.x, pos.y, map_value | PWRBIT);
            return true;
        }

        if self.power_grid_map.world_get(pos.x, pos.y) != 0 {
            self.put_map(pos.x, pos.y, map_value | PWRBIT);
            true
        } else {
            self.put_map(pos.x, pos.y, map_value & !PWRBIT);
            false
        }
    }

    /// Try to build a house on the best lot around the zone centre `pos`
    /// (`buildHouse`).
    pub fn build_house(&mut self, pos: Position, value: i32) {
        const ZE_X: [i32; 9] = [0, -1, 0, 1, -1, 1, -1, 0, 1];
        const ZE_Y: [i32; 9] = [0, -1, -1, -1, 0, 0, 1, 1, 1];

        let mut best_loc: i16 = 0;
        let mut hscore: i16 = 0;

        for z in 1..9 {
            let xx = pos.x + ZE_X[z];
            let yy = pos.y + ZE_Y[z];

            if self.on_map(xx, yy) {
                let score = self.eval_lot(xx, yy);

                // C++ BUG (kept): score is -1, not 0, for an unsuitable lot.
                if score != 0 {
                    if score > hscore {
                        hscore = score;
                        best_loc = z as i16;
                    }

                    // The random draw happens only when the scores are equal.
                    if score == hscore && (self.rng.random16() & 7) == 0 {
                        best_loc = z as i16;
                    }
                }
            }
        }

        if best_loc != 0 {
            let xx = pos.x + ZE_X[best_loc as usize];
            let yy = pos.y + ZE_Y[best_loc as usize];

            if self.on_map(xx, yy) {
                // HOUSE is the proper constant here (C++ @todo).
                let tile =
                    HOUSE as i32 + BLBNCNBIT as i32 + i32::from(self.rng.random(2)) + value * 3;
                self.put_map(xx, yy, tile as u16);
            }
        }
    }

    /// Suitability of the lot at `(x, y)` for a new house (`evalLot`).
    pub fn eval_lot(&self, x: i32, y: i32) -> i16 {
        const DX: [i32; 4] = [0, 1, 0, -1];
        const DY: [i32; 4] = [-1, 0, 1, 0];

        // Test for a clear lot.
        let z = self.map_at(x, y) & LOMASK;

        if z != 0 && !(RESBASE..=RESBASE + 8).contains(&z) {
            return -1;
        }

        let mut score: i16 = 1;

        for z in 0..4 {
            let xx = x + DX[z];
            let yy = y + DY[z];

            if self.on_map(xx, yy)
                && self.map_at(xx, yy) != DIRT
                && (self.map_at(xx, yy) & LOMASK) <= LASTROAD
            {
                score += 1; // look for road
            }
        }

        score
    }

    /// Handle a residential zone (`doResidential`).
    pub fn do_residential(&mut self, pos: Position, zone_power: bool) {
        self.res_zone_pop = self.res_zone_pop.wrapping_add(1);

        let tile = self.map_at(pos.x, pos.y) & LOMASK;

        let tpop: i16 = if tile == FREEZ {
            self.do_free_pop(pos)
        } else {
            self.get_res_zone_pop(tile)
        };

        self.res_pop = self.res_pop.wrapping_add(tpop);

        let trf_good: i16 = if tpop > self.rng.random(35) {
            // Try driving from residential to commercial.
            self.zone_make_traffic(pos, ZoneType::Commercial)
        } else {
            1
        };

        if trf_good == -1 {
            let value = i32::from(self.get_land_pollution_value(pos));
            self.do_res_out(pos, i32::from(tpop), value);
            return;
        }

        if tile == FREEZ || (self.rng.random16() & 7) == 0 {
            let locvalve = self.eval_res(pos, i32::from(trf_good));
            let mut zscore = self.res_valve.wrapping_add(locvalve);

            if !zone_power {
                zscore = -500;
            }

            if zscore > -350
                && ((i32::from(zscore) - 26380) as i16) > (self.rng.random16_signed() as i16)
            {
                if tpop == 0 && (self.rng.random16() & 3) == 0 {
                    self.make_hospital(pos);
                    return;
                }

                let value = i32::from(self.get_land_pollution_value(pos));
                self.do_res_in(pos, i32::from(tpop), value);
                return;
            }

            if zscore < 350
                && ((i32::from(zscore) + 26380) as i16) < (self.rng.random16_signed() as i16)
            {
                let value = i32::from(self.get_land_pollution_value(pos));
                self.do_res_out(pos, i32::from(tpop), value);
            }
        }
    }

    /// Residential immigration into the current residential tile (`doResIn`).
    pub fn do_res_in(&mut self, pos: Position, pop: i32, value: i32) {
        let pollution = i32::from(self.pollution_density_map.world_get(pos.x, pos.y));

        if pollution > 128 {
            return;
        }

        let tile = self.map_at(pos.x, pos.y) & LOMASK;

        if tile == FREEZ {
            if pop < 8 {
                self.build_house(pos, value);
                self.inc_rate_of_growth(pos, 1);
                return;
            }

            if i32::from(self.population_density_map.world_get(pos.x, pos.y)) > 64 {
                self.res_plop(pos, 0, value);
                self.inc_rate_of_growth(pos, 8);
            }

            return;
        }

        if pop < 40 {
            self.res_plop(pos, (pop / 8) - 1, value);
            self.inc_rate_of_growth(pos, 8);
        }
    }

    /// Residential emigration from the current residential tile (`doResOut`).
    pub fn do_res_out(&mut self, pos: Position, pop: i32, value: i32) {
        const BRDR: [i32; 9] = [0, 3, 6, 1, 4, 7, 2, 5, 8];

        if pop == 0 {
            return;
        }

        if pop > 16 {
            self.res_plop(pos, (pop - 24) / 8, value);
            self.inc_rate_of_growth(pos, -8);
            return;
        }

        if pop == 16 {
            self.inc_rate_of_growth(pos, -8);
            self.put_map(pos.x, pos.y, FREEZ | BLBNCNBIT | ZONEBIT);
            for x in pos.x - 1..=pos.x + 1 {
                for y in pos.y - 1..=pos.y + 1 {
                    if self.on_map(x, y) && (self.map_at(x, y) & LOMASK) != FREEZ {
                        let tile =
                            LHTHR as i32 + value + i32::from(self.rng.random(2)) + BLBNCNBIT as i32;
                        self.put_map(x, y, tile as u16);
                    }
                }
            }
        }

        if pop < 16 {
            self.inc_rate_of_growth(pos, -1);
            let mut z: usize = 0;
            for x in pos.x - 1..=pos.x + 1 {
                for y in pos.y - 1..=pos.y + 1 {
                    if self.on_map(x, y) {
                        let loc = self.map_at(x, y) & LOMASK;
                        if (LHTHR..=HHTHR).contains(&loc) {
                            let tile = BRDR[z] + BLBNCNBIT as i32 + FREEZ as i32 - 4;
                            self.put_map(x, y, tile as u16);
                            return;
                        }
                    }
                    z += 1;
                }
            }
        }
    }

    /// Population of a residential zone centre tile (`getResZonePop`).
    pub fn get_res_zone_pop(&self, map_tile: Tile) -> i16 {
        let cz_den = ((i32::from(map_tile) - RZB as i32) / 9) % 4;
        (cz_den * 8 + 16) as i16
    }

    /// Place a residential zone (`resPlop`).
    pub fn res_plop(&mut self, pos: Position, den: i32, value: i32) {
        let base = (((value * 4 + den) * 9) + RZB as i32 - 4) as i16;
        self.zone_plop(pos, i32::from(base));
    }

    /// Evaluate a residential zone (`evalRes`).
    pub fn eval_res(&self, pos: Position, traf: i32) -> i16 {
        if traf < 0 {
            return -3000;
        }

        let mut value = i16::from(self.land_value_map.world_get(pos.x, pos.y))
            - i16::from(self.pollution_density_map.world_get(pos.x, pos.y));

        if value < 0 {
            value = 0; // cap at 0
        } else {
            value = (i32::from(value) * 32).min(6000) as i16; // cap at 6000
        }

        value - 3000
    }

    /// Handle a commercial zone (`doCommercial`).
    pub fn do_commercial(&mut self, pos: Position, zone_power: bool) {
        let tile = self.map_at(pos.x, pos.y) & LOMASK;

        self.com_zone_pop = self.com_zone_pop.wrapping_add(1);
        let tpop = self.get_com_zone_pop(tile);
        self.com_pop = self.com_pop.wrapping_add(tpop);

        let trf_good: i16 = if tpop > self.rng.random(5) {
            // Try driving from commercial to industrial.
            self.zone_make_traffic(pos, ZoneType::Industrial)
        } else {
            1
        };

        if trf_good == -1 {
            let value = i32::from(self.get_land_pollution_value(pos));
            self.do_com_out(pos, i32::from(tpop), value);
            return;
        }

        if (self.rng.random16() & 7) == 0 {
            let locvalve = self.eval_com(pos, i32::from(trf_good));
            let mut zscore = self.com_valve.wrapping_add(locvalve);

            if !zone_power {
                zscore = -500;
            }

            if trf_good != 0
                && zscore > -350
                && ((i32::from(zscore) - 26380) as i16) > (self.rng.random16_signed() as i16)
            {
                let value = i32::from(self.get_land_pollution_value(pos));
                self.do_com_in(pos, i32::from(tpop), value);
                return;
            }

            if zscore < 350
                && ((i32::from(zscore) + 26380) as i16) < (self.rng.random16_signed() as i16)
            {
                let value = i32::from(self.get_land_pollution_value(pos));
                self.do_com_out(pos, i32::from(tpop), value);
            }
        }
    }

    /// Commercial immigration (`doComIn`).
    pub fn do_com_in(&mut self, pos: Position, pop: i32, value: i32) {
        let z = i32::from(self.land_value_map.world_get(pos.x, pos.y)) >> 5;

        if pop > z {
            return;
        }

        if pop < 5 {
            self.com_plop(pos, pop, value);
            self.inc_rate_of_growth(pos, 8);
        }
    }

    /// Commercial emigration (`doComOut`).
    pub fn do_com_out(&mut self, pos: Position, pop: i32, value: i32) {
        if pop > 1 {
            self.com_plop(pos, pop - 2, value);
            self.inc_rate_of_growth(pos, -8);
            return;
        }

        if pop == 1 {
            self.zone_plop(pos, i32::from(COMBASE));
            self.inc_rate_of_growth(pos, -8);
        }
    }

    /// Population number of a commercial zone (`getComZonePop`).
    pub fn get_com_zone_pop(&self, tile: Tile) -> i16 {
        if tile == COMCLR {
            return 0;
        }

        let cz_den = ((i32::from(tile) - CZB as i32) / 9) % 5 + 1;
        cz_den as i16
    }

    /// Place a commercial zone (`comPlop`).
    pub fn com_plop(&mut self, pos: Position, den: i32, value: i32) {
        let base = (((value * 5) + den) * 9 + CZB as i32 - 4) as i16;
        self.zone_plop(pos, i32::from(base));
    }

    /// Evaluate a commercial zone (`evalCom`).
    pub fn eval_com(&self, pos: Position, traf: i32) -> i16 {
        if traf < 0 {
            return -3000;
        }

        self.com_rate_map.world_get(pos.x, pos.y)
    }

    /// Handle an industrial zone (`doIndustrial`).
    pub fn do_industrial(&mut self, pos: Position, zone_power: bool) {
        let tile = self.map_at(pos.x, pos.y) & LOMASK;

        self.ind_zone_pop = self.ind_zone_pop.wrapping_add(1);
        self.set_smoke(pos, zone_power);
        let tpop = self.get_ind_zone_pop(tile);
        self.ind_pop = self.ind_pop.wrapping_add(tpop);

        let trf_good: i16 = if tpop > self.rng.random(5) {
            // Try driving from industrial to residential.
            self.zone_make_traffic(pos, ZoneType::Residential)
        } else {
            1
        };

        if trf_good == -1 {
            let value = self.rng.random16() & 1;
            self.do_ind_out(pos, i32::from(tpop), value);
            return;
        }

        if (self.rng.random16() & 7) == 0 {
            let mut zscore = self
                .ind_valve
                .wrapping_add(self.eval_ind(i32::from(trf_good)));

            if !zone_power {
                zscore = -500;
            }

            if zscore > -350
                && ((i32::from(zscore) - 26380) as i16) > (self.rng.random16_signed() as i16)
            {
                let value = self.rng.random16() & 1;
                self.do_ind_in(pos, i32::from(tpop), value);
                return;
            }

            if zscore < 350
                && ((i32::from(zscore) + 26380) as i16) < (self.rng.random16_signed() as i16)
            {
                let value = self.rng.random16() & 1;
                self.do_ind_out(pos, i32::from(tpop), value);
            }
        }
    }

    /// Industrial immigration (`doIndIn`).
    pub fn do_ind_in(&mut self, pos: Position, pop: i32, value: i32) {
        if pop < 4 {
            self.ind_plop(pos, pop, value);
            self.inc_rate_of_growth(pos, 8);
        }
    }

    /// Industrial emigration (`doIndOut`).
    pub fn do_ind_out(&mut self, pos: Position, pop: i32, value: i32) {
        if pop > 1 {
            self.ind_plop(pos, pop - 2, value);
            self.inc_rate_of_growth(pos, -8);
            return;
        }

        if pop == 1 {
            self.zone_plop(pos, INDBASE as i32); // empty industrial zone
            self.inc_rate_of_growth(pos, -8);
        }
    }

    /// Population value of an industrial tile (`getIndZonePop`).
    pub fn get_ind_zone_pop(&self, tile: Tile) -> i16 {
        if tile == INDCLR {
            return 0;
        }

        let cz_den = (((i32::from(tile) - IZB as i32) / 9) % 4) + 1;
        cz_den as i16
    }

    /// Place an industrial zone (`indPlop`).
    pub fn ind_plop(&mut self, pos: Position, den: i32, value: i32) {
        let base = (((value * 4) + den) * 9 + IND1 as i32) as i16;
        self.zone_plop(pos, i32::from(base));
    }

    /// Evaluate an industrial zone (`evalInd`).
    pub fn eval_ind(&self, traf: i32) -> i16 {
        if traf < 0 {
            return -1000;
        }

        0
    }
}

/// Gold tests. `tests/zone_gold.txt` is the output of `reference/gold/zone_gold.cpp`
/// (built by `reference/gold/build-zone-gold.sh`) on `assets/cities/haight.cty`.
/// This module runs the same script and must reproduce it line for line.
/// It lives here, not in `tests/`, because it drives the TEST-only traffic stub
/// (`TEST_TRAFFIC_RESULT`), which is compiled only for unit tests.
#[cfg(test)]
mod gold_tests {
    use super::*;
    use std::fmt::Write;

    const CITY: &[u8] = include_bytes!("../../../assets/cities/haight.cty");
    const EXPECTED: &str = include_str!("../tests/zone_gold.txt");

    /// FNV-1a over the 32-bit little-endian bytes of each value (the C++ `hadd`).
    fn hadd(mut h: u64, v: i64) -> u64 {
        let u = v as u32;
        for b in 0..4 {
            h ^= u64::from((u >> (8 * b)) & 0xff);
            h = h.wrapping_mul(1_099_511_628_211);
        }
        h
    }

    const FNV0: u64 = 1_469_598_103_934_665_603;

    fn tile_hash(s: &Simulation) -> u64 {
        let mut h = FNV0;
        for x in 0..120 {
            for y in 0..100 {
                h = hadd(h, i64::from(s.tile(x, y).unwrap()));
            }
        }
        h
    }

    fn low32(s: &Simulation) -> u64 {
        tile_hash(s) & 0xffff_ffff
    }

    fn map_hash_i16(get: impl Fn(i32, i32) -> i16) -> u64 {
        let mut h = FNV0;
        for x in 0..120 {
            for y in 0..100 {
                h = hadd(h, i64::from(get(x, y)));
            }
        }
        h
    }

    fn cell(s: &Simulation, x: i32, y: i32) -> i32 {
        s.tile(x, y).map_or(-1, i32::from)
    }

    /// Same classification as the C++ harness `category()`.
    fn category(t: i32) -> i32 {
        if t >= RESBASE as i32 && t < HOSPITAL as i32 {
            return 0; // residential
        }
        if t >= COMBASE as i32 && t < INDBASE as i32 {
            return 1; // commercial
        }
        if t >= INDBASE as i32 && t <= PORTBASE as i32 {
            return 2; // industrial
        }
        if (t >= HOSPITAL as i32 && t < COMBASE as i32)
            || (t >= CHURCH1BASE as i32 && t <= CHURCH7LAST as i32)
        {
            return 3; // hospital / church
        }
        -1
    }

    /// The deterministic state of `setup()` in zone_gold.cpp.
    fn setup(s: &mut Simulation) {
        s.rng.seed(2024);
        for x in 0..120 {
            for y in 0..100 {
                s.land_value_map
                    .world_set(x, y, ((x * 7 + y * 13) % 256) as u8);
                s.pollution_density_map
                    .world_set(x, y, ((x * 5 + y * 3 + 40) % 128) as u8);
                s.population_density_map
                    .world_set(x, y, ((x * 3 + y * 17) % 200) as u8);
                s.power_grid_map
                    .world_set(x, y, if (x + y) % 3 != 0 { 1 } else { 0 });
                s.rate_of_growth_map
                    .world_set(x, y, ((x * x + y) % 401 - 200) as i16);
                s.com_rate_map.world_set(x, y, ((x * y) % 256) as i16);
            }
        }
        s.city_time = 5;
        s.powered_zone_count = 0;
        s.unpowered_zone_count = 0;
        s.res_zone_pop = 0;
        s.res_pop = 0;
        s.com_zone_pop = 0;
        s.com_pop = 0;
        s.ind_zone_pop = 0;
        s.ind_pop = 0;
        s.hospital_pop = 0;
        s.church_pop = 0;
        s.res_valve = 300;
        s.com_valve = -200;
        s.ind_valve = 150;
    }

    /// The RAW tile layer of the .cty file (column-major big-endian shorts after
    /// 6*240 + 120 history shorts). `load_cty` also runs the scans of other
    /// modules, which change 807 tiles of this city; the gold script therefore
    /// starts from the raw layer in both languages.
    fn load_raw_tiles(s: &mut Simulation) {
        const TILES_OFFSET: usize = (6 * 240 + 120) * 2;
        assert_eq!(CITY.len(), TILES_OFFSET + 2 * 120 * 100);
        for (i, t) in s.tiles.iter_mut().enumerate() {
            let at = TILES_OFFSET + 2 * i;
            *t = u16::from_be_bytes([CITY[at], CITY[at + 1]]);
        }
    }

    fn run_script() -> String {
        let mut s = Simulation::with_default_size();
        load_raw_tiles(&mut s);
        let mut out = String::new();
        writeln!(out, "loaded tiles={:016x}", tile_hash(&s)).unwrap();

        setup(&mut s);

        // ---- phase 1: do_zone on zone centres found in the loaded map ----
        let mut all: [Vec<(i32, i32, i32)>; 4] = Default::default();
        for x in 0..120 {
            for y in 0..100 {
                let t = i32::from(s.tile(x, y).unwrap());
                if t & i32::from(ZONEBIT) == 0 {
                    continue;
                }
                let c = category(t & i32::from(LOMASK));
                if c >= 0 {
                    all[c as usize].push((x, y, c));
                }
            }
        }
        writeln!(
            out,
            "candidates res={} com={} ind={} hc={}",
            all[0].len(),
            all[1].len(),
            all[2].len(),
            all[3].len()
        )
        .unwrap();

        let quota = [10usize, 8, 7, 5];
        let mut picks: Vec<(i32, i32, i32)> = Vec::new();
        for c in 0..4 {
            let n = all[c].len();
            let k = quota[c].min(n);
            for j in 0..k {
                picks.push(all[c][j * n / k]);
            }
        }

        for (i, &(x, y, cat)) in picks.iter().enumerate() {
            let i = i as i32;
            let nh: i16 = match i % 4 {
                0 => -1,
                1 => 1,
                _ => 0,
            };
            let nc: i16 = match i % 5 {
                0 => -1,
                1 => 1,
                _ => 0,
            };
            s.need_hospital = nh;
            s.need_church = nc;
            let traf: i16 = match i % 3 {
                0 => 1,
                1 => 0,
                _ => -1,
            };
            TEST_TRAFFIC_RESULT.with(|c| c.set(traf));

            let pos = Position::new(x, y);
            let pre = i32::from(s.tile(x, y).unwrap());
            s.do_zone(pos);

            writeln!(
                out,
                "zone {i} at {x},{y} cat={cat} pre={pre} traf={traf} nh={nh} nc={nc}"
            )
            .unwrap();
            write!(out, "  3x3").unwrap();
            for dy in -1..=1 {
                for dx in -1..=1 {
                    write!(out, " {}", cell(&s, x + dx, y + dy)).unwrap();
                }
            }
            out.push('\n');
            let rng = s.rng.random16();
            writeln!(
                out,
                "  pz={} uz={} rz={} rp={} cz={} cp={} iz={} ip={} hp={} chp={} rog={} nh={} nc={} rng={}",
                s.powered_zone_count,
                s.unpowered_zone_count,
                s.res_zone_pop,
                s.res_pop,
                s.com_zone_pop,
                s.com_pop,
                s.ind_zone_pop,
                s.ind_pop,
                s.hospital_pop,
                s.church_pop,
                s.rate_of_growth_map.world_get(x, y),
                s.need_hospital,
                s.need_church,
                rng
            )
            .unwrap();
        }
        // ---- phase 4: 20 repetitions of do_zone over all picked centres ----
        for rep in 0..20i32 {
            for (j, &(x, y, _)) in picks.iter().enumerate() {
                let k = rep + j as i32;
                s.need_hospital = match k % 4 {
                    0 => -1,
                    1 => 1,
                    _ => 0,
                };
                s.need_church = match k % 5 {
                    0 => -1,
                    1 => 1,
                    _ => 0,
                };
                let traf: i16 = match k % 3 {
                    0 => 1,
                    1 => 0,
                    _ => -1,
                };
                TEST_TRAFFIC_RESULT.with(|c| c.set(traf));
                s.do_zone(Position::new(x, y));
            }
            let rng = s.rng.random16();
            writeln!(
                out,
                "rep {rep} tiles={:08x} rog={:08x} pz={} uz={} rz={} rp={} cz={} cp={} iz={} ip={} hp={} chp={} rng={rng}",
                low32(&s),
                map_hash_i16(|x, y| s.rate_of_growth_map.world_get(x, y)) & 0xffff_ffff,
                s.powered_zone_count,
                s.unpowered_zone_count,
                s.res_zone_pop,
                s.res_pop,
                s.com_zone_pop,
                s.com_pop,
                s.ind_zone_pop,
                s.ind_pop,
                s.hospital_pop,
                s.church_pop,
            )
            .unwrap();
        }

        writeln!(
            out,
            "after-phase1 tiles={:016x} rog={:016x} com={:016x}",
            tile_hash(&s),
            map_hash_i16(|x, y| s.rate_of_growth_map.world_get(x, y)),
            map_hash_i16(|x, y| s.com_rate_map.world_get(x, y)),
        )
        .unwrap();

        // ---- phase 2: helper functions, one group of calls per position ----
        // Ten evenly spaced clear lots (eval_lot >= 1, so build_house acts), plus two corners.
        let mut clear: Vec<(i32, i32)> = Vec::new();
        for x in 0..120 {
            for y in 0..100 {
                if s.eval_lot(x, y) >= 1 {
                    clear.push((x, y));
                }
            }
        }
        writeln!(out, "clear lots {}", clear.len()).unwrap();
        let mut p2: Vec<(i32, i32)> = (0..10).map(|j| clear[j * clear.len() / 10]).collect();
        p2.push((0, 0));
        p2.push((119, 99));
        for (i, &(x, y)) in p2.iter().enumerate() {
            let i = i as i32;
            let pos = Position::new(x, y);
            let pop1 = (i * 7) % 42;
            let val = i % 4;

            let b = s.set_zone_power(pos);
            writeln!(
                out,
                "setZonePower {x} {y} -> {} t={:08x}",
                b as i32,
                low32(&s)
            )
            .unwrap();

            let lp = s.get_land_pollution_value(pos);
            writeln!(out, "getLandPollutionValue {x} {y} -> {lp}").unwrap();

            let fp = s.do_free_pop(pos);
            writeln!(out, "doFreePop {x} {y} -> {fp}").unwrap();

            let el = s.eval_lot(x, y);
            writeln!(out, "evalLot {x} {y} -> {el}").unwrap();

            s.build_house(pos, val);
            writeln!(out, "buildHouse {x} {y} v={val} t={:08x}", low32(&s)).unwrap();

            s.do_res_in(pos, pop1, val);
            writeln!(
                out,
                "doResIn {x} {y} p={pop1} v={val} t={:08x} rog={}",
                low32(&s),
                s.rate_of_growth_map.world_get(x, y)
            )
            .unwrap();

            s.do_res_out(pos, pop1, val);
            writeln!(
                out,
                "doResOut {x} {y} p={pop1} v={val} t={:08x} rog={}",
                low32(&s),
                s.rate_of_growth_map.world_get(x, y)
            )
            .unwrap();

            s.do_com_in(pos, pop1 % 6, val);
            writeln!(
                out,
                "doComIn {x} {y} p={} v={val} t={:08x}",
                pop1 % 6,
                low32(&s)
            )
            .unwrap();

            s.do_com_out(pos, pop1 % 6, val);
            writeln!(
                out,
                "doComOut {x} {y} p={} v={val} t={:08x}",
                pop1 % 6,
                low32(&s)
            )
            .unwrap();

            s.do_ind_in(pos, pop1 % 5, val % 2);
            writeln!(
                out,
                "doIndIn {x} {y} p={} v={} t={:08x}",
                pop1 % 5,
                val % 2,
                low32(&s)
            )
            .unwrap();

            s.do_ind_out(pos, pop1 % 5, val % 2);
            writeln!(
                out,
                "doIndOut {x} {y} p={} v={} t={:08x}",
                pop1 % 5,
                val % 2,
                low32(&s)
            )
            .unwrap();

            s.res_plop(pos, pop1 % 4, val);
            writeln!(
                out,
                "resPlop {x} {y} den={} v={val} t={:08x}",
                pop1 % 4,
                low32(&s)
            )
            .unwrap();

            s.com_plop(pos, pop1 % 5, val);
            writeln!(
                out,
                "comPlop {x} {y} den={} v={val} t={:08x}",
                pop1 % 5,
                low32(&s)
            )
            .unwrap();

            s.ind_plop(pos, pop1 % 4, val % 2);
            writeln!(
                out,
                "indPlop {x} {y} den={} v={} t={:08x}",
                pop1 % 4,
                val % 2,
                low32(&s)
            )
            .unwrap();

            let zp = s.zone_plop(pos, RZB as i32 - 4 + 9 * (i % 30));
            writeln!(out, "zonePlop {x} {y} -> {} t={:08x}", zp as i32, low32(&s)).unwrap();

            s.set_smoke(pos, i % 2 == 0);
            writeln!(
                out,
                "setSmoke {x} {y} pw={} t={:08x}",
                (i % 2 == 0) as i32,
                low32(&s)
            )
            .unwrap();

            s.need_hospital = if i % 3 == 0 { 1 } else { 0 };
            s.need_church = if i % 3 == 1 { 1 } else { 0 };
            s.make_hospital(pos);
            let rng = s.rng.random16();
            writeln!(
                out,
                "makeHospital {x} {y} nh={} nc={} t={:08x} rng={rng}",
                s.need_hospital,
                s.need_church,
                low32(&s)
            )
            .unwrap();

            s.inc_rate_of_growth(pos, (i % 5) - 2);
            writeln!(
                out,
                "incRateOfGrowth {x} {y} a={} rog={}",
                (i % 5) - 2,
                s.rate_of_growth_map.world_get(x, y)
            )
            .unwrap();

            let t = (i % 3) - 1;
            writeln!(out, "evalRes {x} {y} t={t} -> {}", s.eval_res(pos, t)).unwrap();
            writeln!(out, "evalCom {x} {y} t={t} -> {}", s.eval_com(pos, t)).unwrap();
            writeln!(out, "evalInd t={t} -> {}", s.eval_ind(t)).unwrap();
        }

        // ---- phase 5: build_house on 200 evenly spaced clear lots ----
        for j in 0..200usize {
            let n = clear.len();
            let (x, y) = clear[j * n / 200];
            s.build_house(Position::new(x, y), (j % 4) as i32);
            if j % 50 == 49 {
                writeln!(out, "bh {j} tiles={:08x}", low32(&s)).unwrap();
            }
        }

        // ---- phase 6: immigration/emigration helpers over every population value ----
        {
            let (x, y) = clear[clear.len() / 3];
            let pos = Position::new(x, y);
            for k in 0..42i32 {
                let v = k % 4;
                s.do_res_out(pos, k, v);
                let a = low32(&s);
                s.do_res_in(pos, k, v);
                let b = low32(&s);
                s.do_com_out(pos, k % 8, v);
                let c = low32(&s);
                s.do_com_in(pos, k % 8, v);
                let d = low32(&s);
                s.do_ind_out(pos, k % 6, v % 2);
                let e = low32(&s);
                s.do_ind_in(pos, k % 6, v % 2);
                let f = low32(&s);
                writeln!(
                    out,
                    "po {k} ro={a:08x} ri={b:08x} co={c:08x} ci={d:08x} io={e:08x} ii={f:08x}"
                )
                .unwrap();
            }
        }

        // ---- phase 3: pure table functions over every tile value ----
        let (mut hr, mut hc, mut hi) = (FNV0, FNV0, FNV0);
        for t in 0..1024u16 {
            hr = hadd(hr, i64::from(s.get_res_zone_pop(t)));
            hc = hadd(hc, i64::from(s.get_com_zone_pop(t)));
            hi = hadd(hi, i64::from(s.get_ind_zone_pop(t)));
        }
        writeln!(out, "getResZonePop hash={hr:016x}").unwrap();
        writeln!(out, "getComZonePop hash={hc:016x}").unwrap();
        writeln!(out, "getIndZonePop hash={hi:016x}").unwrap();

        writeln!(
            out,
            "end tiles={:016x} rog={:016x} com={:016x}",
            tile_hash(&s),
            map_hash_i16(|x, y| s.rate_of_growth_map.world_get(x, y)),
            map_hash_i16(|x, y| s.com_rate_map.world_get(x, y)),
        )
        .unwrap();
        let rng = s.rng.random16();
        writeln!(
            out,
            "end pz={} uz={} rz={} rp={} cz={} cp={} iz={} ip={} hp={} chp={} rng={rng}",
            s.powered_zone_count,
            s.unpowered_zone_count,
            s.res_zone_pop,
            s.res_pop,
            s.com_zone_pop,
            s.com_pop,
            s.ind_zone_pop,
            s.ind_pop,
            s.hospital_pop,
            s.church_pop,
        )
        .unwrap();
        out
    }

    #[test]
    fn zone_script_matches_cpp_gold() {
        let got = run_script();
        let want_lines: Vec<&str> = EXPECTED.lines().collect();
        let got_lines: Vec<&str> = got.lines().collect();
        for (n, (g, w)) in got_lines.iter().zip(want_lines.iter()).enumerate() {
            assert_eq!(g, w, "first mismatch at line {}", n + 1);
        }
        assert_eq!(got_lines.len(), want_lines.len(), "line count differs");
    }
}
