//! Port of `update.cpp`: deferred display updates.
//!
//! The C++ `callback("update", ...)` calls become [`Event`]s. Flags such as
//! `mustUpdateFunds` / `mustUpdateOptions` keep their meaning: setters only
//! raise a flag, and the event is emitted when the flag is flushed.

use crate::events::{Event, Update};
use crate::message::MESSAGE_NOT_ENOUGH_POWER;
use crate::simulation::{Simulation, NOWHERE};

/// Largest year before the date is wrapped back (`megalinium`).
const MEGALINIUM: i64 = 1_000_000;

impl Simulation {
    /// Port of `doUpdateHeads`.
    pub fn do_update_heads(&mut self) {
        self.show_valves();
        self.do_time_stuff();
        self.really_update_funds();
        self.update_options();
    }

    /// Port of `updateMaps`.
    pub fn update_maps(&mut self) {
        self.invalidate_maps();
        self.do_update_heads();
    }

    /// Port of `updateGraphs`.
    pub fn update_graphs(&mut self) {
        self.change_census();
    }

    /// Port of `updateEvaluation`.
    pub fn update_evaluation(&mut self) {
        self.change_eval();
    }

    /// Port of `updateHeads`: force every display to be redrawn.
    pub fn update_heads(&mut self) {
        self.must_update_funds = true;
        self.valve_flag = true;
        self.city_time_last = -999_999;
        self.city_year_last = -999_999;
        self.city_month_last = -999_999;
        self.total_funds_last = -999_999;
        self.res_last = -999_999;
        self.com_last = -999_999;
        self.ind_last = -999_999;
        self.do_update_heads();
    }

    /// Port of `updateFunds`: the funds display is out of date.
    pub fn update_funds(&mut self) {
        self.must_update_funds = true;
    }

    /// Port of `reallyUpdateFunds`.
    pub fn really_update_funds(&mut self) {
        if !self.must_update_funds {
            return;
        }
        self.must_update_funds = false;
        if self.total_funds != self.total_funds_last {
            self.total_funds_last = self.total_funds;
            self.push_event(Event::FundsChanged(self.total_funds));
        }
    }

    /// Port of `doTimeStuff`.
    pub fn do_time_stuff(&mut self) {
        self.update_date();
    }

    /// Port of `updateDate`.
    pub fn update_date(&mut self) {
        self.city_time_last = self.city_time >> 2;

        // C++ computes these in `int`, hence the truncation to i32.
        let t = self.city_time as i32;
        self.city_year = ((t / 48) + self.starting_year as i32) as i64;
        self.city_month = ((t % 48) >> 2) as i64;

        if self.city_year >= MEGALINIUM {
            self.set_year(self.starting_year as i32);
            self.city_year = self.starting_year as i64;
            self.send_message(
                MESSAGE_NOT_ENOUGH_POWER,
                NOWHERE as i16,
                NOWHERE as i16,
                true,
                false,
            );
        }

        if self.city_year_last != self.city_year || self.city_month_last != self.city_month {
            self.city_year_last = self.city_year;
            self.city_month_last = self.city_month;
            self.push_event(Event::Updated(Update::Date));
        }
    }

    /// Port of `showValves`.
    pub fn show_valves(&mut self) {
        if self.valve_flag {
            self.draw_valve();
            self.valve_flag = false;
        }
    }

    /// Port of `drawValve`: clamp the valves to +-1500 and report the demand
    /// when any of them changed since the last report.
    pub fn draw_valve(&mut self) {
        // The original clamps to a literal +-1500 here (not to the valve ranges).
        let clamp = |v: i16| (v as f32).clamp(-1500.0, 1500.0);
        let r = clamp(self.res_valve);
        let c = clamp(self.com_valve);
        let i = clamp(self.ind_valve);

        if r != self.res_last as f32 || c != self.com_last as f32 || i != self.ind_last as f32 {
            self.res_last = r as i64;
            self.com_last = c as i64;
            self.ind_last = i as i64;
            self.set_demand(r, c, i);
        }
    }

    /// Port of `setDemand`: the front-end reads the demands with `get_demands`.
    pub fn set_demand(&mut self, _r: f32, _c: f32, _i: f32) {
        self.push_event(Event::Updated(Update::Demand));
    }

    /// Port of `updateOptions`: flush a pending options change.
    pub fn update_options(&mut self) {
        if self.must_update_options {
            self.must_update_options = false;
            self.push_event(Event::OptionsChanged);
        }
    }

    /// Port of `updateUserInterface`. The original body is only a list of
    /// TODO comments, so nothing happens here either.
    pub fn update_user_interface(&mut self) {}
}
