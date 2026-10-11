//! Port of `graph.cpp`, except `initGraphMax` (in `simulation.rs`).
//!
//! `drawMonth` (copies history into a byte buffer for a UI) and the commented
//! out name/colour tables are presentation only and are not ported.

use crate::events::{Event, Update};
use crate::simulation::{Simulation, HISTORY_LEN};

/// `HistoryType` values from `micropolis.h`.
pub const HISTORY_TYPE_RES: i32 = 0;
pub const HISTORY_TYPE_COM: i32 = 1;
pub const HISTORY_TYPE_IND: i32 = 2;
pub const HISTORY_TYPE_MONEY: i32 = 3;
pub const HISTORY_TYPE_CRIME: i32 = 4;
pub const HISTORY_TYPE_POLLUTION: i32 = 5;
pub const HISTORY_TYPE_COUNT: i32 = 6;

/// `HistoryScale` values from `micropolis.h`.
pub const HISTORY_SCALE_SHORT: i32 = 0;
pub const HISTORY_SCALE_LONG: i32 = 1;
pub const HISTORY_SCALE_COUNT: i32 = 2;

/// Number of values in one graph window (`HISTORY_COUNT`).
pub const HISTORY_COUNT: i32 = 120;

impl Simulation {
    /// Set flag that graph data has been changed (`changeCensus`).
    pub fn change_census(&mut self) {
        self.census_changed = true;
    }

    /// If graph data has been changed, notify the front-end once (`graphDoer`).
    pub fn graph_doer(&mut self) {
        if self.census_changed {
            self.push_event(Event::Updated(Update::History));
            self.census_changed = false;
        }
    }

    /// Port of `initGraphs`.
    pub fn init_graphs(&mut self) {
        if !self.history_initialized {
            self.history_initialized = true;
        }
    }

    fn history_vec(&self, history_type: i32) -> Option<&Vec<i16>> {
        match history_type {
            HISTORY_TYPE_RES => Some(&self.res_hist),
            HISTORY_TYPE_COM => Some(&self.com_hist),
            HISTORY_TYPE_IND => Some(&self.ind_hist),
            HISTORY_TYPE_MONEY => Some(&self.money_hist),
            HISTORY_TYPE_CRIME => Some(&self.crime_hist),
            HISTORY_TYPE_POLLUTION => Some(&self.pollution_hist),
            _ => None,
        }
    }

    fn history_vec_mut(&mut self, history_type: i32) -> Option<&mut Vec<i16>> {
        match history_type {
            HISTORY_TYPE_RES => Some(&mut self.res_hist),
            HISTORY_TYPE_COM => Some(&mut self.com_hist),
            HISTORY_TYPE_IND => Some(&mut self.ind_hist),
            HISTORY_TYPE_MONEY => Some(&mut self.money_hist),
            HISTORY_TYPE_CRIME => Some(&mut self.crime_hist),
            HISTORY_TYPE_POLLUTION => Some(&mut self.pollution_hist),
            _ => None,
        }
    }

    /// Offset of the scale's window in the history arrays, or `None` for an
    /// invalid scale (the C++ `NOT_REACHED` case).
    fn history_offset(history_scale: i32) -> Option<usize> {
        match history_scale {
            HISTORY_SCALE_SHORT => Some(0),
            HISTORY_SCALE_LONG => Some(120),
            _ => None,
        }
    }

    /// Port of `getHistoryRange`: `(min, max)` over the window. Invalid
    /// arguments give `(0, 0)`.
    pub fn get_history_range(&self, history_type: i32, history_scale: i32) -> (i16, i16) {
        if !(0..HISTORY_TYPE_COUNT).contains(&history_type)
            || !(0..HISTORY_SCALE_COUNT).contains(&history_scale)
        {
            return (0, 0);
        }
        let (Some(history), Some(offset)) = (
            self.history_vec(history_type),
            Self::history_offset(history_scale),
        ) else {
            return (0, 0);
        };
        let mut min_val: i16 = 32000;
        let mut max_val: i16 = -32000;
        for i in 0..HISTORY_COUNT as usize {
            let val = history[i + offset];
            min_val = min_val.min(val);
            max_val = max_val.max(val);
        }
        (min_val, max_val)
    }

    /// Port of `getHistory`: `0` for invalid arguments.
    pub fn get_history(&self, history_type: i32, history_scale: i32, history_index: i32) -> i16 {
        if !(0..HISTORY_TYPE_COUNT).contains(&history_type)
            || !(0..HISTORY_SCALE_COUNT).contains(&history_scale)
            || !(0..HISTORY_COUNT).contains(&history_index)
        {
            return 0;
        }
        match (
            self.history_vec(history_type),
            Self::history_offset(history_scale),
        ) {
            (Some(h), Some(offset)) => h[history_index as usize + offset],
            _ => 0,
        }
    }

    /// Port of `setHistory`: ignored for invalid arguments.
    pub fn set_history(
        &mut self,
        history_type: i32,
        history_scale: i32,
        history_index: i32,
        history_value: i16,
    ) {
        if !(0..HISTORY_TYPE_COUNT).contains(&history_type)
            || !(0..HISTORY_SCALE_COUNT).contains(&history_scale)
            || !(0..HISTORY_COUNT).contains(&history_index)
        {
            return;
        }
        let Some(offset) = Self::history_offset(history_scale) else {
            return;
        };
        if let Some(h) = self.history_vec_mut(history_type) {
            debug_assert!(history_index as usize + offset < HISTORY_LEN);
            h[history_index as usize + offset] = history_value;
        }
    }
}
