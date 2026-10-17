//! Metro (docs/game-design-v02.md): stations and underground tunnels; traffic falls around the
//! linked stations and land value rises. Active when [`Extensions::transit_rules`] is on; with
//! the rule off every action below is refused (`Failed`, cost 0) and the hooks change nothing.
//!
//! # Data model (simple on purpose: later agent-based transit reuses it, docs/ia-simulation.md)
//! The whole network is the underground layer, one byte per tile ([`TUNNEL`] = 1, [`STATION`] = 2,
//! 0 = nothing; any other byte is ignored). A station is a tile of the layer, **not** a surface
//! tile: it never changes the surface tile map (no building is placed, nothing to bulldoze) and
//! the 2D and 3D views draw it from [`Simulation::transit_layer`]. It can be placed on any tile
//! that is not water (bare land, a road, a building: the metro is underground), and replaces a
//! tunnel tile if there is one. A tunnel tile also is a land tile (never water).
//!
//! A **line** is a connected set of tunnel and station tiles (4-neighbour connectivity). It is
//! *working* when it holds at least [`MIN_STATIONS_PER_LINE`] stations. The components are
//! computed by [`TransitNetwork::refresh`] with a flood fill that visits each tile once
//! (so at most `width * height` steps), after every change of the network and after a load; the
//! hooks only read the result.
//!
//! # Effects (integer arithmetic, no random number)
//! A tile is *covered* when it lies within [`STATION_RADIUS`] tiles (Euclidean distance, squared
//! integer compare) of a station of a working line. On a covered tile:
//! * [`traffic`]: the density loses [`TRAFFIC_CUT_PCT`] percent (rounded down);
//! * [`land_value`]: the value gains [`LAND_BONUS`] (the call site clamps to 1..=250).
//!
//! The metro has no running cost: only the build costs ([`TUNNEL_COST`] per tunnel tile,
//! [`STATION_COST`] per station). Removing is free and refunds nothing.
//!
//! The network is saved in its own chunk (the layer's bytes); [`TransitNetwork::decode`] refuses
//! a layer with more than [`MAX_STATIONS`] stations.

use crate::relief::is_water;
use crate::simulation::Simulation;
use crate::tile::LOMASK;
use crate::tool::{ToolPreview, ToolResult};
use crate::underground::UndergroundLayer;

/// Layer byte of a tunnel tile.
pub const TUNNEL: u8 = 1;
/// Layer byte of a station tile.
pub const STATION: u8 = 2;
/// Most stations a city can hold (placing one more is refused; a file with more is refused).
pub const MAX_STATIONS: usize = 64;
/// Stations a line needs to work.
pub const MIN_STATIONS_PER_LINE: usize = 2;
/// Reach of a station of a working line, in tiles.
pub const STATION_RADIUS: i32 = 8;
/// Percent of the traffic density removed on a covered tile.
pub const TRAFFIC_CUT_PCT: i32 = 40;
/// Land value added on a covered tile.
pub const LAND_BONUS: i32 = 12;
/// Dollars per tunnel tile.
pub const TUNNEL_COST: i32 = 50;
/// Dollars per station.
pub const STATION_COST: i32 = 500;

/// Codes of [`TransitNetwork::layer_codes`].
pub const CODE_NOTHING: u8 = 0;
pub const CODE_TUNNEL: u8 = 1;
pub const CODE_TUNNEL_WORKING: u8 = 2;
pub const CODE_STATION: u8 = 3;
pub const CODE_STATION_WORKING: u8 = 4;

/// What the player is told about the network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TransitStats {
    /// Station tiles.
    pub stations: i32,
    /// Tunnel tiles (stations not counted).
    pub tunnels: i32,
    /// Working lines: connected sets with at least [`MIN_STATIONS_PER_LINE`] stations.
    pub lines: i32,
    /// Tiles covered by a station of a working line.
    pub covered_tiles: i32,
}

/// The metro network of a city: stations and tunnels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransitNetwork {
    /// Underground tunnels and stations, one byte per tile ([`TUNNEL`], [`STATION`]). Code that
    /// writes it directly must call [`refresh`](TransitNetwork::refresh) afterwards.
    pub underground: UndergroundLayer,
    /// Derived by `refresh`: the stations (at most [`MAX_STATIONS`]), in tile order.
    stations: Vec<(i32, i32)>,
    /// Derived: per tile, on a working line. Empty while the network is empty.
    working: Vec<bool>,
    /// Derived: per tile, within reach of a station of a working line. Empty while empty.
    covered: Vec<bool>,
    stats: TransitStats,
}

fn is_network(byte: u8) -> bool {
    byte == TUNNEL || byte == STATION
}

impl TransitNetwork {
    /// An empty network for a `width` x `height` map.
    pub fn new(width: i32, height: i32) -> TransitNetwork {
        TransitNetwork {
            underground: UndergroundLayer::new(width, height),
            stations: Vec::new(),
            working: Vec::new(),
            covered: Vec::new(),
            stats: TransitStats::default(),
        }
    }

    /// Whether the network holds nothing (it then adds nothing to a saved file).
    pub fn is_empty(&self) -> bool {
        self.underground.is_empty()
    }

    /// The bytes of the transit chunk: the underground layer; nothing when the network is empty.
    pub fn encode(&self) -> Vec<u8> {
        self.underground.encode()
    }

    /// The network stored in `bytes` for a `width` x `height` map (empty: an empty network).
    /// `Err` when the bytes do not fit the map or hold more than [`MAX_STATIONS`] stations.
    pub fn decode(bytes: &[u8], width: i32, height: i32) -> Result<TransitNetwork, &'static str> {
        let underground = UndergroundLayer::from_raw(width, height, bytes)
            .ok_or("transit chunk does not match the map")?;
        let mut network = TransitNetwork::new(width, height);
        network.underground = underground;
        network.refresh();
        if network.stats.stations as usize > MAX_STATIONS {
            return Err("transit chunk holds too many stations");
        }
        Ok(network)
    }

    /// Recomputes the lines and the covered tiles from the layer. Each tile is visited once by
    /// the flood fill (at most `width * height` steps), each station marks at most
    /// `(2 * STATION_RADIUS + 1)^2` tiles, and there are at most [`MAX_STATIONS`] of them.
    pub fn refresh(&mut self) {
        self.stations.clear();
        self.working.clear();
        self.covered.clear();
        self.stats = TransitStats::default();
        if self.underground.is_empty() {
            return;
        }
        let (w, h) = (self.underground.width(), self.underground.height());
        let n = (w as usize) * (h as usize);
        let bytes = self.underground.as_slice();
        let mut seen = vec![false; n];
        let mut working = vec![false; n];
        let mut queue: Vec<usize> = Vec::new();
        let mut stats = TransitStats::default();
        for start in 0..n {
            let byte = bytes[start];
            if byte == TUNNEL {
                stats.tunnels += 1;
            } else if byte == STATION {
                stats.stations += 1;
                if self.stations.len() < MAX_STATIONS {
                    self.stations
                        .push(((start / h as usize) as i32, (start % h as usize) as i32));
                }
            }
            if !is_network(byte) || seen[start] {
                continue;
            }
            queue.clear();
            queue.push(start);
            seen[start] = true;
            let mut stations_in_line = 0;
            // every tile enters the queue once: the queue never holds more than `n` tiles
            for head in 0..n {
                let Some(&i) = queue.get(head) else { break };
                if bytes[i] == STATION {
                    stations_in_line += 1;
                }
                let (x, y) = (i / h as usize, i % h as usize);
                let around = [
                    (x > 0).then(|| i - h as usize),
                    (x + 1 < w as usize).then(|| i + h as usize),
                    (y > 0).then(|| i - 1),
                    (y + 1 < h as usize).then(|| i + 1),
                ];
                for j in around.into_iter().flatten() {
                    if is_network(bytes[j]) && !seen[j] {
                        seen[j] = true;
                        queue.push(j);
                    }
                }
            }
            if stations_in_line >= MIN_STATIONS_PER_LINE {
                stats.lines += 1;
                for &i in &queue {
                    working[i] = true;
                }
            }
        }
        if stats.stations == 0 && stats.tunnels == 0 {
            return; // bytes that are neither tunnel nor station: nothing to derive
        }
        let mut covered = vec![false; n];
        let r2 = STATION_RADIUS * STATION_RADIUS;
        for &(sx, sy) in &self.stations {
            if !working[(sx * h + sy) as usize] {
                continue;
            }
            for x in (sx - STATION_RADIUS).max(0)..=(sx + STATION_RADIUS).min(w - 1) {
                for y in (sy - STATION_RADIUS).max(0)..=(sy + STATION_RADIUS).min(h - 1) {
                    let (dx, dy) = (x - sx, y - sy);
                    if dx * dx + dy * dy <= r2 {
                        covered[(x * h + y) as usize] = true;
                    }
                }
            }
        }
        stats.covered_tiles = covered.iter().filter(|&&c| c).count() as i32;
        self.working = working;
        self.covered = covered;
        self.stats = stats;
    }

    /// The counts shown to the player.
    pub fn stats(&self) -> TransitStats {
        self.stats
    }

    /// The stations (at most [`MAX_STATIONS`]) as `(x, y)`, in tile order (x, then y).
    pub fn stations(&self) -> &[(i32, i32)] {
        &self.stations
    }

    fn index(&self, x: i32, y: i32) -> Option<usize> {
        let (w, h) = (self.underground.width(), self.underground.height());
        (x >= 0 && y >= 0 && x < w && y < h).then(|| (x * h + y) as usize)
    }

    /// Whether the tunnel or station at `(x, y)` is on a working line.
    pub fn is_working(&self, x: i32, y: i32) -> bool {
        self.index(x, y)
            .is_some_and(|i| self.working.get(i).copied().unwrap_or(false))
    }

    /// Whether `(x, y)` is within reach of a station of a working line.
    pub fn is_covered(&self, x: i32, y: i32) -> bool {
        self.index(x, y)
            .is_some_and(|i| self.covered.get(i).copied().unwrap_or(false))
    }

    /// One code per tile, in tile order (`x * height + y`): [`CODE_NOTHING`], [`CODE_TUNNEL`],
    /// [`CODE_TUNNEL_WORKING`], [`CODE_STATION`], [`CODE_STATION_WORKING`]. What the views draw.
    pub fn layer_codes(&self) -> Vec<u8> {
        let (w, h) = (self.underground.width(), self.underground.height());
        let mut out = vec![CODE_NOTHING; (w as usize) * (h as usize)];
        for (i, &byte) in self.underground.as_slice().iter().enumerate() {
            let working = self.working.get(i).copied().unwrap_or(false);
            out[i] = match (byte, working) {
                (TUNNEL, false) => CODE_TUNNEL,
                (TUNNEL, true) => CODE_TUNNEL_WORKING,
                (STATION, false) => CODE_STATION,
                (STATION, true) => CODE_STATION_WORKING,
                _ => CODE_NOTHING,
            };
        }
        out
    }
}

impl Simulation {
    /// Whether the metro rules are on (off by default: the engine then equals the original).
    pub fn transit_rules(&self) -> bool {
        self.extensions().transit_rules
    }

    /// Turns the metro rules on or off. The network is kept; it only acts while the rules are on.
    pub fn set_transit_rules(&mut self, on: bool) {
        self.extensions_mut().transit_rules = on;
    }

    /// The counts of the network (stations, tunnels, working lines, covered tiles).
    pub fn transit_stats(&self) -> TransitStats {
        self.transit().stats()
    }

    /// One code per tile for the views: see [`TransitNetwork::layer_codes`].
    pub fn transit_layer(&self) -> Vec<u8> {
        self.transit().layer_codes()
    }

    /// The layer byte at `(x, y)` when the metro may be built there (on the map, not water).
    fn metro_ground(&self, x: i32, y: i32) -> Option<u8> {
        let tile = self.tile(x, y)? & LOMASK;
        (!is_water(tile)).then(|| self.transit().underground.get(x, y))
    }

    fn metro_plan(&self, x: i32, y: i32, wanted: u8) -> ToolPreview {
        let refused = ToolPreview {
            result: ToolResult::Failed,
            cost: 0,
        };
        if !self.transit_rules() {
            return refused;
        }
        let Some(here) = self.metro_ground(x, y) else {
            return refused;
        };
        let (allowed, cost) = if wanted == STATION {
            (
                here != STATION
                    && (here == TUNNEL || here == 0)
                    && self.transit_stats().stations < MAX_STATIONS as i32,
                STATION_COST,
            )
        } else {
            (here == 0, TUNNEL_COST)
        };
        if !allowed {
            refused
        } else if self.total_funds < i64::from(cost) {
            ToolPreview {
                result: ToolResult::NoMoney,
                cost: 0,
            }
        } else {
            ToolPreview {
                result: ToolResult::Ok,
                cost,
            }
        }
    }

    fn metro_place(&mut self, x: i32, y: i32, wanted: u8) -> ToolResult {
        let plan = self.metro_plan(x, y, wanted);
        if plan.result == ToolResult::Ok {
            self.transit_mut().underground.set(x, y, wanted);
            self.transit_mut().refresh();
            self.spend(plan.cost);
        } else if self.transit_rules() {
            self.report_refusal(plan.result, x, y);
        }
        plan.result
    }

    fn metro_remove(&mut self, x: i32, y: i32, wanted: u8) -> ToolResult {
        if !self.transit_rules() || self.metro_ground(x, y) != Some(wanted) {
            return ToolResult::Failed;
        }
        self.transit_mut().underground.set(x, y, 0);
        self.transit_mut().refresh();
        ToolResult::Ok
    }

    /// Dry run of [`place_tunnel`](Simulation::place_tunnel): the result and the cost
    /// ([`TUNNEL_COST`]; 0 unless `Ok`). Changes nothing.
    pub fn tunnel_preview(&self, x: i32, y: i32) -> ToolPreview {
        self.metro_plan(x, y, TUNNEL)
    }

    /// Digs a tunnel tile at `(x, y)`: `Failed` with the rules off, off the map, under water or
    /// where a tunnel or station already is; `NoMoney` below [`TUNNEL_COST`].
    pub fn place_tunnel(&mut self, x: i32, y: i32) -> ToolResult {
        self.metro_place(x, y, TUNNEL)
    }

    /// Fills in a tunnel tile (free). `Failed` unless a tunnel (not a station) is there.
    pub fn remove_tunnel(&mut self, x: i32, y: i32) -> ToolResult {
        self.metro_remove(x, y, TUNNEL)
    }

    /// Dry run of [`place_station`](Simulation::place_station): result and [`STATION_COST`].
    pub fn station_preview(&self, x: i32, y: i32) -> ToolPreview {
        self.metro_plan(x, y, STATION)
    }

    /// Builds a station at `(x, y)` (replacing a tunnel tile there): `Failed` with the rules off,
    /// off the map, under water, on a station, or when [`MAX_STATIONS`] stand already; `NoMoney`
    /// below [`STATION_COST`]. The surface tile is not changed.
    pub fn place_station(&mut self, x: i32, y: i32) -> ToolResult {
        self.metro_place(x, y, STATION)
    }

    /// Removes the station at `(x, y)` (free, the tile becomes empty). `Failed` unless one is there.
    pub fn remove_station(&mut self, x: i32, y: i32) -> ToolResult {
        self.metro_remove(x, y, STATION)
    }
}

/// Net cost of the metro for one tax collection, in dollars (a cost is positive).
pub(crate) fn monthly_balance(_sim: &Simulation) -> i32 {
    0
}

/// Land value `v` (1..=250) at world tile `(x, y)`, after the metro.
pub(crate) fn land_value(sim: &Simulation, x: i32, y: i32, v: i32) -> i32 {
    if sim.transit_rules() && sim.transit().is_covered(x, y) {
        v + LAND_BONUS
    } else {
        v
    }
}

/// Traffic density `t` (0..=255) at world tile `(x, y)`, after the metro.
pub(crate) fn traffic(sim: &Simulation, x: i32, y: i32, t: i32) -> i32 {
    if sim.transit_rules() && sim.transit().is_covered(x, y) {
        t - t * TRAFFIC_CUT_PCT / 100
    } else {
        t
    }
}

/// Adjusts the zoning valves after `set_valves` computed them.
pub(crate) fn valves(_sim: &mut Simulation) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile_chars::DIRT;

    /// A bare 80 x 67 city with the rules on and plenty of money, all land (no water).
    fn city() -> Simulation {
        let mut s = Simulation::new(80, 67);
        for x in 0..80 {
            for y in 0..67 {
                s.set_tile(x, y, DIRT);
            }
        }
        s.set_transit_rules(true);
        s.total_funds = 1_000_000;
        s
    }

    /// Tunnels from `(x0, y)` to `(x1, y)` with a station at each end.
    fn line(s: &mut Simulation, x0: i32, x1: i32, y: i32) {
        for x in x0..=x1 {
            assert_eq!(s.place_tunnel(x, y), ToolResult::Ok);
        }
        assert_eq!(s.place_station(x0, y), ToolResult::Ok);
        assert_eq!(s.place_station(x1, y), ToolResult::Ok);
    }

    #[test]
    fn an_empty_network_encodes_to_nothing_and_round_trips_with_tunnels() {
        let mut t = TransitNetwork::new(80, 67);
        assert!(t.is_empty() && t.encode().is_empty());
        assert_eq!(TransitNetwork::decode(&[], 80, 67), Ok(t.clone()));
        t.underground.set(9, 9, 3);
        let bytes = t.encode();
        assert_eq!(TransitNetwork::decode(&bytes, 80, 67), Ok(t));
        assert!(TransitNetwork::decode(&[1, 2], 80, 67).is_err());
    }

    #[test]
    fn the_rules_are_off_by_default_and_everything_is_refused_with_them_off() {
        let mut s = Simulation::new(80, 67);
        s.total_funds = 100_000;
        assert!(!s.transit_rules());
        assert_eq!(s.place_tunnel(5, 5), ToolResult::Failed);
        assert_eq!(s.place_station(5, 5), ToolResult::Failed);
        assert_eq!(s.remove_tunnel(5, 5), ToolResult::Failed);
        assert_eq!(s.remove_station(5, 5), ToolResult::Failed);
        for p in [s.tunnel_preview(5, 5), s.station_preview(5, 5)] {
            assert_eq!((p.result, p.cost), (ToolResult::Failed, 0));
        }
        assert!(s.transit().is_empty());
        assert_eq!(s.total_funds, 100_000);
        // a network that exists stays frozen: nothing is removable with the rules off
        s.set_transit_rules(true);
        assert_eq!(s.place_tunnel(5, 5), ToolResult::Ok);
        s.set_transit_rules(false);
        assert_eq!(s.remove_tunnel(5, 5), ToolResult::Failed);
        assert_eq!(s.transit().underground.get(5, 5), TUNNEL);
    }

    #[test]
    fn placing_costs_its_price_and_a_preview_changes_nothing() {
        let mut s = city();
        let funds = s.total_funds;
        let p = s.tunnel_preview(10, 10);
        assert_eq!((p.result, p.cost), (ToolResult::Ok, TUNNEL_COST));
        assert_eq!(s.total_funds, funds);
        assert!(s.transit().is_empty());
        assert_eq!(s.place_tunnel(10, 10), ToolResult::Ok);
        assert_eq!(s.total_funds, funds - i64::from(TUNNEL_COST));
        let p = s.station_preview(10, 10);
        assert_eq!((p.result, p.cost), (ToolResult::Ok, STATION_COST));
        assert_eq!(s.place_station(10, 10), ToolResult::Ok);
        assert_eq!(s.total_funds, funds - i64::from(TUNNEL_COST + STATION_COST));
        // the station replaced the tunnel tile; the surface did not change
        assert_eq!(s.transit().underground.get(10, 10), STATION);
        assert_eq!(s.tile(10, 10), Some(DIRT));
        let stats = s.transit_stats();
        assert_eq!((stats.stations, stats.tunnels), (1, 0));
    }

    #[test]
    fn refusals_leave_the_city_untouched() {
        let mut s = city();
        s.set_tile(3, 3, crate::tile_chars::RIVER);
        let funds = s.total_funds;
        assert_eq!(s.place_tunnel(3, 3), ToolResult::Failed, "water");
        assert_eq!(s.place_station(3, 3), ToolResult::Failed, "water");
        assert_eq!(s.place_tunnel(-1, 0), ToolResult::Failed, "off the map");
        assert_eq!(s.place_station(80, 0), ToolResult::Failed, "off the map");
        assert_eq!(s.place_tunnel(6, 6), ToolResult::Ok);
        assert_eq!(s.place_tunnel(6, 6), ToolResult::Failed, "already a tunnel");
        assert_eq!(s.place_station(6, 6), ToolResult::Ok);
        assert_eq!(
            s.place_station(6, 6),
            ToolResult::Failed,
            "already a station"
        );
        assert_eq!(
            s.place_tunnel(6, 6),
            ToolResult::Failed,
            "a station is there"
        );
        assert_eq!(
            s.remove_tunnel(6, 6),
            ToolResult::Failed,
            "that is a station"
        );
        assert_eq!(s.remove_station(7, 7), ToolResult::Failed, "nothing there");
        assert_eq!(s.total_funds, funds - i64::from(TUNNEL_COST + STATION_COST));
        s.total_funds = i64::from(TUNNEL_COST) - 1;
        let p = s.tunnel_preview(20, 20);
        assert_eq!((p.result, p.cost), (ToolResult::NoMoney, 0));
        assert_eq!(s.place_tunnel(20, 20), ToolResult::NoMoney);
        assert_eq!(s.transit().underground.get(20, 20), 0);
    }

    #[test]
    fn removing_is_free_and_frees_the_tile() {
        let mut s = city();
        assert_eq!(s.place_tunnel(8, 8), ToolResult::Ok);
        assert_eq!(s.place_station(9, 8), ToolResult::Ok);
        let funds = s.total_funds;
        assert_eq!(s.remove_tunnel(8, 8), ToolResult::Ok);
        assert_eq!(s.remove_station(9, 8), ToolResult::Ok);
        assert_eq!(s.total_funds, funds);
        assert!(s.transit().is_empty());
        assert_eq!(s.transit_stats(), TransitStats::default());
    }

    #[test]
    fn stations_are_capped() {
        let mut s = city();
        for i in 0..MAX_STATIONS as i32 {
            assert_eq!(s.place_station(i, 0), ToolResult::Ok);
        }
        assert_eq!(s.place_station(0, 5), ToolResult::Failed);
        let p = s.station_preview(0, 5);
        assert_eq!((p.result, p.cost), (ToolResult::Failed, 0));
        // a file with one more is refused
        let mut t = s.transit().clone();
        t.underground.set(0, 5, STATION);
        assert!(TransitNetwork::decode(&t.encode(), 80, 67).is_err());
        assert!(TransitNetwork::decode(&s.transit().encode(), 80, 67).is_ok());
    }

    #[test]
    fn a_line_works_with_two_stations_linked_by_tunnels() {
        let mut s = city();
        assert_eq!(s.place_station(10, 10), ToolResult::Ok);
        assert_eq!(s.transit_stats().lines, 0, "one station alone is no line");
        assert_eq!(s.place_station(14, 10), ToolResult::Ok);
        assert_eq!(s.transit_stats().lines, 0, "two stations, no tunnel");
        for x in 11..14 {
            s.place_tunnel(x, 10);
        }
        let st = s.transit_stats();
        assert_eq!((st.stations, st.tunnels, st.lines), (2, 3, 1));
        assert!(st.covered_tiles > 0);
        let codes = s.transit_layer();
        let at = |x: i32, y: i32| codes[(x * 67 + y) as usize];
        assert_eq!(at(10, 10), CODE_STATION_WORKING);
        assert_eq!(at(12, 10), CODE_TUNNEL_WORKING);
        assert_eq!(at(0, 0), CODE_NOTHING);
        // cutting the line in the middle stops it working
        assert_eq!(s.remove_tunnel(12, 10), ToolResult::Ok);
        let st = s.transit_stats();
        assert_eq!((st.lines, st.covered_tiles), (0, 0));
        assert_eq!(s.transit_layer()[(10 * 67 + 10) as usize], CODE_STATION);
        assert_eq!(s.transit_layer()[(11 * 67 + 10) as usize], CODE_TUNNEL);
    }

    #[test]
    fn components_are_counted_by_four_neighbour_connectivity() {
        let mut s = city();
        line(&mut s, 5, 9, 5); // line one
        line(&mut s, 5, 9, 7); // line two, two rows away: not adjacent
        assert_eq!(s.transit_stats().lines, 2);
        // a diagonal touch does not connect
        assert_eq!(s.place_tunnel(10, 6), ToolResult::Ok);
        assert_eq!(s.transit_stats().lines, 2);
        // a tunnel between the two rows joins them into one line of four stations
        assert_eq!(s.place_tunnel(5, 6), ToolResult::Ok);
        let st = s.transit_stats();
        assert_eq!((st.lines, st.stations), (1, 4));
        // a lone tunnel far away is no line and has no station
        assert_eq!(s.place_tunnel(60, 60), ToolResult::Ok);
        assert_eq!(s.transit_stats().lines, 1);
        assert_eq!(s.transit_layer()[(60 * 67 + 60) as usize], CODE_TUNNEL);
    }

    #[test]
    fn the_flood_fill_is_bounded_on_a_full_map() {
        // every tile is a tunnel: one component, found in one pass (the bound is width * height)
        let mut t = TransitNetwork::new(100, 90);
        for x in 0..100 {
            for y in 0..90 {
                t.underground.set(x, y, TUNNEL);
            }
        }
        t.underground.set(0, 0, STATION);
        t.underground.set(99, 89, STATION);
        t.refresh();
        let st = t.stats();
        assert_eq!((st.lines, st.stations, st.tunnels), (1, 2, 100 * 90 - 2));
        // a checkerboard: no two tiles touch, so no line at all
        let mut c = TransitNetwork::new(100, 90);
        for x in 0..100 {
            for y in 0..90 {
                if (x + y) % 2 == 0 {
                    c.underground.set(
                        x,
                        y,
                        if x % 4 == 0 && y == 0 {
                            STATION
                        } else {
                            TUNNEL
                        },
                    );
                }
            }
        }
        c.refresh();
        assert_eq!(c.stats().lines, 0);
    }

    #[test]
    fn reach_is_a_disc_of_station_radius_around_the_stations_of_a_working_line() {
        let mut s = city();
        line(&mut s, 30, 34, 30);
        let net = s.transit();
        let r = STATION_RADIUS;
        assert!(net.is_covered(30, 30) && net.is_covered(34, 30));
        assert!(net.is_covered(30 - r, 30), "on the radius");
        assert!(!net.is_covered(30 - r - 1, 30), "just outside");
        assert!(
            !net.is_covered(30 - r + 1, 30 - r + 1),
            "corner of the square"
        );
        assert!(net.is_covered(34 + r, 30));
        assert!(!net.is_covered(34 + r + 1, 30));
        assert!(!net.is_covered(30, 30 + r + 1));
        assert!(!net.is_covered(-1, 0) && !net.is_covered(200, 200));
        // the two discs overlap in the middle: counted once
        let covered = s.transit_stats().covered_tiles;
        let mut by_hand = 0;
        for x in 0..80i32 {
            for y in 0..67i32 {
                let near = |sx: i32| (x - sx).pow(2) + (y - 30).pow(2) <= r * r;
                if near(30) || near(34) {
                    by_hand += 1;
                }
            }
        }
        assert_eq!(covered, by_hand);
    }

    #[test]
    fn traffic_and_land_value_follow_the_hooks_with_fixed_inputs() {
        let mut s = city();
        line(&mut s, 30, 34, 30);
        // inside the reach
        assert_eq!(
            s.ext_traffic(32, 32, 200),
            200 - 200 * TRAFFIC_CUT_PCT / 100
        );
        assert_eq!(s.ext_traffic(32, 32, 3), 3 - 3 * TRAFFIC_CUT_PCT / 100);
        assert_eq!(s.ext_land_value(32, 32, 100), 100 + LAND_BONUS);
        // outside it
        assert_eq!(s.ext_traffic(60, 60, 200), 200);
        assert_eq!(s.ext_land_value(60, 60, 100), 100);
        // a lone station reaches nothing
        let mut lone = city();
        lone.place_station(30, 30);
        assert_eq!(lone.ext_traffic(30, 30, 200), 200);
        assert_eq!(lone.ext_land_value(30, 30, 100), 100);
        // rules off: the network stays but the hooks change nothing (another rule keeps hooks live)
        s.set_transit_rules(false);
        s.extensions_mut().water_rules = true;
        assert_eq!(s.ext_traffic(32, 32, 200), 200);
        assert_eq!(s.ext_land_value(32, 32, 100), 100);
    }

    #[test]
    fn the_network_survives_encode_and_decode_with_its_lines() {
        let mut s = city();
        line(&mut s, 12, 20, 40);
        s.place_tunnel(50, 50);
        let bytes = s.transit().encode();
        let back = TransitNetwork::decode(&bytes, 80, 67).unwrap();
        assert_eq!(&back, s.transit());
        assert_eq!(back.stats(), s.transit_stats());
        assert_eq!(back.stations(), s.transit().stations());
        assert_eq!(back.layer_codes(), s.transit_layer());
    }

    #[test]
    fn a_new_city_starts_without_a_network() {
        let mut s = city();
        line(&mut s, 12, 20, 40);
        s.new_random_city(3);
        assert!(s.transit().is_empty() && s.transit_stats() == TransitStats::default());
    }
}
