//! Relief rules (docs/roadmap.md, step 1; docs/3d.md, section 2): the terrain tools and the
//! costs that the relief adds to building. They run only when [`Simulation::relief_rules`] is
//! on. With the rules off nothing here is reached: the engine is the original one, and no
//! random number is drawn.
//!
//! Rules, with `MAX_SLOPE` between 8-neighbours (water included):
//! * [`Simulation::terraform`] raises or lowers one tile by one step. The neighbours that the
//!   step would push past `MAX_SLOPE` are moved too (a cascade). Each tile whose altitude
//!   changed costs [`TERRAFORM_STEP_COST`].
//! * A building tool of size > 1 flattens its footprint to the rounded mean altitude before it
//!   is placed. Each altitude unit moved costs [`LEVEL_STEP_COST`], footprint and cascade alike.
//! * Roads, rails and power lines cost [`SLOPE_STEP_COST`] per altitude unit of range over the
//!   tile and its four orthogonal neighbours. They do not flatten the ground.
//!
//! Immovable tiles. Water is always at sea level, so a slope against water is refused by both
//! terraforming and levelling. A built tile (anything but bare land, trees or rubble) cannot be
//! changed: terraforming then refuses with `NeedBulldoze`. Levelling tolerates a slope against a
//! built tile, a documented simplification: the building is placed on the flat footprint and its
//! neighbours keep their altitude.
//!
//! The changes are collected in [`ToolEffects`] like any tool change, so the preview, the
//! funds check and the commit share one plan: a preview never changes the city.

use std::collections::VecDeque;

use crate::relief::{is_water, MAX_HEIGHT, MAX_SLOPE, SEA_LEVEL};
use crate::simulation::Simulation;
use crate::tile::{Tile, LOMASK};
use crate::tile_chars::{DIRT, LASTRUBBLE, RUBBLE};
use crate::tool::{EditingTool, ToolEffects, ToolPreview, ToolResult};

/// Dollars per tile whose altitude a terraform changed (the target and every cascade tile).
pub const TERRAFORM_STEP_COST: i32 = 10;
/// Dollars per altitude unit moved when a building flattens its footprint (or a cascade moves).
pub const LEVEL_STEP_COST: i32 = 5;
/// Dollars per altitude unit of range under a road, rail or power line.
pub const SLOPE_STEP_COST: i32 = 3;

/// Lowest altitude of land (one above the sea).
const FLOOR: i32 = SEA_LEVEL as i32 + 1;
const MAX: i32 = MAX_HEIGHT as i32;
/// Safety bound on a cascade: each tile can move at most once per altitude unit, so this is
/// never reached on a valid relief. It keeps a malformed relief from looping.
const STEPS_PER_TILE: usize = 64;
const NEIGHBOURS: [(i32, i32); 8] = [
    (-1, -1),
    (0, -1),
    (1, -1),
    (-1, 0),
    (1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
];
const CROSS: [(i32, i32); 4] = [(0, -1), (-1, 0), (1, 0), (0, 1)];

/// What a cascade does when it would have to change a built tile.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Built {
    /// Terraforming: the change is refused, with `NeedBulldoze`.
    Refuse,
    /// Levelling: the slope against the built tile is tolerated.
    Tolerate,
}

/// Bare land, trees and rubble: tiles a terrain change may touch without bulldozing.
fn clearable(tile: Tile) -> bool {
    tile == DIRT || Simulation::is_tree(tile) || (RUBBLE..=LASTRUBBLE).contains(&tile)
}

impl Simulation {
    /// Raises (`delta` = 1) or lowers (`delta` = -1) the tile at `(x, y)` by one altitude step,
    /// with the neighbours it drags along (see the module documentation). With the relief rules
    /// off, or for any other `delta`, it is refused with `Failed` and changes nothing.
    pub fn terraform(&mut self, x: i32, y: i32, delta: i32) -> ToolResult {
        if !self.relief_rules() {
            return ToolResult::Failed;
        }
        let (result, mut effects) = self.terraform_outcome(x, y, delta);
        if result == ToolResult::Ok {
            effects.modify_world(self);
        }
        self.report_refusal(result, x, y);
        self.sim_pass = 0;
        self.tool_invalidate_maps();
        result
    }

    /// Dry run of [`Simulation::terraform`]: what it would return and charge. Changes nothing.
    pub fn terraform_preview(&self, x: i32, y: i32, delta: i32) -> ToolPreview {
        if !self.relief_rules() {
            return ToolPreview {
                result: ToolResult::Failed,
                cost: 0,
            };
        }
        let (result, effects) = self.terraform_outcome(x, y, delta);
        let cost = if result == ToolResult::Ok {
            effects.get_cost()
        } else {
            0
        };
        ToolPreview { result, cost }
    }

    /// The plan of a terraform, with the funds check applied.
    fn terraform_outcome(&self, x: i32, y: i32, delta: i32) -> (ToolResult, ToolEffects) {
        let (planned, effects) = self.plan_terraform(x, y, delta);
        let result = if planned == ToolResult::Ok && !effects.is_affordable(self) {
            ToolResult::NoMoney
        } else {
            planned
        };
        (result, effects)
    }

    /// Plans a terraform: the target altitude, then the cascade, then the cost.
    fn plan_terraform(&self, x: i32, y: i32, delta: i32) -> (ToolResult, ToolEffects) {
        let mut effects = ToolEffects::new();
        if (delta != 1 && delta != -1) || !self.on_map(x, y) {
            return (ToolResult::Failed, effects);
        }
        let Some(raw) = self.tile(x, y) else {
            return (ToolResult::Failed, effects);
        };
        let tile = raw & LOMASK;
        if is_water(tile) {
            return (ToolResult::Failed, effects);
        }
        let current = self.height_in(&effects, x, y);
        let target = current + delta;
        if !(FLOOR..=MAX).contains(&target) {
            return (ToolResult::Failed, effects);
        }
        if !clearable(tile) {
            return (ToolResult::NeedBulldoze, effects);
        }

        effects.set_height(x, y, target as u8);
        if let Err(refused) = self.settle(&mut effects, &[(x, y)], Built::Refuse) {
            return (refused, effects);
        }
        let changed = self
            .altitude_moves(&effects)
            .iter()
            .filter(|&&moved| moved > 0)
            .count() as i32;
        effects.add_cost(TERRAFORM_STEP_COST * changed);
        (ToolResult::Ok, effects)
    }

    /// Planning hook of every tool (called from `plan_tool`): with the relief rules on, adds the
    /// levelling of a building footprint, or the slope cost of a road, rail or power line.
    /// Returns the planned result, or `Failed` when the rules refuse the plan.
    pub(crate) fn price_relief(
        &self,
        tool: EditingTool,
        x: i32,
        y: i32,
        planned: ToolResult,
        effects: &mut ToolEffects,
    ) -> ToolResult {
        if planned != ToolResult::Ok || !self.relief_rules() {
            return planned;
        }
        if tool.size() > 1 {
            return self.price_footprint(tool, x, y, effects);
        }
        if matches!(
            tool,
            EditingTool::Road | EditingTool::Railroad | EditingTool::Wire
        ) {
            effects.add_cost(SLOPE_STEP_COST * self.slope_range(x, y));
        }
        ToolResult::Ok
    }

    /// Flattens the footprint of a building to its rounded mean altitude, then settles the
    /// neighbours. Water next to the footprint refuses the plan.
    fn price_footprint(
        &self,
        tool: EditingTool,
        x: i32,
        y: i32,
        effects: &mut ToolEffects,
    ) -> ToolResult {
        let (x0, y0, w, h) = tool.footprint(x, y);
        let count = w * h;
        let mut seeds = Vec::with_capacity(count as usize);
        let mut sum = 0;
        for xx in x0..x0 + w {
            for yy in y0..y0 + h {
                sum += self.height_in(effects, xx, yy);
                seeds.push((xx, yy));
            }
        }
        let target = ((sum + count / 2) / count).clamp(FLOOR, MAX);
        for &(xx, yy) in &seeds {
            effects.set_height(xx, yy, target as u8);
        }
        if let Err(refused) = self.settle(effects, &seeds, Built::Tolerate) {
            return refused;
        }
        let moved: i32 = self.altitude_moves(effects).iter().sum();
        effects.add_cost(LEVEL_STEP_COST * moved);
        ToolResult::Ok
    }

    /// Moves the neighbours that break `MAX_SLOPE` against a changed tile, from the seeds on,
    /// until no changed tile breaks it. Each move goes to the nearest altitude that respects the
    /// bound. Water is never moved: a violation against it is `Failed`. A built tile is refused
    /// or tolerated, as `built` says. Changes go to `effects` only.
    fn settle(
        &self,
        effects: &mut ToolEffects,
        seeds: &[(i32, i32)],
        built: Built,
    ) -> Result<(), ToolResult> {
        let (w, h) = self.world_size();
        let mut budget = (w as usize) * (h as usize) * STEPS_PER_TILE;
        let mut queue: VecDeque<(i32, i32)> = seeds.iter().copied().collect();
        while let Some((x, y)) = queue.pop_front() {
            if budget == 0 {
                return Err(ToolResult::Failed);
            }
            budget -= 1;
            let here = self.height_in(effects, x, y);
            for (dx, dy) in NEIGHBOURS {
                let (nx, ny) = (x + dx, y + dy);
                if !self.on_map(nx, ny) {
                    continue;
                }
                let there = self.height_in(effects, nx, ny);
                if (there - here).abs() <= MAX_SLOPE {
                    continue;
                }
                let tile = effects.get_map_tile(self, nx, ny);
                if is_water(tile) {
                    return Err(ToolResult::Failed);
                }
                if !clearable(tile) {
                    match built {
                        Built::Refuse => return Err(ToolResult::NeedBulldoze),
                        Built::Tolerate => continue,
                    }
                }
                let wanted = there
                    .clamp(here - MAX_SLOPE, here + MAX_SLOPE)
                    .clamp(FLOOR, MAX);
                effects.set_height(nx, ny, wanted as u8);
                queue.push_back((nx, ny));
            }
        }
        Ok(())
    }

    /// Altitude of a tile, with the changes already planned in `effects`.
    fn height_in(&self, effects: &ToolEffects, x: i32, y: i32) -> i32 {
        let altitude = effects
            .get_height(x, y)
            .or_else(|| self.relief().height_at(x, y))
            .unwrap_or(SEA_LEVEL);
        i32::from(altitude)
    }

    /// Altitude units moved by each tile the plan changed (`|new - current|`).
    fn altitude_moves(&self, effects: &ToolEffects) -> Vec<i32> {
        effects
            .heights()
            .map(|(x, y, new)| {
                let current = self.relief().height_at(x, y).unwrap_or(SEA_LEVEL);
                (i32::from(new) - i32::from(current)).abs()
            })
            .collect()
    }

    /// Altitude range over a tile and its four orthogonal neighbours that are on the map.
    fn slope_range(&self, x: i32, y: i32) -> i32 {
        let mut low = i32::MAX;
        let mut high = i32::MIN;
        for (dx, dy) in std::iter::once((0, 0)).chain(CROSS) {
            if let Some(h) = self.relief().height_at(x + dx, y + dy) {
                low = low.min(i32::from(h));
                high = high.max(i32::from(h));
            }
        }
        if high < low {
            0
        } else {
            high - low
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relief::Relief;
    use crate::tile_chars::{RESBASE, RIVER};
    use crate::tool::TOOL_COUNT;

    /// A 120 x 100 generated city with the relief rules off.
    fn random_city(seed: i32) -> Simulation {
        let mut s = Simulation::with_default_size();
        s.new_random_city(seed);
        s
    }

    /// A `40 x 30` city of bare dirt whose relief is `altitude(x, y)`, with the rules on.
    fn city(altitude: impl Fn(i32, i32) -> u8) -> Simulation {
        let (w, h) = (40, 30);
        let mut s = Simulation::new(w, h);
        s.tiles.fill(DIRT);
        s.total_funds = 1_000_000;
        let mut heights = vec![0u8; (w * h) as usize];
        for x in 0..w {
            for y in 0..h {
                heights[(x * h + y) as usize] = altitude(x, y);
            }
        }
        assert!(s.set_relief(Relief::from_raw(w, h, heights).unwrap()));
        s.set_relief_rules(true);
        s
    }

    /// Small deterministic generator for the tests (not the simulation's `Rng`).
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 33
        }

        fn below(&mut self, n: i32) -> i32 {
            (self.next() % n as u64) as i32
        }
    }

    fn altitude(s: &Simulation, x: i32, y: i32) -> i32 {
        i32::from(s.relief().height_at(x, y).unwrap())
    }

    fn assert_slope_bound(s: &Simulation) {
        let (w, h) = s.world_size();
        for x in 0..w {
            for y in 0..h {
                let v = altitude(s, x, y);
                for (dx, dy) in NEIGHBOURS {
                    if s.on_map(x + dx, y + dy) {
                        let n = altitude(s, x + dx, y + dy);
                        assert!(
                            (v - n).abs() <= MAX_SLOPE,
                            "({x},{y})={v} vs ({},{})={n}",
                            x + dx,
                            y + dy
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn rules_off_terraform_is_refused_and_changes_nothing() {
        let mut s = Simulation::new(40, 30);
        s.tiles.fill(DIRT);
        let (tiles, funds) = (s.tiles.clone(), s.total_funds);
        assert_eq!(s.terraform(5, 5, 1), ToolResult::Failed);
        assert_eq!(s.terraform(5, 5, -1), ToolResult::Failed);
        assert_eq!(
            s.terraform_preview(5, 5, 1),
            ToolPreview {
                result: ToolResult::Failed,
                cost: 0
            }
        );
        assert_eq!(s.tiles, tiles);
        assert_eq!(s.total_funds, funds);
        assert!(!s.relief_edited());
    }

    #[test]
    fn rules_off_tools_match_a_simulation_that_toggled_the_rules() {
        let mut plain = random_city(3);
        let mut toggled = random_city(3);
        toggled.set_relief_rules(true);
        toggled.set_relief_rules(false);

        let mut lcg = Lcg(7);
        for step in 0..400 {
            let tool = EditingTool::ALL[lcg.below(TOOL_COUNT as i32) as usize];
            let (x, y) = (lcg.below(120), lcg.below(100));
            assert_eq!(
                plain.tool_preview(tool, x, y),
                toggled.tool_preview(tool, x, y),
                "step {step}: preview of {tool:?} at ({x},{y})"
            );
            assert_eq!(
                plain.tool_down(tool, x, y),
                toggled.tool_down(tool, x, y),
                "step {step}: {tool:?} at ({x},{y})"
            );
        }
        assert_eq!(plain.tiles, toggled.tiles);
        assert_eq!(plain.total_funds, toggled.total_funds);
        assert_eq!(format!("{:?}", plain.rng), format!("{:?}", toggled.rng));
        assert_eq!(plain.relief().as_slice(), toggled.relief().as_slice());
        assert!(!plain.relief_edited() && !toggled.relief_edited());
    }

    #[test]
    fn terraform_raises_and_lowers_one_step() {
        let mut s = city(|_, _| 20);
        let funds = s.total_funds;
        assert_eq!(s.terraform_preview(10, 10, 1).cost, TERRAFORM_STEP_COST);
        assert_eq!(s.terraform(10, 10, 1), ToolResult::Ok);
        assert_eq!(altitude(&s, 10, 10), 21);
        assert_eq!(s.total_funds, funds - i64::from(TERRAFORM_STEP_COST));
        assert!(s.relief_edited());

        assert_eq!(s.terraform(10, 10, -1), ToolResult::Ok);
        assert_eq!(s.terraform(10, 10, -1), ToolResult::Ok);
        assert_eq!(altitude(&s, 10, 10), 19);
    }

    #[test]
    fn cascade_moves_neighbours_and_costs_per_tile_changed() {
        // (10,10) at 23 among 20s: raising it to 24 drags its eight neighbours to 21.
        let mut s = city(|x, y| if (x, y) == (10, 10) { 23 } else { 20 });
        let preview = s.terraform_preview(10, 10, 1);
        assert_eq!(preview.result, ToolResult::Ok);
        assert_eq!(preview.cost, 9 * TERRAFORM_STEP_COST);

        let funds = s.total_funds;
        assert_eq!(s.terraform(10, 10, 1), ToolResult::Ok);
        assert_eq!(s.total_funds, funds - i64::from(preview.cost));
        assert_eq!(altitude(&s, 10, 10), 24);
        for (dx, dy) in NEIGHBOURS {
            assert_eq!(altitude(&s, 10 + dx, 10 + dy), 21);
        }
        assert_slope_bound(&s);
    }

    #[test]
    fn water_and_limits_are_refused() {
        let mut s = city(|_, _| 11);
        s.set_tile(5, 5, RIVER);
        s.relief_mut().set_height_at(5, 5, SEA_LEVEL);
        // Water itself.
        assert_eq!(s.terraform(5, 5, 1), ToolResult::Failed);
        // Land beside water cannot rise above sea + MAX_SLOPE.
        assert_eq!(s.terraform(6, 5, 1), ToolResult::Failed);
        // ...but it can be lowered.
        assert_eq!(s.terraform(6, 5, -1), ToolResult::Ok);
        // Off the map, and steps other than +-1.
        assert_eq!(s.terraform(-1, 0, 1), ToolResult::Failed);
        assert_eq!(s.terraform(10, 10, 2), ToolResult::Failed);
        assert_eq!(s.terraform(10, 10, 0), ToolResult::Failed);

        let mut high = city(|x, y| if (x, y) == (10, 10) { MAX_HEIGHT } else { 20 });
        assert_eq!(high.terraform(10, 10, 1), ToolResult::Failed);
        let mut low = city(|x, y| if (x, y) == (10, 10) { FLOOR as u8 } else { 20 });
        assert_eq!(low.terraform(10, 10, -1), ToolResult::Failed);
    }

    #[test]
    fn built_tiles_block_terraforming_that_would_change_them() {
        let mut s = city(|x, y| if (x, y) == (10, 10) { 23 } else { 20 });
        s.set_tile(11, 10, RESBASE);
        let before = s.relief().as_slice().to_vec();
        let funds = s.total_funds;
        // The cascade needs to move the built neighbour (11,10).
        assert_eq!(s.terraform(10, 10, 1), ToolResult::NeedBulldoze);
        // The target itself is built.
        assert_eq!(s.terraform(11, 10, 1), ToolResult::NeedBulldoze);
        assert_eq!(s.relief().as_slice(), &before[..]);
        assert_eq!(s.total_funds, funds);
    }

    #[test]
    fn no_money_refuses_terraforming() {
        let mut s = city(|_, _| 20);
        s.total_funds = 5;
        assert_eq!(
            s.terraform_preview(10, 10, 1),
            ToolPreview {
                result: ToolResult::NoMoney,
                cost: 0
            }
        );
        assert_eq!(s.terraform(10, 10, 1), ToolResult::NoMoney);
        assert_eq!(altitude(&s, 10, 10), 20);
        assert_eq!(s.total_funds, 5);
    }

    #[test]
    fn slope_bound_holds_after_random_terraforms_on_a_generated_city() {
        let mut s = Simulation::new(90, 70);
        s.new_random_city(4);
        s.total_funds = 10_000_000;
        s.set_relief_rules(true);
        assert_slope_bound(&s);
        let tiles = s.tiles.clone();

        let mut lcg = Lcg(12_345);
        let mut applied = 0;
        for _ in 0..1000 {
            let (x, y) = (lcg.below(90), lcg.below(70));
            let delta = if lcg.below(2) == 0 { 1 } else { -1 };
            let preview = s.terraform_preview(x, y, delta);
            let funds = s.total_funds;
            let result = s.terraform(x, y, delta);
            assert_eq!(result, preview.result, "({x},{y}) {delta}");
            if result == ToolResult::Ok {
                applied += 1;
                assert_eq!(s.total_funds, funds - i64::from(preview.cost));
            } else {
                assert_eq!(s.total_funds, funds);
            }
            assert_slope_bound(&s);
        }
        assert!(applied > 100, "only {applied} terraforms applied");
        assert_eq!(s.tiles, tiles, "terraforming never changes the tiles");
    }

    #[test]
    fn building_preview_includes_levelling_and_matches_the_charge() {
        // Footprint of a residential zone at (10,10) is (9..12, 9..12); one corner sits 6 high.
        let mut s = city(|x, y| if (x, y) == (9, 9) { 26 } else { 20 });
        // Mean (186 / 9, rounded) is 21: 5 units for the corner and 8 x 1 for the rest = 13 units.
        let expected = 100 + 13 * LEVEL_STEP_COST;
        let preview = s.tool_preview(EditingTool::Residential, 10, 10);
        assert_eq!(preview.result, ToolResult::Ok);
        assert_eq!(preview.cost, expected);

        let funds = s.total_funds;
        assert_eq!(
            s.tool_down(EditingTool::Residential, 10, 10),
            ToolResult::Ok
        );
        assert_eq!(s.total_funds, funds - i64::from(preview.cost));
        for x in 9..12 {
            for y in 9..12 {
                assert_eq!(altitude(&s, x, y), 21, "footprint ({x},{y})");
            }
        }
        assert_eq!(altitude(&s, 8, 8), 20);
        assert_slope_bound(&s);
    }

    #[test]
    fn levelling_costs_nothing_extra_on_flat_ground() {
        let s = city(|_, _| 20);
        assert_eq!(
            s.tool_preview(EditingTool::Commercial, 10, 10).cost,
            EditingTool::Commercial.cost()
        );
    }

    #[test]
    fn not_enough_money_for_the_levelling_refuses_the_building() {
        let mut s = city(|x, y| if (x, y) == (9, 9) { 26 } else { 20 });
        s.total_funds = 150; // the plan costs 165 in total
        assert_eq!(
            s.tool_preview(EditingTool::Residential, 10, 10),
            ToolPreview {
                result: ToolResult::NoMoney,
                cost: 0
            }
        );
        assert_eq!(
            s.tool_down(EditingTool::Residential, 10, 10),
            ToolResult::NoMoney
        );
        assert_eq!(altitude(&s, 9, 9), 26);
        assert_eq!(s.total_funds, 150);
        assert_eq!(s.tile(10, 10), Some(DIRT));
    }

    #[test]
    fn levelling_refuses_a_footprint_that_slopes_into_water() {
        let mut s = city(|_, _| 20);
        s.set_tile(5, 5, RIVER);
        s.relief_mut().set_height_at(5, 5, SEA_LEVEL);
        // The footprint of a building at (7,7) is (6..9, 6..9), beside the water at (5,5).
        assert_eq!(
            s.tool_preview(EditingTool::Residential, 7, 7).result,
            ToolResult::Failed
        );
    }

    #[test]
    fn roads_and_wires_pay_for_the_altitude_range_around_them() {
        let mut s = city(|x, y| if (x, y) == (10, 10) { 23 } else { 20 });
        for tool in [EditingTool::Road, EditingTool::Railroad, EditingTool::Wire] {
            let flat = s.tool_preview(tool, 20, 20).cost;
            assert_eq!(flat, tool.cost(), "{tool:?} on flat ground");
            // The tile (10,10) and its neighbours span 3 units.
            let slope = s.tool_preview(tool, 10, 10).cost;
            assert_eq!(
                slope,
                tool.cost() + 3 * SLOPE_STEP_COST,
                "{tool:?} on a slope"
            );
        }
        // A road does not flatten the ground.
        let before = s.relief().as_slice().to_vec();
        assert_eq!(s.tool_down(EditingTool::Road, 10, 10), ToolResult::Ok);
        assert_eq!(s.relief().as_slice(), &before[..]);
    }

    #[test]
    fn same_actions_give_the_same_relief() {
        let run = || {
            let mut s = Simulation::new(90, 70);
            s.new_random_city(9);
            s.total_funds = 10_000_000;
            s.set_relief_rules(true);
            let mut lcg = Lcg(99);
            for _ in 0..300 {
                let (x, y) = (lcg.below(90), lcg.below(70));
                let delta = if lcg.below(2) == 0 { 1 } else { -1 };
                s.terraform(x, y, delta);
                let tool = EditingTool::ALL[lcg.below(TOOL_COUNT as i32) as usize];
                s.tool_down(tool, x, y);
            }
            (
                s.relief().as_slice().to_vec(),
                s.tiles.clone(),
                s.total_funds,
            )
        };
        assert_eq!(run(), run());
    }
}
