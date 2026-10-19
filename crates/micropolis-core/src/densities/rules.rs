//! The rules of the densities on a [`Simulation`]: placing and previewing a zone, the growth
//! cap, the consistency between the records and the map, and the views the adapter reads. See
//! the module documentation of [`crate::densities`].

use super::{
    zone_genre, DENSITY_CAP, DENSITY_COST_PCT, DENSITY_DENSE, DENSITY_LIGHT, GENRE_COMMERCIAL,
    GENRE_INDUSTRIAL, GENRE_RESIDENTIAL, LAYER_FARM, MAX_DENSITY_ZONES,
};
use crate::position::Position;
use crate::simulation::Simulation;
use crate::tile::{Tile, LOMASK};
use crate::tile_chars::FREEZ;
use crate::tool::{EditingTool, ToolPreview, ToolResult};
use crate::traffic::ZoneType;

/// Numbers of [`Simulation::density_stats`].
pub const STATS_SIZE: usize = 5;

/// The classic tool that makes a zone of `genre`.
fn tool_of(genre: u8) -> Option<EditingTool> {
    match genre {
        GENRE_RESIDENTIAL => Some(EditingTool::Residential),
        GENRE_COMMERCIAL => Some(EditingTool::Commercial),
        GENRE_INDUSTRIAL => Some(EditingTool::Industrial),
        _ => None,
    }
}

fn genre_of_kind(kind: ZoneType) -> u8 {
    match kind {
        ZoneType::Residential => GENRE_RESIDENTIAL,
        ZoneType::Commercial => GENRE_COMMERCIAL,
        ZoneType::Industrial => GENRE_INDUSTRIAL,
    }
}

fn is_density(density: u8) -> bool {
    (DENSITY_LIGHT..=DENSITY_DENSE).contains(&density)
}

/// What a zone of `tool` costs less than the classic price at `density`.
fn discount(tool: EditingTool, density: u8) -> i32 {
    let classic = tool.cost();
    classic - classic * DENSITY_COST_PCT[usize::from(density) - 1] / 100
}

impl Simulation {
    /// Whether the zoning densities are on (off by default: the engine is the original).
    pub fn density_rules(&self) -> bool {
        self.extensions().densities
    }

    /// Turns the densities on or off. Off forgets every record (all zones are dense again) and
    /// every farm.
    pub fn set_density_rules(&mut self, on: bool) {
        self.extensions_mut().densities = on;
        self.repair_densities();
        self.recompute_farms();
    }

    /// The density of the zone centred on `(x, y)`: its record, or dense.
    pub fn zone_density(&self, x: i32, y: i32) -> u8 {
        self.extensions()
            .density_zones
            .get(x, y)
            .unwrap_or(DENSITY_DENSE)
    }

    /// Dry run of [`place_zone`](Self::place_zone): the result and, when `Ok`, the cost.
    pub fn zone_preview(&self, genre: u8, density: u8, x: i32, y: i32) -> ToolPreview {
        let refused = ToolPreview {
            result: ToolResult::Failed,
            cost: 0,
        };
        let Some(tool) = self.zone_tool(genre, density, x, y) else {
            return refused;
        };
        let credit = discount(tool, density);
        let mut p = self.tool_preview(tool, x, y);
        if p.result == ToolResult::NoMoney && credit > 0 {
            // the classic check wants the full price: ask again with the discount in the funds
            let mut probe = self.clone();
            probe.total_funds += i64::from(credit);
            p = probe.tool_preview(tool, x, y);
        }
        if p.result == ToolResult::Ok {
            p.cost = (p.cost - credit).max(0);
        }
        p
    }

    /// Builds a zone of `genre` and `density` whose centre tile is `(x, y)`, with the classic
    /// zone tool (same terrain, water and bulldozer rules), then records the density. The zone
    /// costs [`DENSITY_COST_PCT`] of the classic price. `Failed`: rules off, unknown genre or
    /// density, the list of [`MAX_DENSITY_ZONES`] is full, or the classic tool refuses.
    pub fn place_zone(&mut self, genre: u8, density: u8, x: i32, y: i32) -> ToolResult {
        let Some(tool) = self.zone_tool(genre, density, x, y) else {
            return ToolResult::Failed;
        };
        self.repair_densities();
        let credit = i64::from(discount(tool, density));
        self.total_funds += credit; // the classic tool asks the full price: net charge is lower
        let result = self.tool_down(tool, x, y);
        if result != ToolResult::Ok {
            self.total_funds -= credit;
            return result;
        }
        if density == DENSITY_DENSE {
            self.extensions_mut().density_zones.remove(x, y);
        } else {
            self.extensions_mut().density_zones.set(x, y, density);
        }
        result
    }

    /// The classic tool for a request, or `None` when the request is refused whatever the map.
    fn zone_tool(&self, genre: u8, density: u8, x: i32, y: i32) -> Option<EditingTool> {
        let list = &self.extensions().density_zones;
        let full = list.len() >= MAX_DENSITY_ZONES && list.get(x, y).is_none();
        if !self.density_rules() || !is_density(density) || (full && density != DENSITY_DENSE) {
            return None;
        }
        tool_of(genre)
    }

    /// Drops the records whose centre is no longer a zone centre, and all of them with the rules
    /// off (the farms are rebuilt when one goes). Returns whether a record was dropped.
    pub fn repair_densities(&mut self) -> bool {
        let before = self.extensions().density_zones.len();
        let mut zones = std::mem::take(&mut self.extensions_mut().density_zones);
        let rules = self.density_rules();
        zones.retain(|r| rules && self.tile(r.x, r.y).and_then(zone_genre).is_some());
        let changed = zones.len() != before;
        self.extensions_mut().density_zones = zones;
        if changed {
            self.recompute_farms();
        }
        changed
    }

    /// The classic population of the zone centred on `pos` (`tile` is its centre tile).
    fn zone_population(&self, pos: Position, tile: Tile, genre: u8) -> i32 {
        let tile = tile & LOMASK;
        i32::from(match genre {
            GENRE_RESIDENTIAL if tile == FREEZ => self.do_free_pop(pos),
            GENRE_RESIDENTIAL => self.get_res_zone_pop(tile),
            GENRE_COMMERCIAL => self.get_com_zone_pop(tile),
            _ => self.get_ind_zone_pop(tile),
        })
    }

    /// One byte per tile (`x * height + y`): the density (1-3) on the nine tiles of every zone
    /// (3 for a zone without record), 4 on those of a farm, 0 elsewhere. All 0 with the rules
    /// off.
    pub fn density_layer(&self) -> Vec<u8> {
        let (w, h) = self.world_size();
        let mut layer = vec![0u8; (w as usize) * (h as usize)];
        for (x, y, _, density, farm) in self.zones_on_map() {
            let value = if farm { LAYER_FARM } else { density };
            for (tx, ty) in (x - 1..=x + 1).flat_map(|tx| (y - 1..=y + 1).map(move |ty| (tx, ty))) {
                if self.on_map(tx, ty) {
                    layer[(tx * h + ty) as usize] = value;
                }
            }
        }
        layer
    }

    /// `[light zones, medium zones, dense zones, farms, agricultural jobs]` (a farm is also a
    /// light zone; the jobs are the industrial zone population of the farms). All 0 with the
    /// rules off.
    pub fn density_stats(&self) -> [i32; STATS_SIZE] {
        let mut stats = [0; STATS_SIZE];
        for (_, _, tile, density, farm) in self.zones_on_map() {
            stats[usize::from(density) - 1] += 1;
            if farm {
                stats[3] += 1;
                stats[4] += i32::from(self.get_ind_zone_pop(tile & LOMASK));
            }
        }
        stats
    }

    /// Every residential, commercial or industrial zone of the map: centre, centre tile,
    /// density, farm. Empty with the rules off. Bounded by the map size.
    fn zones_on_map(&self) -> Vec<(i32, i32, Tile, u8, bool)> {
        let (w, h) = self.world_size();
        let mut out = Vec::new();
        if !self.density_rules() {
            return out;
        }
        for x in 0..w {
            for y in 0..h {
                let tile = self.tile(x, y).unwrap_or(0);
                if zone_genre(tile).is_some() {
                    let farm = self.extensions().farms.contains(x, y);
                    out.push((x, y, tile, self.zone_density(x, y), farm));
                }
            }
        }
        out
    }
}

/// Whether a zone of `kind` centred on `pos` may grow: its classic population is below the cap of
/// its density. A dense zone (the classic ones) always may.
pub(crate) fn zone_can_grow(sim: &Simulation, pos: Position, kind: ZoneType) -> bool {
    if !sim.density_rules() {
        return true;
    }
    let density = sim.zone_density(pos.x, pos.y);
    if density == DENSITY_DENSE {
        return true;
    }
    let genre = genre_of_kind(kind);
    let tile = sim.tile(pos.x, pos.y).unwrap_or(0);
    let cap = DENSITY_CAP[usize::from(genre) - 1][usize::from(density) - 1];
    sim.zone_population(pos, tile, genre) < cap
}
