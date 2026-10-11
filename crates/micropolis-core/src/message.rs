//! Port of `message.cpp`: the player messages, city-class and scenario checks.
//!
//! Messages become [`Event::Message`]; sounds [`Event::Sound`] (only when
//! sound is enabled, as in `makeSound`).

use crate::events::Event;
use crate::simulation::{
    CityClass, Scenario, Simulation, MAX_FIRE_STATION_EFFECT, MAX_POLICE_STATION_EFFECT,
    MAX_ROAD_EFFECT, NOWHERE,
};

// `MessageNumber` from `text.h`. The values are part of the front-end
// protocol, so they are kept exactly.
pub const MESSAGE_NEED_MORE_RESIDENTIAL: i16 = 1;
pub const MESSAGE_NEED_MORE_COMMERCIAL: i16 = 2;
pub const MESSAGE_NEED_MORE_INDUSTRIAL: i16 = 3;
pub const MESSAGE_NEED_MORE_ROADS: i16 = 4;
pub const MESSAGE_NEED_MORE_RAILS: i16 = 5;
pub const MESSAGE_NEED_ELECTRICITY: i16 = 6;
pub const MESSAGE_NEED_STADIUM: i16 = 7;
pub const MESSAGE_NEED_SEAPORT: i16 = 8;
pub const MESSAGE_NEED_AIRPORT: i16 = 9;
pub const MESSAGE_HIGH_POLLUTION: i16 = 10;
pub const MESSAGE_HIGH_CRIME: i16 = 11;
pub const MESSAGE_TRAFFIC_JAMS: i16 = 12;
pub const MESSAGE_NEED_FIRE_STATION: i16 = 13;
pub const MESSAGE_NEED_POLICE_STATION: i16 = 14;
pub const MESSAGE_BLACKOUTS_REPORTED: i16 = 15;
pub const MESSAGE_TAX_TOO_HIGH: i16 = 16;
pub const MESSAGE_ROAD_NEEDS_FUNDING: i16 = 17;
pub const MESSAGE_FIRE_STATION_NEEDS_FUNDING: i16 = 18;
pub const MESSAGE_POLICE_NEEDS_FUNDING: i16 = 19;
pub const MESSAGE_FIRE_REPORTED: i16 = 20;
pub const MESSAGE_MONSTER_SIGHTED: i16 = 21;
pub const MESSAGE_TORNADO_SIGHTED: i16 = 22;
pub const MESSAGE_EARTHQUAKE: i16 = 23;
pub const MESSAGE_PLANE_CRASHED: i16 = 24;
pub const MESSAGE_SHIP_CRASHED: i16 = 25;
pub const MESSAGE_TRAIN_CRASHED: i16 = 26;
pub const MESSAGE_HELICOPTER_CRASHED: i16 = 27;
pub const MESSAGE_HIGH_UNEMPLOYMENT: i16 = 28;
pub const MESSAGE_NO_MONEY: i16 = 29;
pub const MESSAGE_FIREBOMBING: i16 = 30;
pub const MESSAGE_NEED_MORE_PARKS: i16 = 31;
pub const MESSAGE_EXPLOSION_REPORTED: i16 = 32;
pub const MESSAGE_NOT_ENOUGH_FUNDS: i16 = 33;
pub const MESSAGE_BULLDOZE_AREA_FIRST: i16 = 34;
pub const MESSAGE_REACHED_TOWN: i16 = 35;
pub const MESSAGE_REACHED_CITY: i16 = 36;
pub const MESSAGE_REACHED_CAPITAL: i16 = 37;
pub const MESSAGE_REACHED_METROPOLIS: i16 = 38;
pub const MESSAGE_REACHED_MEGALOPOLIS: i16 = 39;
pub const MESSAGE_NOT_ENOUGH_POWER: i16 = 40;
pub const MESSAGE_HEAVY_TRAFFIC: i16 = 41;
pub const MESSAGE_FLOODING_REPORTED: i16 = 42;
pub const MESSAGE_NUCLEAR_MELTDOWN: i16 = 43;
pub const MESSAGE_RIOTS_REPORTED: i16 = 44;
pub const MESSAGE_STARTED_NEW_CITY: i16 = 45;
pub const MESSAGE_LOADED_SAVED_CITY: i16 = 46;
pub const MESSAGE_SCENARIO_WON: i16 = 47;
pub const MESSAGE_SCENARIO_LOST: i16 = 48;
pub const MESSAGE_ABOUT_MICROPOLIS: i16 = 49;
pub const MESSAGE_SCENARIO_DULLSVILLE: i16 = 50;
pub const MESSAGE_SCENARIO_SAN_FRANCISCO: i16 = 51;
pub const MESSAGE_SCENARIO_HAMBURG: i16 = 52;
pub const MESSAGE_SCENARIO_BERN: i16 = 53;
pub const MESSAGE_SCENARIO_TOKYO: i16 = 54;
pub const MESSAGE_SCENARIO_DETROIT: i16 = 55;
pub const MESSAGE_SCENARIO_BOSTON: i16 = 56;
pub const MESSAGE_SCENARIO_RIO_DE_JANEIRO: i16 = 57;
pub const MESSAGE_LAST: i16 = 57;

/// `CC_METROPOLIS` as a numeric class (`CityClass` has no ordering).
const CC_METROPOLIS: u8 = CityClass::Metropolis as u8;

impl Simulation {
    /// Port of `sendMessages`: check progress of the player and send the
    /// messages due at this point of the city's 64-step cycle.
    pub fn send_messages(&mut self) {
        // Running a scenario, and waiting for it to 'end' so we can give a score.
        if (self.scenario as u8) > 0 && (self.score_type as u8) > 0 && self.score_wait > 0 {
            self.score_wait -= 1;
            if self.score_wait == 0 {
                self.do_scenario_score(self.score_type);
            }
        }

        self.check_growth();

        // `short` arithmetic in C++; the sums are stored back as shorts.
        self.total_zone_pop = self
            .res_zone_pop
            .wrapping_add(self.com_zone_pop)
            .wrapping_add(self.ind_zone_pop);
        let power_pop = self.nuclear_power_pop.wrapping_add(self.coal_power_pop) as i32;
        let tz = self.total_zone_pop as i32;
        let no = NOWHERE as i16;

        match self.city_time & 63 {
            1 => {
                if tz / 4 >= self.res_zone_pop as i32 {
                    self.send_message(MESSAGE_NEED_MORE_RESIDENTIAL, no, no, false, false);
                }
            }
            5 => {
                if tz / 8 >= self.com_zone_pop as i32 {
                    self.send_message(MESSAGE_NEED_MORE_COMMERCIAL, no, no, false, false);
                }
            }
            10 => {
                if tz / 8 >= self.ind_zone_pop as i32 {
                    self.send_message(MESSAGE_NEED_MORE_INDUSTRIAL, no, no, false, false);
                }
            }
            14 => {
                if tz > 10 && tz * 2 > self.road_total as i32 {
                    self.send_message(MESSAGE_NEED_MORE_ROADS, no, no, false, false);
                }
            }
            18 => {
                if tz > 50 && tz > self.rail_total as i32 {
                    self.send_message(MESSAGE_NEED_MORE_RAILS, no, no, false, false);
                }
            }
            22 => {
                if tz > 10 && power_pop == 0 {
                    self.send_message(MESSAGE_NEED_ELECTRICITY, no, no, false, false);
                }
            }
            26 => {
                if self.res_pop > 500 && self.stadium_pop == 0 {
                    self.send_message(MESSAGE_NEED_STADIUM, no, no, false, false);
                    self.res_cap = true;
                } else {
                    self.res_cap = false;
                }
            }
            28 => {
                if self.ind_pop > 70 && self.seaport_pop == 0 {
                    self.send_message(MESSAGE_NEED_SEAPORT, no, no, false, false);
                    self.ind_cap = true;
                } else {
                    self.ind_cap = false;
                }
            }
            30 => {
                if self.com_pop > 100 && self.airport_pop == 0 {
                    self.send_message(MESSAGE_NEED_AIRPORT, no, no, false, false);
                    self.com_cap = true;
                } else {
                    self.com_cap = false;
                }
            }
            32 => {
                // Decrease score for unpowered zones.
                let tm = (self.unpowered_zone_count as i32 + self.powered_zone_count as i32) as f32;
                let ratio = ((self.powered_zone_count as i32 as f32) / tm) as f64;
                if tm > 0.0 && ratio < 0.7 {
                    self.send_message(MESSAGE_BLACKOUTS_REPORTED, no, no, false, false);
                }
            }
            35 => {
                if self.pollution_average > 60 {
                    self.send_message(MESSAGE_HIGH_POLLUTION, -1, -1, true, false);
                }
            }
            42 => {
                if self.crime_average > 100 {
                    self.send_message(MESSAGE_HIGH_CRIME, -1, -1, true, false);
                }
            }
            45 => {
                if self.total_pop > 60 && self.fire_station_pop == 0 {
                    self.send_message(MESSAGE_NEED_FIRE_STATION, no, no, false, false);
                }
            }
            48 => {
                if self.total_pop > 60 && self.police_station_pop == 0 {
                    self.send_message(MESSAGE_NEED_POLICE_STATION, no, no, false, false);
                }
            }
            51 => {
                if self.city_tax > 12 {
                    self.send_message(MESSAGE_TAX_TOO_HIGH, no, no, false, false);
                }
            }
            54 => {
                // If roadEffect < 5/8 of max effect.
                if (self.road_effect as i64) < (5 * MAX_ROAD_EFFECT as i64 / 8)
                    && self.road_total > 30
                {
                    self.send_message(MESSAGE_ROAD_NEEDS_FUNDING, no, no, false, false);
                }
            }
            57 => {
                // If fireEffect < 0.7 of max effect.
                if (self.fire_effect as i64) < (7 * MAX_FIRE_STATION_EFFECT as i64 / 10)
                    && self.total_pop > 20
                {
                    self.send_message(MESSAGE_FIRE_STATION_NEEDS_FUNDING, no, no, false, false);
                }
            }
            60 => {
                // If policeEffect < 0.7 of max effect.
                if (self.police_effect as i64) < (7 * MAX_POLICE_STATION_EFFECT as i64 / 10)
                    && self.total_pop > 20
                {
                    self.send_message(MESSAGE_POLICE_NEEDS_FUNDING, no, no, false, false);
                }
            }
            63 if self.traffic_average > 60 => {
                self.send_message(MESSAGE_TRAFFIC_JAMS, -1, -1, true, false);
            }
            _ => {}
        }
    }

    /// Port of `checkGrowth`: announce when the city reaches a new class.
    /// Runs every 4th city time.
    pub fn check_growth(&mut self) {
        if self.city_time & 3 != 0 {
            return;
        }
        let mut category: i16 = 0;
        let this_city_pop = self.get_population();

        if self.city_pop_last > 0 {
            let last_class = self.get_city_class(self.city_pop_last);
            let new_class = self.get_city_class(this_city_pop);

            if last_class != new_class {
                // Switched class: find the appropriate message.
                category = match new_class {
                    CityClass::Village => 0, // Don't mention it.
                    CityClass::Town => MESSAGE_REACHED_TOWN,
                    CityClass::City => MESSAGE_REACHED_CITY,
                    CityClass::Capital => MESSAGE_REACHED_CAPITAL,
                    CityClass::Metropolis => MESSAGE_REACHED_METROPOLIS,
                    CityClass::Megalopolis => MESSAGE_REACHED_MEGALOPOLIS,
                };
            }
        }

        if category > 0 && category != self.category_last {
            let no = NOWHERE as i16;
            self.send_message(category, no, no, true, false);
            self.category_last = category;
        }

        self.city_pop_last = this_city_pop;
    }

    /// Port of `doScenarioScore`: the outcome of a scenario, and the loss
    /// notification when it was lost. `ty` must not be `Scenario::None`.
    pub fn do_scenario_score(&mut self, ty: Scenario) {
        let won = match ty {
            Scenario::Dullsville | Scenario::SanFrancisco | Scenario::Hamburg => {
                self.city_class as u8 >= CC_METROPOLIS
            }
            Scenario::Bern => self.traffic_average < 80,
            Scenario::Tokyo => self.city_score > 500,
            Scenario::Detroit => self.crime_average < 60,
            Scenario::Boston => self.city_score > 500,
            Scenario::Rio => self.city_score > 500,
            Scenario::None => unreachable!("doScenarioScore called without a scenario"),
        };
        let z = if won {
            MESSAGE_SCENARIO_WON
        } else {
            MESSAGE_SCENARIO_LOST
        };
        let no = NOWHERE as i16;
        self.send_message(z, no, no, true, true);

        if !won {
            self.do_lose_game();
        }
    }

    /// Port of `sendMessage`: a message about an event at `(x, y)`
    /// (`-1` for none).
    pub fn send_message(&mut self, number: i16, x: i16, y: i16, picture: bool, important: bool) {
        self.push_event(Event::Message {
            number,
            x,
            y,
            picture,
            important,
        });
    }

    /// Port of `doMakeSound`: sounds for a message, drawing on the random
    /// generator exactly as the original does (traffic jams use up to three
    /// draws).
    pub fn do_make_sound(&mut self, mesg_num: i32, x: i32, y: i32) {
        match mesg_num as i16 {
            MESSAGE_TRAFFIC_JAMS => {
                if self.rng.random(5) == 1 {
                    self.make_sound("city", "HonkHonkMed", x, y);
                } else if self.rng.random(5) == 1 {
                    self.make_sound("city", "HonkHonkLow", x, y);
                } else if self.rng.random(5) == 1 {
                    self.make_sound("city", "HonkHonkHigh", x, y);
                }
            }
            MESSAGE_HIGH_CRIME
            | MESSAGE_FIRE_REPORTED
            | MESSAGE_TORNADO_SIGHTED
            | MESSAGE_EARTHQUAKE
            | MESSAGE_PLANE_CRASHED
            | MESSAGE_SHIP_CRASHED
            | MESSAGE_TRAIN_CRASHED
            | MESSAGE_HELICOPTER_CRASHED => {
                self.make_sound("city", "Siren", x, y);
            }
            MESSAGE_MONSTER_SIGHTED => {
                self.make_sound("city", "Monster", x, y);
            }
            MESSAGE_FIREBOMBING => {
                self.make_sound("city", "ExplosionLow", x, y);
                self.make_sound("city", "Siren", x, y);
            }
            MESSAGE_NUCLEAR_MELTDOWN => {
                self.make_sound("city", "ExplosionHigh", x, y);
                self.make_sound("city", "ExplosionLow", x, y);
                self.make_sound("city", "Siren", x, y);
            }
            MESSAGE_RIOTS_REPORTED => {
                self.make_sound("city", "Siren", x, y);
            }
            _ => {}
        }
    }

    /// Port of `doAutoGoto`. The C++ `msg` argument is unused and not kept.
    pub fn do_auto_goto(&mut self, x: i16, y: i16) {
        self.push_event(Event::AutoGoto { x, y });
    }

    /// Port of `doLoseGame`.
    pub fn do_lose_game(&mut self) {
        self.push_event(Event::LoseGame);
    }

    /// Port of `doWinGame`.
    pub fn do_win_game(&mut self) {
        self.push_event(Event::WinGame);
    }
}
