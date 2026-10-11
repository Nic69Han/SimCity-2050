//! Port of `utilities.cpp`: pause/speed/passes, game level, city name and
//! clock, and the option flags. Setters that only flag a pending options
//! update (`mustUpdateOptions`) raise `must_update_options`; the event is sent
//! by `update_options`.
//!
//! Not ported: `makeDollarDecimalStr` (string formatting for a UI, no state).

use crate::events::{Event, Update};
use crate::simulation::{GameLevel, Simulation, COM_VALVE_RANGE, IND_VALVE_RANGE, RES_VALVE_RANGE};

impl Simulation {
    /// Port of `pause`. Calls back even when already paused.
    pub fn pause(&mut self) {
        if !self.sim_paused {
            self.sim_paused_speed = self.sim_speed_meta as i32;
            self.set_speed(0);
            self.sim_paused = true;
        }
        self.push_event(Event::Updated(Update::Paused));
    }

    /// Port of `resume`. Calls back even when not paused.
    pub fn resume(&mut self) {
        if self.sim_paused {
            self.sim_paused = false;
            self.set_speed(self.sim_paused_speed as i16);
        }
        self.push_event(Event::Updated(Update::Paused));
    }

    /// Port of `setSpeed`: the speed is clamped to 0..=3; while paused the
    /// requested speed is remembered and the running speed stays 0.
    pub fn set_speed(&mut self, mut speed: i16) {
        speed = speed.clamp(0, 3);

        self.sim_speed_meta = speed;

        if self.sim_paused {
            self.sim_paused_speed = self.sim_speed_meta as i32;
            speed = 0;
        }

        self.sim_speed = speed;
        self.push_event(Event::Updated(Update::Speed));
    }

    /// Port of `setPasses`.
    pub fn set_passes(&mut self, passes: i32) {
        self.sim_passes = passes;
        self.sim_pass = 0;
        self.push_event(Event::Updated(Update::Passes));
    }

    /// Port of `setGameLevel`.
    pub fn set_game_level(&mut self, level: GameLevel) {
        self.game_level = level;
        self.update_game_level();
    }

    /// Port of `updateGameLevel`: report that a new game level has been set.
    pub fn update_game_level(&mut self) {
        self.push_event(Event::Updated(Update::GameLevel));
    }

    /// Port of `setCityName`: every non-alphanumeric character becomes `_`.
    pub fn set_city_name(&mut self, name: &str) {
        // The C++ works on bytes with `isalnum`, which is ASCII-only here.
        let clean: Vec<u8> = name
            .bytes()
            .map(|b| if b.is_ascii_alphanumeric() { b } else { b'_' })
            .collect();
        // Only ASCII bytes were kept, so this is valid UTF-8.
        let clean = String::from_utf8(clean).expect("ASCII only");
        self.set_clean_city_name(&clean);
    }

    /// Port of `setCleanCityName`.
    pub fn set_clean_city_name(&mut self, name: &str) {
        self.city_name = name.to_string();
        self.push_event(Event::Updated(Update::CityName));
    }

    /// Port of `setYear`: move the clock so that the city is in `year`.
    /// A year before the starting year is raised to it.
    pub fn set_year(&mut self, mut year: i32) {
        if year < self.starting_year as i32 {
            year = self.starting_year as i32;
        }
        // The C++ assigns a `Quad` expression to an `int`: truncate to 32 bits.
        let delta = ((year as i64) - (self.starting_year as i64) - (self.city_time / 48)) as i32;
        self.city_time += delta.wrapping_mul(48) as i64;
        self.do_time_stuff();
    }

    /// Port of `currentYear`.
    pub fn current_year(&self) -> i32 {
        ((self.city_time / 48) + self.starting_year as i64) as i32
    }

    /// Port of `doNewGame`: the front-end starts a new game.
    pub fn do_new_game(&mut self) {
        self.push_event(Event::NewGame);
    }

    /// Port of `setEnableDisasters`.
    pub fn set_enable_disasters(&mut self, value: bool) {
        self.enable_disasters = value;
        self.must_update_options = true;
    }

    /// Port of `setAutoBudget`.
    pub fn set_auto_budget(&mut self, value: bool) {
        self.auto_budget = value;
        self.must_update_options = true;
    }

    /// Port of `setAutoBulldoze`.
    pub fn set_auto_bulldoze(&mut self, value: bool) {
        self.auto_bulldoze = value;
        self.must_update_options = true;
    }

    /// Port of `setAutoGoto`.
    pub fn set_auto_goto(&mut self, value: bool) {
        self.auto_goto = value;
        self.must_update_options = true;
    }

    /// Port of `setEnableSound`.
    pub fn set_enable_sound(&mut self, value: bool) {
        self.enable_sound = value;
        self.must_update_options = true;
    }

    /// Port of `setDoAnimation`.
    pub fn set_do_animation(&mut self, value: bool) {
        self.do_animation = value;
        self.must_update_options = true;
    }

    /// Port of `setDoMessages`.
    pub fn set_do_messages(&mut self, value: bool) {
        self.do_messages = value;
        self.must_update_options = true;
    }

    /// Port of `setDoNotices`.
    pub fn set_do_notices(&mut self, value: bool) {
        self.do_notices = value;
        self.must_update_options = true;
    }

    /// Port of `getDemands`: residential, commercial and industrial demand,
    /// from -1 (lowest) to 1 (highest).
    pub fn get_demands(&self) -> (f32, f32, f32) {
        (
            self.res_valve as f32 / RES_VALVE_RANGE as f32,
            self.com_valve as f32 / COM_VALVE_RANGE as f32,
            self.ind_valve as f32 / IND_VALVE_RANGE as f32,
        )
    }
}
