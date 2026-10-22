//! The highways on a [`Simulation`]: the switch, the tools, the layer and the stats the adapter
//! shows, the repair. See the module documentation of [`crate::highways`].

use super::{is_highway_road, HighwayList, HIGHWAY_COST, HIGHWAY_UPKEEP, MAX_HIGHWAY_TILES};
use crate::simulation::Simulation;
use crate::tool::{ToolPreview, ToolResult};

/// Numbers of [`Simulation::highway_stats`].
pub const STATS_SIZE: usize = 2;

impl Simulation {
    /// Whether the highway rules are on (off by default: the engine is the original).
    pub fn highway_rules(&self) -> bool {
        self.extensions().highways
    }

    /// Turns the highway rules on or off. Off takes up every highway, without refund.
    pub fn set_highway_rules(&mut self, on: bool) {
        let ext = self.extensions_mut();
        ext.highways = on;
        if !on {
            ext.highway_list = HighwayList::default();
        }
    }

    /// Forgets the highways of a rule that is off and those whose road is gone (a loaded file).
    pub(crate) fn repair_highways(&mut self) {
        if !self.highway_rules() {
            self.extensions_mut().highway_list = HighwayList::default();
            return;
        }
        if self.extensions().highway_list.is_empty() {
            return;
        }
        let mut list = std::mem::take(&mut self.extensions_mut().highway_list);
        list.retain(|x, y| self.tile(x, y).is_some_and(is_highway_road));
        self.extensions_mut().highway_list = list;
    }

    /// What `place_highway` would answer, and the cost. `Failed`: rule off, off the map, not a
    /// classic road (a bridge and a rail crossing are not), already a highway, or
    /// [`MAX_HIGHWAY_TILES`] reached. `NoMoney`: the funds do not cover [`HIGHWAY_COST`].
    fn plan_highway(&self, x: i32, y: i32) -> ToolResult {
        let list = &self.extensions().highway_list;
        let road = self.tile(x, y).is_some_and(is_highway_road);
        if !self.highway_rules() || !road || list.contains(x, y) || list.len() >= MAX_HIGHWAY_TILES
        {
            return ToolResult::Failed;
        }
        if self.total_funds >= i64::from(HIGHWAY_COST) {
            ToolResult::Ok
        } else {
            ToolResult::NoMoney
        }
    }

    /// Dry run of [`place_highway`](Self::place_highway); the cost is 0 unless the result is `Ok`.
    pub fn highway_preview(&self, x: i32, y: i32) -> ToolPreview {
        let result = self.plan_highway(x, y);
        ToolPreview {
            result,
            cost: if result == ToolResult::Ok {
                HIGHWAY_COST
            } else {
                0
            },
        }
    }

    /// Lays a highway on the road at `(x, y)` for [`HIGHWAY_COST`] (see `plan_highway` for the
    /// refusals).
    pub fn place_highway(&mut self, x: i32, y: i32) -> ToolResult {
        let result = self.plan_highway(x, y);
        if result == ToolResult::Ok {
            self.spend(HIGHWAY_COST);
            self.extensions_mut().highway_list.insert(x, y);
        }
        self.report_refusal(result, x, y);
        result
    }

    /// Takes up the highway at `(x, y)`, free of charge; the road stays. `Failed` when there is
    /// none or the rule is off.
    pub fn remove_highway(&mut self, x: i32, y: i32) -> ToolResult {
        if self.highway_rules() && self.extensions_mut().highway_list.remove(x, y) {
            ToolResult::Ok
        } else {
            ToolResult::Failed
        }
    }

    /// Whether tile `(x, y)` is a highway tile (false while the rule is off).
    pub fn is_highway(&self, x: i32, y: i32) -> bool {
        self.highway_rules() && self.extensions().highway_list.contains(x, y)
    }

    /// One byte per tile in tile order (`x * height + y`): 1 on a highway, 0 elsewhere. All 0
    /// while the rule is off.
    pub fn highway_layer(&self) -> Vec<u8> {
        let (_, h) = self.world_size();
        let mut out = vec![0; self.tiles.len()];
        if self.highway_rules() {
            for &(x, y) in self.extensions().highway_list.as_slice() {
                if let Some(cell) = out.get_mut(usize::from(x) * h as usize + usize::from(y)) {
                    *cell = 1;
                }
            }
        }
        out
    }

    /// `[tiles, yearly upkeep]`; both 0 while the rule is off.
    pub fn highway_stats(&self) -> [i32; STATS_SIZE] {
        if !self.highway_rules() {
            return [0; STATS_SIZE];
        }
        let tiles = self.extensions().highway_list.len() as i32;
        [tiles, tiles * HIGHWAY_UPKEEP]
    }

    /// The agents' view: one flag per tile (tile order), empty while no highway acts.
    pub(crate) fn highway_flags(&self) -> Vec<bool> {
        if !self.highway_rules() || self.extensions().highway_list.is_empty() {
            return Vec::new();
        }
        let (_, h) = self.world_size();
        let mut out = vec![false; self.tiles.len()];
        for &(x, y) in self.extensions().highway_list.as_slice() {
            if let Some(cell) = out.get_mut(usize::from(x) * h as usize + usize::from(y)) {
                *cell = true;
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile::{HBRIDGE, HRAILROAD, ROADS};

    fn city() -> Simulation {
        let mut s = Simulation::new(40, 30);
        for x in 5..15 {
            s.set_tile(x, 10, ROADS);
        }
        s.set_tile(15, 10, HBRIDGE);
        s.set_tile(16, 10, HRAILROAD);
        s.total_funds = 1000;
        s
    }

    #[test]
    fn everything_is_refused_while_the_rule_is_off() {
        let mut s = city();
        assert_eq!(s.place_highway(5, 10), ToolResult::Failed);
        assert_eq!(s.highway_preview(5, 10).cost, 0);
        assert_eq!(s.remove_highway(5, 10), ToolResult::Failed);
        assert_eq!(s.highway_stats(), [0; STATS_SIZE]);
        assert!(s.highway_layer().iter().all(|&b| b == 0));
        assert_eq!(s.total_funds, 1000);
        assert!(!s.extensions_active());
    }

    #[test]
    fn a_highway_is_laid_on_a_road_for_its_cost() {
        let mut s = city();
        s.set_highway_rules(true);
        let p = s.highway_preview(6, 10);
        assert_eq!((p.result, p.cost), (ToolResult::Ok, HIGHWAY_COST));
        assert_eq!(s.place_highway(6, 10), ToolResult::Ok);
        assert_eq!(s.total_funds, 1000 - i64::from(HIGHWAY_COST));
        assert!(s.is_highway(6, 10) && !s.is_highway(7, 10));
        assert_eq!(s.highway_stats(), [1, HIGHWAY_UPKEEP]);
        let (_, h) = s.world_size();
        let layer = s.highway_layer();
        assert_eq!(layer[(6 * h + 10) as usize], 1);
        assert_eq!(layer.iter().filter(|&&b| b == 1).count(), 1);
    }

    #[test]
    fn refusals_leave_the_city_untouched() {
        let mut s = city();
        s.set_highway_rules(true);
        assert_eq!(s.place_highway(6, 10), ToolResult::Ok);
        let funds = s.total_funds;
        for (x, y) in [(6, 10), (15, 10), (16, 10), (20, 20), (-1, 3), (99, 99)] {
            assert_eq!(s.place_highway(x, y), ToolResult::Failed, "{x},{y}");
            assert_eq!(s.highway_preview(x, y).cost, 0);
        }
        s.total_funds = i64::from(HIGHWAY_COST) - 1;
        assert_eq!(s.highway_preview(7, 10).result, ToolResult::NoMoney);
        assert_eq!(s.place_highway(7, 10), ToolResult::NoMoney);
        assert_eq!(s.highway_stats()[0], 1);
        s.total_funds = funds;
        assert_eq!(s.remove_highway(7, 10), ToolResult::Failed, "none there");
        assert_eq!(s.remove_highway(6, 10), ToolResult::Ok);
        assert_eq!(s.total_funds, funds, "removing is free");
    }

    #[test]
    fn the_cap_refuses_and_turning_the_rule_off_clears() {
        let mut s = Simulation::new(100, 100);
        for x in 0..100 {
            for y in 0..42 {
                s.set_tile(x, y, ROADS);
            }
        }
        s.total_funds = 10_000_000;
        s.set_highway_rules(true);
        let mut placed = 0;
        for x in 0..100 {
            for y in 0..42 {
                if s.place_highway(x, y) == ToolResult::Ok {
                    placed += 1;
                }
            }
        }
        assert_eq!(placed, MAX_HIGHWAY_TILES);
        assert_eq!(s.highway_preview(99, 41).result, ToolResult::Failed);
        s.set_highway_rules(false);
        assert_eq!(s.highway_stats(), [0; STATS_SIZE]);
        assert!(s.extensions().highway_list.is_empty());
    }

    #[test]
    fn a_vanished_road_takes_its_highway_with_it() {
        let mut s = city();
        s.set_highway_rules(true);
        s.place_highway(6, 10);
        s.place_highway(7, 10);
        s.set_tile(6, 10, 0);
        s.repair_highways();
        assert!(!s.is_highway(6, 10) && s.is_highway(7, 10));
        s.set_tile(6, 10, ROADS);
        s.repair_highways();
        assert!(
            !s.is_highway(6, 10),
            "rebuilding the road does not bring it back"
        );
    }
}
