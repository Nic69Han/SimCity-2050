//! Water network (docs/game-design-v02.md): pumps and underground pipes. With the rule on
//! ([`Extensions::water_rules`](crate::extensions::Extensions::water_rules)) a zone that has no water stops growing once its density reaches
//! [`WATER_FREE_DENSITY`]: small towns grow without water, then stall.
//!
//! * **Pipes** are underground: one per tile, under anything (buildings, roads, water). They are
//!   the byte [`PIPE`] in `WaterNetwork::pipes`. Laying one costs [`PIPE_COST`], taking it up is free.
//! * **Pumps** are the byte [`PUMP`] in the same layer (a pump conducts like a pipe, so the layer
//!   is the whole saved network and the file format is the layer's bytes). A pump sits on a land
//!   tile next to water (the 8 neighbours); it needs no power, a documented simplification. At
//!   most [`MAX_PUMPS`]; each costs [`PUMP_COST`]. `WaterNetwork::pumps` is their list.
//! * **Coverage**, rebuilt whenever the network changes (never in a tick, so a hook allocates
//!   nothing): a breadth-first search from the pumps through pipe tiles reaches the "watered"
//!   pipes, each tile once, no further than [`PUMP_RANGE`] pipe steps from a pump; a second search
//!   from the watered pipes marks every tile within [`WATER_REACH`] steps (Manhattan distance on
//!   the open map) as watered. A zone is watered when its centre tile is.
//! * **Growth** (`zone_can_grow`, the hook of `do_res_in` / `do_com_in` / `do_ind_in`): refused
//!   for a dry zone whose density level is [`WATER_FREE_DENSITY`] or more. The level is 0 for an
//!   empty zone (residential: houses included) and `n` for the n-th tier of building (the
//!   residential, commercial and industrial tiers the engine already has: 1..=4, 1..=5, 1..=4).
//! * No land-value bonus and no running cost: the rule is only the growth ceiling.
//!
//! Everything below works only with the rule on: off, every call is refused with
//! [`ToolResult::Failed`] and a cost of 0, and the hooks answer "may grow". No random number is
//! drawn anywhere. Loops are bounded by the map size (each tile is queued once).

use crate::position::Position;
use crate::relief::is_water;
use crate::simulation::Simulation;
use crate::tile::{Tile, LOMASK, ZONEBIT};
use crate::tile_chars::{COMBASE, FREEZ, HOSPITAL, INDBASE, PORTBASE, RESBASE};
use crate::tool::{ToolPreview, ToolResult};
use crate::traffic::ZoneType;
use crate::underground::UndergroundLayer;

/// Layer byte of a pipe.
pub const PIPE: u8 = 1;
/// Layer byte of a pump (it also conducts like a pipe).
pub const PUMP: u8 = 3;
/// Dollars to lay one pipe.
pub const PIPE_COST: i32 = 5;
/// Dollars to build one pump.
pub const PUMP_COST: i32 = 300;
/// Largest number of pumps in a city.
pub const MAX_PUMPS: usize = 64;
/// Pipe steps from a pump up to which a pipe is still watered.
pub const PUMP_RANGE: u32 = 64;
/// A zone tile is watered when a watered pipe or pump is at most this far (Manhattan distance).
pub const WATER_REACH: u32 = 3;
/// Density level from which a dry zone stops growing (0 = empty or houses, then the tiers).
pub const WATER_FREE_DENSITY: i32 = 2;

const NEIGHBOURS4: [(i32, i32); 4] = [(0, -1), (-1, 0), (1, 0), (0, 1)];

/// The water network of a city: pumps and pipes, and the coverage computed from them.
#[derive(Debug, Clone)]
pub struct WaterNetwork {
    /// Underground layer, one byte per tile: 0 nothing, [`PIPE`], [`PUMP`] (any other non-zero
    /// byte of a file counts as a pipe). Change it through the `Simulation` calls, or call
    /// [`refresh`](WaterNetwork::refresh) after writing it.
    pub pipes: UndergroundLayer,
    /// Pumps, in tile order (derived from the layer).
    pumps: Vec<(i32, i32)>,
    /// 1 on every pump and every pipe reached from a pump.
    fed: UndergroundLayer,
    /// 1 on every tile within [`WATER_REACH`] of a fed tile.
    covered: UndergroundLayer,
}

impl PartialEq for WaterNetwork {
    /// The network is its layer: the rest is derived from it.
    fn eq(&self, other: &Self) -> bool {
        self.pipes == other.pipes
    }
}

impl Eq for WaterNetwork {}

impl WaterNetwork {
    /// An empty network for a `width` x `height` map.
    pub fn new(width: i32, height: i32) -> WaterNetwork {
        WaterNetwork {
            pipes: UndergroundLayer::new(width, height),
            pumps: Vec::new(),
            fed: UndergroundLayer::new(width, height),
            covered: UndergroundLayer::new(width, height),
        }
    }

    /// Whether the network holds nothing (it then adds nothing to a saved file).
    pub fn is_empty(&self) -> bool {
        self.pipes.is_empty()
    }

    /// The bytes of the water chunk: the layer; nothing when the network is empty.
    pub fn encode(&self) -> Vec<u8> {
        self.pipes.encode()
    }

    /// The network stored in `bytes` for a `width` x `height` map (empty: an empty network).
    /// Refused when the layer does not fit the map or holds more than [`MAX_PUMPS`] pumps.
    pub fn decode(bytes: &[u8], width: i32, height: i32) -> Result<WaterNetwork, &'static str> {
        let pipes = UndergroundLayer::from_raw(width, height, bytes)
            .ok_or("water chunk does not match the map")?;
        let mut net = WaterNetwork {
            pipes,
            pumps: Vec::new(),
            fed: UndergroundLayer::new(width, height),
            covered: UndergroundLayer::new(width, height),
        };
        net.refresh();
        if net.pumps.len() > MAX_PUMPS {
            return Err("water chunk has too many pumps");
        }
        Ok(net)
    }

    /// Pumps, in tile order.
    pub fn pumps(&self) -> &[(i32, i32)] {
        &self.pumps
    }

    /// Number of tiles with a pipe or a pump.
    pub fn pipe_count(&self) -> usize {
        self.pipes.count()
    }

    /// Whether tile `(x, y)` has a pipe or a pump.
    pub fn has_pipe(&self, x: i32, y: i32) -> bool {
        self.pipes.get(x, y) != 0
    }

    /// Whether tile `(x, y)` has a pump.
    pub fn has_pump(&self, x: i32, y: i32) -> bool {
        self.pipes.get(x, y) == PUMP
    }

    /// Whether the pipe or pump at `(x, y)` is reached from a pump.
    pub fn is_fed(&self, x: i32, y: i32) -> bool {
        self.fed.get(x, y) != 0
    }

    /// Whether tile `(x, y)` is within [`WATER_REACH`] of a watered pipe or pump.
    pub fn covers(&self, x: i32, y: i32) -> bool {
        self.covered.get(x, y) != 0
    }

    /// Rebuilds the pump list and the coverage from the layer (see the module documentation).
    pub fn refresh(&mut self) {
        let (w, h) = (self.pipes.width(), self.pipes.height());
        self.fed.clear();
        self.covered.clear();
        self.pumps.clear();
        for x in 0..w {
            for y in 0..h {
                if self.pipes.get(x, y) == PUMP {
                    self.pumps.push((x, y));
                }
            }
        }
        if self.pumps.is_empty() {
            return;
        }
        let n = (w as usize) * (h as usize);
        let sources = self.pumps.clone();
        let fed = self.spread(&sources, n, PUMP_RANGE, true);
        for &(x, y) in &fed {
            self.fed.set(x, y, 1);
        }
        for (x, y) in self.spread(&fed, n, WATER_REACH, false) {
            self.covered.set(x, y, 1);
        }
    }

    /// Breadth-first search from `sources`, at most `depth` steps, each tile queued once (so at
    /// most `n` iterations). With `pipes_only` it walks pipe tiles only. Returns every tile
    /// reached, sources included.
    fn spread(
        &self,
        sources: &[(i32, i32)],
        n: usize,
        depth: u32,
        pipes_only: bool,
    ) -> Vec<(i32, i32)> {
        let (w, h) = (self.pipes.width(), self.pipes.height());
        let index = |x: i32, y: i32| (x as usize) * (h as usize) + (y as usize);
        let mut seen = vec![false; n];
        let mut queue: Vec<(i32, i32, u32)> = Vec::with_capacity(sources.len());
        for &(x, y) in sources {
            if !seen[index(x, y)] {
                seen[index(x, y)] = true;
                queue.push((x, y, 0));
            }
        }
        // `head` walks the queue; each tile is queued once, so the queue never exceeds `n`.
        for head in 0..n {
            if head == queue.len() {
                break;
            }
            let (x, y, d) = queue[head];
            if d >= depth {
                continue;
            }
            for (dx, dy) in NEIGHBOURS4 {
                let (nx, ny) = (x + dx, y + dy);
                if nx < 0 || ny < 0 || nx >= w || ny >= h || seen[index(nx, ny)] {
                    continue;
                }
                if pipes_only && self.pipes.get(nx, ny) == 0 {
                    continue;
                }
                seen[index(nx, ny)] = true;
                queue.push((nx, ny, d + 1));
            }
        }
        queue.into_iter().map(|(x, y, _)| (x, y)).collect()
    }
}

/// What the water network holds and serves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct WaterStats {
    /// Pumps.
    pub pumps: i32,
    /// Tiles with a pipe or a pump.
    pub pipes: i32,
    /// Residential, commercial and industrial zones whose centre is watered.
    pub watered_zones: i32,
    /// The same zones whose centre is not.
    pub unwatered_zones: i32,
}

/// The zone kind of a zone-centre tile, or `None` for any other tile (special zones, hospitals,
/// churches, plain tiles). Same ranges as `do_zone`.
fn zone_kind(tile: Tile) -> Option<ZoneType> {
    if tile & ZONEBIT == 0 {
        return None;
    }
    match tile & LOMASK {
        t if (RESBASE..HOSPITAL).contains(&t) => Some(ZoneType::Residential),
        t if (COMBASE..INDBASE).contains(&t) => Some(ZoneType::Commercial),
        t if (INDBASE..=PORTBASE).contains(&t) => Some(ZoneType::Industrial),
        _ => None,
    }
}

impl Simulation {
    /// Whether the water rules are on (off by default: the engine then equals the original).
    pub fn water_rules(&self) -> bool {
        self.extensions().water_rules
    }

    /// Turns the water rules on or off.
    pub fn set_water_rules(&mut self, on: bool) {
        self.extensions_mut().water_rules = on;
    }

    /// Dry run of [`place_pipe`](Self::place_pipe).
    pub fn pipe_preview(&self, x: i32, y: i32) -> ToolPreview {
        let result = self.plan_pipe(x, y);
        preview(result, PIPE_COST)
    }

    /// Lays a pipe at `(x, y)` for [`PIPE_COST`]. `Failed`: rules off, off the map, or a pipe
    /// (or pump) is already there. `NoMoney`: the funds do not cover it.
    pub fn place_pipe(&mut self, x: i32, y: i32) -> ToolResult {
        let result = self.plan_pipe(x, y);
        if result == ToolResult::Ok {
            self.spend(PIPE_COST);
            self.water.pipes.set(x, y, PIPE);
            self.water.refresh();
        }
        self.finish_water_tool(result, x, y)
    }

    /// Takes up the pipe at `(x, y)`, free of charge. `Failed` when there is none (a pump is
    /// removed with [`remove_pump`](Self::remove_pump)) or the rules are off.
    pub fn remove_pipe(&mut self, x: i32, y: i32) -> ToolResult {
        self.remove_piece(x, y, PIPE, 0)
    }

    /// Dry run of [`place_pump`](Self::place_pump).
    pub fn pump_preview(&self, x: i32, y: i32) -> ToolPreview {
        let result = self.plan_pump(x, y);
        preview(result, PUMP_COST)
    }

    /// Builds a pump at `(x, y)` for [`PUMP_COST`]; a pipe already there is replaced by the pump.
    /// `Failed`: rules off, off the map, not on land, no water next to it (8 neighbours), a pump
    /// already there, or [`MAX_PUMPS`] reached. `NoMoney`: the funds do not cover it.
    pub fn place_pump(&mut self, x: i32, y: i32) -> ToolResult {
        let result = self.plan_pump(x, y);
        if result == ToolResult::Ok {
            self.spend(PUMP_COST);
            self.water.pipes.set(x, y, PUMP);
            self.water.refresh();
        }
        self.finish_water_tool(result, x, y)
    }

    /// Removes the pump at `(x, y)` (a pipe stays in its place), free of charge. `Failed` when
    /// there is none or the rules are off.
    pub fn remove_pump(&mut self, x: i32, y: i32) -> ToolResult {
        self.remove_piece(x, y, PUMP, PIPE)
    }

    /// Whether tile `(x, y)` is watered: a watered pipe or pump is within [`WATER_REACH`]. Always
    /// false with the rules off.
    pub fn watered(&self, x: i32, y: i32) -> bool {
        self.water_rules() && self.water.covers(x, y)
    }

    /// Pumps, pipes and zones served, by a scan of the map. All zero with the rules off.
    pub fn water_stats(&self) -> WaterStats {
        if !self.water_rules() {
            return WaterStats::default();
        }
        let mut stats = WaterStats {
            pumps: self.water.pumps.len() as i32,
            pipes: self.water.pipe_count() as i32,
            ..WaterStats::default()
        };
        for (x, y) in self.zone_centres() {
            if self.water.covers(x, y) {
                stats.watered_zones += 1;
            } else {
                stats.unwatered_zones += 1;
            }
        }
        stats
    }

    /// What to draw on each tile, in tile order: 0 nothing, 1 a pipe nothing feeds, 2 a pipe fed
    /// by a pump, 3 a pump. All zero with the rules off.
    pub fn water_layer(&self) -> Vec<u8> {
        let (w, h) = self.world_size();
        let mut out = vec![0; (w as usize) * (h as usize)];
        if !self.water_rules() {
            return out;
        }
        for x in 0..w {
            for y in 0..h {
                out[(x as usize) * (h as usize) + (y as usize)] = match self.water.pipes.get(x, y) {
                    0 => 0,
                    PUMP => 3,
                    _ if self.water.is_fed(x, y) => 2,
                    _ => 1,
                };
            }
        }
        out
    }

    /// Centres of the zones that are not watered, in tile order. Empty with the rules off.
    pub fn dry_zones(&self) -> Vec<(i32, i32)> {
        if !self.water_rules() {
            return Vec::new();
        }
        let mut out = self.zone_centres();
        out.retain(|&(x, y)| !self.water.covers(x, y));
        out
    }

    /// Centres of the residential, commercial and industrial zones, in tile order.
    fn zone_centres(&self) -> Vec<(i32, i32)> {
        let (w, h) = self.world_size();
        let mut out = Vec::new();
        for x in 0..w {
            for y in 0..h {
                if self.tile(x, y).and_then(zone_kind).is_some() {
                    out.push((x, y));
                }
            }
        }
        out
    }

    fn plan_pipe(&self, x: i32, y: i32) -> ToolResult {
        if !self.water_rules() || !self.on_map(x, y) || self.water.has_pipe(x, y) {
            return ToolResult::Failed;
        }
        self.afford(PIPE_COST)
    }

    fn plan_pump(&self, x: i32, y: i32) -> ToolResult {
        if !self.water_rules()
            || self.water.has_pump(x, y)
            || self.water.pumps.len() >= MAX_PUMPS
            || !self.is_pump_site(x, y)
        {
            return ToolResult::Failed;
        }
        self.afford(PUMP_COST)
    }

    /// Land next to water.
    fn is_pump_site(&self, x: i32, y: i32) -> bool {
        let Some(tile) = self.tile(x, y) else {
            return false;
        };
        if is_water(tile) {
            return false;
        }
        (-1..=1).any(|dx| {
            (-1..=1).any(|dy| (dx, dy) != (0, 0) && self.tile(x + dx, y + dy).is_some_and(is_water))
        })
    }

    fn afford(&self, cost: i32) -> ToolResult {
        if self.total_funds >= i64::from(cost) {
            ToolResult::Ok
        } else {
            ToolResult::NoMoney
        }
    }

    /// Replaces the piece `kind` at `(x, y)` by `left` (0 or a pipe), free.
    fn remove_piece(&mut self, x: i32, y: i32, kind: u8, left: u8) -> ToolResult {
        if !self.water_rules() || self.water.pipes.get(x, y) != kind {
            return ToolResult::Failed;
        }
        self.water.pipes.set(x, y, left);
        self.water.refresh();
        self.finish_water_tool(ToolResult::Ok, x, y)
    }

    /// What every water tool does last, as `terraform` does: the refusal message, the maps.
    fn finish_water_tool(&mut self, result: ToolResult, x: i32, y: i32) -> ToolResult {
        self.report_refusal(result, x, y);
        self.sim_pass = 0;
        self.tool_invalidate_maps();
        result
    }
}

fn preview(result: ToolResult, cost: i32) -> ToolPreview {
    ToolPreview {
        result,
        cost: if result == ToolResult::Ok { cost } else { 0 },
    }
}

/// Density level of the zone whose centre tile is `tile`: 0 for an empty zone (houses included),
/// else the tier of its building.
fn density_level(sim: &Simulation, tile: Tile, kind: ZoneType) -> i32 {
    let level = match kind {
        ZoneType::Residential if tile == FREEZ => 0,
        ZoneType::Residential => i32::from(sim.get_res_zone_pop(tile)) / 8 - 1,
        ZoneType::Commercial => i32::from(sim.get_com_zone_pop(tile)),
        ZoneType::Industrial => i32::from(sim.get_ind_zone_pop(tile)),
    };
    level.max(0)
}

/// Net cost of the water network for one tax collection, in dollars (a cost is positive): none.
pub(crate) fn monthly_balance(_sim: &Simulation) -> i32 {
    0
}

/// Adjusts the zoning valves after `set_valves` computed them: the water rule leaves them alone.
pub(crate) fn valves(_sim: &mut Simulation) {}

/// Whether water lets a zone of `kind` at `pos` grow: a watered zone, or one below
/// [`WATER_FREE_DENSITY`]. Always true with the water rules off.
pub(crate) fn zone_can_grow(sim: &Simulation, pos: Position, kind: ZoneType) -> bool {
    if !sim.water_rules() {
        return true;
    }
    let Some(raw) = sim.tile(pos.x, pos.y) else {
        return true;
    };
    density_level(sim, raw & LOMASK, kind) < WATER_FREE_DENSITY || sim.water.covers(pos.x, pos.y)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile_chars::{DIRT, RIVER};

    /// A 90 x 70 map of dirt with a river column at x = 10, the rules on and money to spend.
    fn city() -> Simulation {
        let mut s = Simulation::new(90, 70);
        s.tiles.fill(DIRT);
        for y in 0..70 {
            s.set_tile(10, y, RIVER);
        }
        s.total_funds = 10_000;
        s.set_water_rules(true);
        s
    }

    #[test]
    fn an_empty_network_encodes_to_nothing_and_round_trips_with_pipes_and_pumps() {
        let mut w = WaterNetwork::new(80, 67);
        assert!(w.is_empty() && w.encode().is_empty());
        assert_eq!(WaterNetwork::decode(&[], 80, 67), Ok(w.clone()));
        w.pipes.set(5, 6, PIPE);
        w.pipes.set(6, 6, PUMP);
        w.refresh();
        let bytes = w.encode();
        assert_eq!(bytes.len(), 80 * 67);
        let back = WaterNetwork::decode(&bytes, 80, 67).unwrap();
        assert_eq!(back, w);
        assert_eq!(back.pumps(), &[(6, 6)]);
        assert!(back.covers(5, 6) && back.is_fed(5, 6));
        assert!(WaterNetwork::decode(&bytes[1..], 80, 67).is_err());
    }

    #[test]
    fn a_chunk_with_too_many_pumps_is_refused() {
        let mut w = WaterNetwork::new(80, 67);
        for x in 0..=MAX_PUMPS as i32 {
            w.pipes.set(x, 0, PUMP);
        }
        assert!(WaterNetwork::decode(&w.encode(), 80, 67).is_err());
    }

    #[test]
    fn the_search_follows_pipes_only_and_stops_at_the_pump_range() {
        let mut w = WaterNetwork::new(200, 12);
        w.pipes.set(0, 2, PUMP);
        for x in 1..=(PUMP_RANGE as i32 + 10) {
            w.pipes.set(x, 2, PIPE);
        }
        w.pipes.set(PUMP_RANGE as i32 + 30, 2, PIPE); // cut off from the rest
        w.refresh();
        assert!(w.is_fed(PUMP_RANGE as i32, 2));
        assert!(!w.is_fed(PUMP_RANGE as i32 + 1, 2));
        assert!(!w.is_fed(PUMP_RANGE as i32 + 30, 2));
        // coverage: reach from the last fed pipe, in the open
        assert!(w.covers(PUMP_RANGE as i32 + WATER_REACH as i32, 2));
        assert!(!w.covers(PUMP_RANGE as i32 + WATER_REACH as i32 + 1, 2));
        assert!(w.covers(5, 2 + WATER_REACH as i32));
        assert!(!w.covers(5, 2 + WATER_REACH as i32 + 1));
    }

    #[test]
    fn a_pipe_without_a_pump_waters_nothing() {
        let mut s = city();
        assert_eq!(s.place_pipe(20, 20), ToolResult::Ok);
        assert!(!s.watered(20, 20));
        assert_eq!(s.place_pump(11, 20), ToolResult::Ok);
        assert!(s.watered(11, 20));
        assert!(!s.watered(20, 20), "not linked");
        for x in 12..20 {
            assert_eq!(s.place_pipe(x, 20), ToolResult::Ok);
        }
        assert!(s.watered(20, 20) && s.watered(22, 21) && !s.watered(22, 22));
    }

    #[test]
    fn costs_are_charged_and_the_preview_agrees() {
        let mut s = city();
        assert_eq!(s.pipe_preview(30, 30).cost, PIPE_COST);
        assert_eq!(s.pump_preview(11, 30).cost, PUMP_COST);
        assert_eq!(s.total_funds, 10_000);
        s.place_pipe(30, 30);
        s.place_pump(11, 30);
        assert_eq!(s.total_funds, 10_000 - i64::from(PIPE_COST + PUMP_COST));
        assert_eq!(s.pipe_preview(30, 30).cost, 0, "already there");
        assert_eq!(s.remove_pipe(30, 30), ToolResult::Ok);
        assert_eq!(s.total_funds, 10_000 - i64::from(PIPE_COST + PUMP_COST));
    }

    #[test]
    fn refusals_leave_the_city_untouched() {
        let mut s = city();
        s.total_funds = i64::from(PIPE_COST) - 1;
        assert_eq!(s.place_pipe(30, 30), ToolResult::NoMoney);
        s.total_funds = 10_000;
        assert_eq!(s.place_pipe(-1, 0), ToolResult::Failed);
        assert_eq!(s.place_pump(40, 40), ToolResult::Failed, "no water near");
        assert_eq!(s.place_pump(10, 40), ToolResult::Failed, "on the water");
        assert_eq!(s.place_pump(95, 40), ToolResult::Failed, "off the map");
        s.total_funds = i64::from(PUMP_COST) - 1;
        assert_eq!(s.place_pump(11, 40), ToolResult::NoMoney);
        assert_eq!(s.pump_preview(11, 40).result, ToolResult::NoMoney);
        assert!(s.water().is_empty());
        assert_eq!(s.total_funds, i64::from(PUMP_COST) - 1);
    }

    #[test]
    fn a_pump_needs_water_among_its_eight_neighbours() {
        let mut s = city();
        assert_eq!(s.place_pump(11, 5), ToolResult::Ok);
        assert_eq!(s.place_pump(11, 5), ToolResult::Failed, "twice");
        assert_eq!(s.place_pump(12, 5), ToolResult::Failed, "two tiles away");
        s.set_tile(20, 20, RIVER);
        assert_eq!(s.place_pump(21, 21), ToolResult::Ok, "diagonal");
    }

    #[test]
    fn at_most_max_pumps() {
        let mut s = city();
        s.total_funds = 1_000_000;
        for y in 0..MAX_PUMPS as i32 {
            assert_eq!(s.place_pump(11, y), ToolResult::Ok);
        }
        assert_eq!(s.pump_preview(11, 64).result, ToolResult::Failed);
        assert_eq!(s.place_pump(11, 64), ToolResult::Failed);
        assert_eq!(s.remove_pump(11, 0), ToolResult::Ok);
        assert_eq!(s.place_pump(11, 64), ToolResult::Ok);
    }

    #[test]
    fn removing_a_pump_leaves_its_pipe_and_removing_nothing_fails() {
        let mut s = city();
        s.place_pipe(11, 9);
        s.place_pump(11, 9);
        assert_eq!(s.remove_pipe(11, 9), ToolResult::Failed, "that is a pump");
        assert_eq!(s.remove_pump(11, 9), ToolResult::Ok);
        assert!(s.water().has_pipe(11, 9) && !s.water().has_pump(11, 9));
        assert_eq!(s.remove_pump(11, 9), ToolResult::Failed);
        assert_eq!(s.remove_pipe(11, 9), ToolResult::Ok);
        assert_eq!(s.remove_pipe(11, 9), ToolResult::Failed);
        assert!(s.water().is_empty());
    }

    #[test]
    fn with_the_rules_off_everything_is_refused_for_free() {
        let mut s = city();
        s.place_pump(11, 20);
        s.place_pipe(12, 20);
        s.set_water_rules(false);
        let funds = s.total_funds;
        assert_eq!(s.place_pipe(30, 30), ToolResult::Failed);
        assert_eq!(s.place_pump(11, 30), ToolResult::Failed);
        assert_eq!(s.remove_pipe(12, 20), ToolResult::Failed);
        assert_eq!(s.remove_pump(11, 20), ToolResult::Failed);
        assert_eq!(s.pipe_preview(30, 30).cost, 0);
        assert_eq!(s.pump_preview(11, 30).cost, 0);
        assert!(!s.watered(11, 20));
        assert_eq!(s.water_stats(), WaterStats::default());
        assert!(s.dry_zones().is_empty());
        assert_eq!(s.total_funds, funds);
        assert!(s.water().has_pipe(12, 20), "the network is kept");
    }

    #[test]
    fn the_layer_tells_pumps_fed_pipes_and_dry_pipes() {
        let mut s = city();
        s.place_pump(11, 5);
        s.place_pipe(12, 5);
        s.place_pipe(40, 40);
        let at = |layer: &[u8], x: i32, y: i32| layer[(x * 70 + y) as usize];
        let layer = s.water_layer();
        assert_eq!(layer.len(), 90 * 70);
        assert_eq!(
            (
                at(&layer, 11, 5),
                at(&layer, 12, 5),
                at(&layer, 40, 40),
                at(&layer, 1, 1)
            ),
            (3, 2, 1, 0)
        );
        s.set_water_rules(false);
        assert!(s.water_layer().iter().all(|&v| v == 0));
    }

    #[test]
    fn zone_kinds_follow_the_zone_ranges() {
        assert_eq!(zone_kind(FREEZ | ZONEBIT), Some(ZoneType::Residential));
        assert_eq!(zone_kind(FREEZ), None, "no zone bit");
        assert_eq!(zone_kind(HOSPITAL | ZONEBIT), None);
        assert_eq!(
            zone_kind(crate::tile_chars::COMCLR | ZONEBIT),
            Some(ZoneType::Commercial)
        );
        assert_eq!(
            zone_kind(crate::tile_chars::INDCLR | ZONEBIT),
            Some(ZoneType::Industrial)
        );
        assert_eq!(zone_kind(crate::tile_chars::POWERPLANT | ZONEBIT), None);
    }

    #[test]
    fn density_levels_count_tiers_from_zero() {
        let s = city();
        use crate::tile_chars::{COMCLR, CZB, INDCLR, IZB, RZB};
        assert_eq!(density_level(&s, FREEZ, ZoneType::Residential), 0);
        assert_eq!(density_level(&s, RZB, ZoneType::Residential), 1);
        assert_eq!(density_level(&s, RZB + 27, ZoneType::Residential), 4);
        assert_eq!(density_level(&s, COMCLR, ZoneType::Commercial), 0);
        assert_eq!(density_level(&s, CZB, ZoneType::Commercial), 1);
        assert_eq!(density_level(&s, INDCLR, ZoneType::Industrial), 0);
        assert_eq!(density_level(&s, IZB, ZoneType::Industrial), 1);
    }

    #[test]
    fn a_dry_zone_grows_below_the_ceiling_only() {
        use crate::tile_chars::RZB;
        let mut s = city();
        let pos = Position::new(30, 30);
        let tier = |t: i32| (RZB as i32 + 9 * (t - 1)) as Tile | ZONEBIT;
        s.set_tile(30, 30, FREEZ | ZONEBIT);
        assert!(s.ext_zone_can_grow(pos, ZoneType::Residential));
        s.set_tile(30, 30, tier(WATER_FREE_DENSITY));
        assert!(!s.ext_zone_can_grow(pos, ZoneType::Residential));
        s.set_tile(30, 30, tier(WATER_FREE_DENSITY - 1));
        assert!(s.ext_zone_can_grow(pos, ZoneType::Residential));
        s.set_tile(30, 30, tier(WATER_FREE_DENSITY));
        s.place_pump(11, 30);
        for x in 12..30 {
            s.place_pipe(x, 30);
        }
        assert!(s.ext_zone_can_grow(pos, ZoneType::Residential), "watered");
        s.set_water_rules(false);
        s.remove_pump(11, 30);
        assert!(s.ext_zone_can_grow(pos, ZoneType::Residential), "rules off");
    }

    #[test]
    fn stats_and_dry_zones_count_the_zone_centres() {
        let mut s = city();
        s.set_tile(15, 30, FREEZ | ZONEBIT);
        s.set_tile(60, 30, FREEZ | ZONEBIT);
        s.place_pump(11, 30);
        for x in 12..15 {
            s.place_pipe(x, 30);
        }
        let st = s.water_stats();
        assert_eq!((st.pumps, st.pipes), (1, 4));
        assert_eq!((st.watered_zones, st.unwatered_zones), (1, 1));
        assert_eq!(s.dry_zones(), vec![(60, 30)]);
    }
}
