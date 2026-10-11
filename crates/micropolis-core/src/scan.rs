//! Port of `scan.cpp` — see PORTING.md. (Owned by one porting agent.)
//!
//! Map scans: fire/police station coverage smoothing, population density,
//! pollution / terrain / land value, crime rate, city centre and the
//! commercial rate map.

use crate::map::Map;
use crate::position::Position;
use crate::simulation::Simulation;
use crate::tile::{LOMASK, ZONEBIT};
use crate::tile_chars::*;

// Indices into `Simulation::new_map_flags` (`enum MapType` in micropolis.h).
const MAP_TYPE_POPULATION_DENSITY: usize = 6;
const MAP_TYPE_RATE_OF_GROWTH: usize = 7;
const MAP_TYPE_POLLUTION: usize = 9;
const MAP_TYPE_CRIME: usize = 10;
const MAP_TYPE_LAND_VALUE: usize = 11;
const MAP_TYPE_FIRE_RADIUS: usize = 12;
const MAP_TYPE_POLICE_RADIUS: usize = 13;
const MAP_TYPE_DYNAMIC: usize = 14;

/// Smooth a station map (`smoothStationMap`). Reads from a copy of the
/// original, so every cell sees the pre-pass values. `short` arithmetic is
/// reproduced with wrapping `i16` operations.
fn smooth_station_map(map: &mut Map<i16>) {
    let temp = map.clone();
    let (w, h) = temp.size();
    for x in 0..w {
        for y in 0..h {
            let mut edge: i16 = 0;
            if x > 0 {
                edge = edge.wrapping_add(temp.get(x - 1, y));
            }
            if x < w - 1 {
                edge = edge.wrapping_add(temp.get(x + 1, y));
            }
            if y > 0 {
                edge = edge.wrapping_add(temp.get(x, y - 1));
            }
            if y < h - 1 {
                edge = edge.wrapping_add(temp.get(x, y + 1));
            }
            let edge = temp.get(x, y).wrapping_add(edge / 4);
            map.set(x, y, edge / 2);
        }
    }
}

/// Smooth or dither a density map (`smoothDitherMap`).
fn smooth_dither_map(src: &Map<u8>, dest: &mut Map<u8>, dither: bool) {
    let (w, h) = src.size();
    if dither {
        let mut y: i32 = 0;
        let mut z: i32 = 0;
        let mut dir: i32 = 1;
        for x in 0..w {
            while y != h && y != -1 {
                z += i32::from(src.get(if x == 0 { x } else { x - 1 }, y))
                    + i32::from(src.get(if x == w - 1 { x } else { x + 1 }, y))
                    + i32::from(src.get(x, if y == 0 { 0 } else { y - 1 }))
                    + i32::from(src.get(x, if y == h - 1 { y } else { y + 1 }))
                    + i32::from(src.get(x, y));
                dest.set(x, y, (z / 4) as u8);
                z &= 3;
                y += dir;
            }
            dir = -dir;
            y += dir;
        }
    } else {
        for x in 0..w {
            for y in 0..h {
                let mut z: i32 = 0;
                if x > 0 {
                    z += i32::from(src.get(x - 1, y));
                }
                if x < w - 1 {
                    z += i32::from(src.get(x + 1, y));
                }
                if y > 0 {
                    z += i32::from(src.get(x, y - 1));
                }
                if y < h - 1 {
                    z += i32::from(src.get(x, y + 1));
                }
                z = (z + i32::from(src.get(x, y))) >> 2;
                if z > 255 {
                    z = 255;
                }
                dest.set(x, y, z as u8);
            }
        }
    }
}

impl Simulation {
    /// Set a `newMapFlags` entry. The C++ array has `MAP_TYPE_COUNT` = 15
    /// entries; `simulation.rs` currently declares 13, so entries past the end
    /// are dropped here instead of panicking (see the port report).
    fn set_new_map_flag(&mut self, idx: usize) {
        if let Some(flag) = self.new_map_flags.get_mut(idx) {
            *flag = 1;
        }
    }

    /// Make firerate map from firestation map (`fireAnalysis`).
    pub fn fire_analysis(&mut self) {
        smooth_station_map(&mut self.fire_station_map);
        smooth_station_map(&mut self.fire_station_map);
        smooth_station_map(&mut self.fire_station_map);

        self.fire_station_effect_map = self.fire_station_map.clone();

        self.set_new_map_flag(MAP_TYPE_FIRE_RADIUS);
        self.set_new_map_flag(MAP_TYPE_DYNAMIC);
    }

    /// Population density scan (`populationDensityScan`). Sets
    /// `population_density_map`, `com_rate_map`, and the city centre.
    pub fn population_density_scan(&mut self) {
        self.temp_map1.clear();
        let mut xtot: i64 = 0;
        let mut ytot: i64 = 0;
        let mut ztot: i64 = 0;
        let (world_w, world_h) = self.world_size();
        for x in 0..world_w {
            for y in 0..world_h {
                let map_value = self.tile(x, y).unwrap_or(0);
                if map_value & ZONEBIT != 0 {
                    let map_tile = map_value & LOMASK;
                    let mut pop = self.get_population_density(Position::new(x, y), map_tile) * 8;
                    pop = pop.min(254);
                    self.temp_map1.world_set(x, y, pop as u8);
                    xtot += i64::from(x);
                    ytot += i64::from(y);
                    ztot += 1;
                }
            }
        }

        self.do_smooth1(); // tempMap1 -> tempMap2
        self.do_smooth2(); // tempMap2 -> tempMap1
        self.do_smooth1(); // tempMap1 -> tempMap2

        // Copy tempMap2 to populationDensityMap, multiplying by 2 (Byte wraps).
        for (dst, src) in self
            .population_density_map
            .as_mut_slice()
            .iter_mut()
            .zip(self.temp_map2.as_slice().iter())
        {
            *dst = src.wrapping_mul(2);
        }

        self.compute_com_rate_map(); // uses the previous city centre, as in C++

        // Compute new city centre
        if ztot > 0 {
            self.city_center_x = (xtot / ztot) as i16;
            self.city_center_y = (ytot / ztot) as i16;
        } else {
            self.city_center_x = (world_w / 2) as i16;
            self.city_center_y = (world_h / 2) as i16;
        }

        self.set_new_map_flag(MAP_TYPE_POPULATION_DENSITY);
        self.set_new_map_flag(MAP_TYPE_RATE_OF_GROWTH);
        self.set_new_map_flag(MAP_TYPE_DYNAMIC);
    }

    /// Population of a zone tile (`getPopulationDensity`).
    pub fn get_population_density(&self, pos: Position, tile: u16) -> i32 {
        if tile == FREEZ {
            return i32::from(self.do_free_pop(pos));
        }
        if tile < COMBASE {
            return i32::from(self.get_res_zone_pop(tile));
        }
        if tile < INDBASE {
            return i32::from(self.get_com_zone_pop(tile)) * 8;
        }
        if tile < PORTBASE {
            return i32::from(self.get_ind_zone_pop(tile)) * 8;
        }
        0
    }

    /// Pollution, terrain and land value scan (`pollutionTerrainLandValueScan`).
    pub fn pollution_terrain_land_value_scan(&mut self) {
        // tempMap3 is a map of development density, smoothed into terrainMap.
        self.temp_map3.clear();

        let mut lv_tot: i64 = 0;
        let mut lv_num: i64 = 0;
        let (lv_w, lv_h) = self.land_value_map.size();

        for x in 0..lv_w {
            for y in 0..lv_h {
                let mut pollution_level: i32 = 0;
                let mut land_value_flag = false;
                let world_x = x * 2;
                let world_y = y * 2;

                for mx in world_x..=world_x + 1 {
                    for my in world_y..=world_y + 1 {
                        let loc = i32::from(self.tile(mx, my).unwrap_or(0) & LOMASK);
                        if loc != 0 {
                            if loc < i32::from(RUBBLE) {
                                // Increment terrain memory (Byte arithmetic).
                                let value = self.temp_map3.get(x >> 1, y >> 1);
                                self.temp_map3.set(x >> 1, y >> 1, value.wrapping_add(15));
                                continue;
                            }
                            pollution_level += self.get_pollution_value(loc);
                            if loc >= i32::from(ROADBASE) {
                                land_value_flag = true;
                            }
                        }
                    }
                }

                pollution_level = pollution_level.min(255);
                self.temp_map1.set(x, y, pollution_level as u8);

                if land_value_flag {
                    // LandValue equation
                    let mut dis = 34 - self.get_city_center_distance(world_x, world_y) / 2;
                    dis *= 4;
                    dis += i32::from(self.terrain_density_map.get(x >> 1, y >> 1));
                    dis -= i32::from(self.pollution_density_map.get(x, y));
                    if self.crime_rate_map.get(x, y) > 190 {
                        dis -= 20;
                    }
                    dis = dis.clamp(1, 250);
                    self.land_value_map.set(x, y, dis as u8);
                    lv_tot += i64::from(dis);
                    lv_num += 1;
                } else {
                    self.land_value_map.set(x, y, 0);
                }
            }
        }

        self.land_value_average = if lv_num > 0 {
            (lv_tot / lv_num) as i16
        } else {
            0
        };

        self.do_smooth1(); // tempMap1 -> tempMap2
        self.do_smooth2(); // tempMap2 -> tempMap1

        let mut pmax: i32 = 0;
        let mut pnum: i64 = 0;
        let mut ptot: i64 = 0;
        let block = self.pollution_density_map.block_size();
        let (world_w, world_h) = self.world_size();

        let mut x = 0;
        while x < world_w {
            let mut y = 0;
            while y < world_h {
                let z = i32::from(self.temp_map1.world_get(x, y));
                self.pollution_density_map.world_set(x, y, z as u8);

                if z != 0 {
                    // get pollute average
                    pnum += 1;
                    ptot += i64::from(z);
                    // find max pol for monster
                    if z > pmax || (z == pmax && (self.rng.random16() & 3) == 0) {
                        pmax = z;
                        self.pollution_max_x = x as i16;
                        self.pollution_max_y = y as i16;
                    }
                }
                y += block;
            }
            x += block;
        }

        self.pollution_average = if pnum > 0 { (ptot / pnum) as i16 } else { 0 };

        self.smooth_terrain();

        self.set_new_map_flag(MAP_TYPE_POLLUTION);
        self.set_new_map_flag(MAP_TYPE_LAND_VALUE);
        self.set_new_map_flag(MAP_TYPE_DYNAMIC);
    }

    /// Pollution value of a tile character (`getPollutionValue`).
    pub fn get_pollution_value(&self, loc: i32) -> i32 {
        let powerbase = i32::from(POWERBASE);
        if loc < powerbase {
            if loc >= i32::from(HTRFBASE) {
                return 75; // heavy traffic
            }
            if loc >= i32::from(LTRFBASE) {
                return 50; // light traffic
            }
            if loc < i32::from(ROADBASE) {
                if loc > i32::from(FIREBASE) {
                    return 90;
                }
                // C++ comment: "Why negative pollution from radiation?"
                if loc >= i32::from(RADTILE) {
                    return 255; // radioactivity (the C++ -40 is clamped to 255)
                }
            }
            return 0;
        }

        if loc <= i32::from(LASTIND) {
            return 0;
        }
        if loc < i32::from(PORTBASE) {
            return 50; // industrial
        }
        if loc <= i32::from(LASTPOWERPLANT) {
            return 100; // port, airport, power plant
        }
        0
    }

    /// Manhattan distance from a world position to the city centre, capped at 64
    /// (`getCityCenterDistance`).
    pub fn get_city_center_distance(&self, x: i32, y: i32) -> i32 {
        let cx = i32::from(self.city_center_x);
        let cy = i32::from(self.city_center_y);
        let x_dis = (x - cx).abs();
        let y_dis = (y - cy).abs();
        (x_dis + y_dis).min(64)
    }

    /// Smooth the police station map and compute the crime rate (`crimeScan`).
    pub fn crime_scan(&mut self) {
        smooth_station_map(&mut self.police_station_map);
        smooth_station_map(&mut self.police_station_map);
        smooth_station_map(&mut self.police_station_map);

        let mut totz: i64 = 0;
        let mut numz: i64 = 0;
        let mut cmax: i32 = 0;
        let block = self.crime_rate_map.block_size();
        let (world_w, world_h) = self.world_size();

        let mut x = 0;
        while x < world_w {
            let mut y = 0;
            while y < world_h {
                let mut z = i32::from(self.land_value_map.world_get(x, y));
                if z > 0 {
                    numz += 1;
                    z = 128 - z;
                    z += i32::from(self.population_density_map.world_get(x, y));
                    z = z.min(300);
                    z -= i32::from(self.police_station_map.world_get(x, y));
                    z = z.clamp(0, 250);
                    self.crime_rate_map.world_set(x, y, z as u8);
                    totz += i64::from(z);

                    // Update new crime hot-spot
                    if z > cmax || (z == cmax && (self.rng.random16() & 3) == 0) {
                        cmax = z;
                        self.crime_max_x = x as i16;
                        self.crime_max_y = y as i16;
                    }
                } else {
                    self.crime_rate_map.world_set(x, y, 0);
                }
                y += block;
            }
            x += block;
        }

        self.crime_average = if numz > 0 { (totz / numz) as i16 } else { 0 };

        self.police_station_effect_map = self.police_station_map.clone();

        self.set_new_map_flag(MAP_TYPE_CRIME);
        self.set_new_map_flag(MAP_TYPE_POLICE_RADIUS);
        self.set_new_map_flag(MAP_TYPE_DYNAMIC);
    }

    /// Terrain density from `tempMap3` (`smoothTerrain`).
    pub fn smooth_terrain(&mut self) {
        let (tw, th) = self.terrain_density_map.size();
        if self.don_dither & 1 != 0 {
            let mut y: i32 = 0;
            let mut dir: i32 = 1;
            let mut z: u32 = 0;
            for x in 0..tw {
                while y != th && y != -1 {
                    let t3 = |xx: i32, yy: i32| u32::from(self.temp_map3.get(xx, yy));
                    let sum = t3(if x == 0 { x } else { x - 1 }, y)
                        + t3(if x == tw - 1 { x } else { x + 1 }, y)
                        + t3(x, if y == 0 { 0 } else { y - 1 })
                        + t3(x, if y == th - 1 { y } else { y + 1 })
                        + (t3(x, y) << 2);
                    z = z.wrapping_add(sum);
                    let val = (z / 8) as u8;
                    self.terrain_density_map.set(x, y, val);
                    z &= 0x7;
                    y += dir;
                }
                dir = -dir;
                y += dir;
            }
        } else {
            for x in 0..tw {
                for y in 0..th {
                    let mut z: u32 = 0;
                    if x > 0 {
                        z += u32::from(self.temp_map3.get(x - 1, y));
                    }
                    if x < tw - 1 {
                        z += u32::from(self.temp_map3.get(x + 1, y));
                    }
                    if y > 0 {
                        z += u32::from(self.temp_map3.get(x, y - 1));
                    }
                    if y < th - 1 {
                        z += u32::from(self.temp_map3.get(x, y + 1));
                    }
                    // `(Byte)(z / 4 + get) / 2`: the cast happens before the division.
                    let inner = ((z / 4 + u32::from(self.temp_map3.get(x, y))) as u8) / 2;
                    self.terrain_density_map.set(x, y, inner);
                }
            }
        }
    }

    /// `tempMap1` -> `tempMap2` (`doSmooth1`).
    pub fn do_smooth1(&mut self) {
        let dither = self.don_dither & 2 != 0;
        smooth_dither_map(&self.temp_map1, &mut self.temp_map2, dither);
    }

    /// `tempMap2` -> `tempMap1` (`doSmooth2`).
    pub fn do_smooth2(&mut self) {
        let dither = self.don_dither & 4 != 0;
        smooth_dither_map(&self.temp_map2, &mut self.temp_map1, dither);
    }

    /// Distance to the city centre for the whole map (`computeComRateMap`).
    pub fn compute_com_rate_map(&mut self) {
        let (w, h) = self.com_rate_map.size();
        for x in 0..w {
            for y in 0..h {
                let mut z = (self.get_city_center_distance(x * 8, y * 8) / 2) as i16; // 0..32
                z *= 4; // 0..128
                z = 64 - z; // 64..-64
                self.com_rate_map.set(x, y, z);
            }
        }
    }
}
