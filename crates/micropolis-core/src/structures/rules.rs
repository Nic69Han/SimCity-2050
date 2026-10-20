//! The rules of the extended buildings on a [`Simulation`]: placing, removing, previewing, the
//! consistency between the list and the map, and the views the adapter reads. See the module
//! documentation of [`crate::structures`].

use super::{
    is_surface, kind_of, Kind, Structure, FLAG_POWER, FLAG_WATER, MAX_STRUCTURES, SURFACE_BITS,
};
use crate::agents::graph::{classify, CLASS_ROAD};
use crate::agents::transport::rail::is_rail;
use crate::relief::is_water;
use crate::services::is_service_genre;
use crate::simulation::Simulation;
use crate::tile::{Tile, LOMASK, PWRBIT};
use crate::tile_chars::DIRT;
use crate::tool::{ToolPreview, ToolResult};

/// State bit: a tile of the building is powered.
pub const STATE_POWERED: u8 = 0b01;
/// State bit: a tile of the building is watered (never with the water rules off).
pub const STATE_WATERED: u8 = 0b10;

/// A listed, intact building as the adapter shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StructureView {
    pub genre: u8,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    /// [`STATE_POWERED`] | [`STATE_WATERED`].
    pub state: u8,
}

impl Simulation {
    /// Whether the extended buildings are on (off by default: the engine is the original).
    pub fn structure_rules(&self) -> bool {
        self.extensions().structures
    }

    /// Turns the extended buildings on or off. Off removes every building (and its surface
    /// tiles), without refund.
    pub fn set_structure_rules(&mut self, on: bool) {
        self.extensions_mut().structures = on;
        if !on {
            let all = self.extensions().structure_list.as_slice().to_vec();
            self.drop_structures(&all);
        }
    }

    /// The listed buildings that are intact, oldest first.
    pub fn structures(&self) -> Vec<StructureView> {
        if !self.structure_rules() {
            return Vec::new();
        }
        let list = self.extensions().structure_list.as_slice();
        list.iter()
            .filter(|s| self.is_intact(s))
            .map(|s| {
                let k = s.kind();
                StructureView {
                    genre: s.genre,
                    x: s.x,
                    y: s.y,
                    width: k.width,
                    height: k.height,
                    state: self.structure_state(s),
                }
            })
            .collect()
    }

    /// Monthly upkeep of the intact buildings, in dollars.
    pub fn structures_upkeep(&self) -> i32 {
        if !self.structure_rules() {
            return 0;
        }
        let list = self.extensions().structure_list.as_slice();
        list.iter()
            .filter(|s| self.is_intact(s))
            .fold(0i32, |sum, s| sum.saturating_add(s.kind().upkeep))
    }

    /// Dry run of [`place_structure`](Self::place_structure): the result and, when `Ok`, the cost.
    pub fn structure_preview(&self, genre: u8, x: i32, y: i32) -> ToolPreview {
        let result = self.plan_structure(genre, x, y);
        let cost = match kind_of(genre) {
            Some(k) if result == ToolResult::Ok => k.cost,
            _ => 0,
        };
        ToolPreview { result, cost }
    }

    /// Builds a building of `genre` whose top-left tile is `(x, y)`. `Failed`: rules off, unknown
    /// genre, footprint off the map or on water, [`MAX_STRUCTURES`] reached. `NeedBulldoze`: a
    /// footprint tile is not bare land. `NoMoney`: the funds do not cover the cost.
    pub fn place_structure(&mut self, genre: u8, x: i32, y: i32) -> ToolResult {
        self.repair_structures();
        let result = self.plan_structure(genre, x, y);
        if let (ToolResult::Ok, Some(kind)) = (result, kind_of(genre)) {
            self.spend(kind.cost);
            let s = Structure { genre, x, y };
            for (tx, ty) in s.tiles() {
                self.set_tile(tx, ty, kind.surface() | SURFACE_BITS);
            }
            self.extensions_mut().structure_list.push(s);
        }
        self.finish_structure_tool(result, x, y)
    }

    /// Removes the building that has tile `(x, y)` in its footprint, free of charge. `Failed`
    /// when there is none or the rules are off.
    pub fn remove_structure(&mut self, x: i32, y: i32) -> ToolResult {
        self.repair_structures();
        let found = self.extensions().structure_list.find_at(x, y);
        let result = match found {
            Some(s) if self.structure_rules() => {
                self.drop_structures(&[s]);
                ToolResult::Ok
            }
            _ => ToolResult::Failed,
        };
        self.finish_structure_tool(result, x, y)
    }

    /// Makes the list and the map agree: a building with a tile that is no longer its surface
    /// (bulldozed, burnt, flooded, replaced) is dropped and its remaining surface tiles are
    /// cleared. With the rules off every building is dropped. Returns whether anything changed.
    pub fn repair_structures(&mut self) -> bool {
        let rules = self.structure_rules();
        let doomed: Vec<Structure> = self
            .extensions()
            .structure_list
            .as_slice()
            .iter()
            .copied()
            .filter(|s| !rules || !self.is_intact(s) || self.is_orphan_service(s))
            .collect();
        self.drop_structures(&doomed)
    }

    /// [`repair_structures`](Self::repair_structures), then clears every surface tile that no
    /// listed building owns (a loaded file, the monthly check). The scan is bounded by the map.
    pub(crate) fn repair_structures_fully(&mut self) -> bool {
        let mut changed = self.repair_structures();
        let (w, h) = self.world_size();
        for x in 0..w {
            for y in 0..h {
                let owned = self.extensions().structure_list.find_at(x, y).is_some();
                let surface = self.tile(x, y).is_some_and(|t| is_surface(t & LOMASK));
                if surface && !owned {
                    self.set_tile(x, y, DIRT);
                    changed = true;
                }
            }
        }
        if changed {
            self.tool_invalidate_maps();
        }
        changed
    }

    /// Whether the building has its effect: powered when it needs power, watered when it needs
    /// water and the water rules are on. A broken building has none.
    pub(crate) fn structure_works(&self, s: &Structure) -> bool {
        let k = s.kind();
        let anchor_ok = self.tile(s.x, s.y).is_some_and(|t| is_surface(t & LOMASK));
        let state = self.structure_state(s);
        anchor_ok
            && (k.flags & FLAG_POWER == 0 || state & STATE_POWERED != 0)
            && (k.flags & FLAG_WATER == 0 || !self.water_rules() || state & STATE_WATERED != 0)
    }

    fn structure_state(&self, s: &Structure) -> u8 {
        let tiles = s.tiles();
        let powered = tiles
            .iter()
            .any(|&(x, y)| self.tile(x, y).is_some_and(|t| t & PWRBIT != 0));
        let watered = tiles.iter().any(|&(x, y)| self.watered(x, y));
        (if powered { STATE_POWERED } else { 0 }) | (if watered { STATE_WATERED } else { 0 })
    }

    /// Every tile of the footprint still holds a surface tile (the list says whose it is).
    fn is_intact(&self, s: &Structure) -> bool {
        s.tiles()
            .iter()
            .all(|&(x, y)| self.tile(x, y).is_some_and(|t| is_surface(t & LOMASK)))
    }

    /// Drops the `doomed` buildings from the list, clearing their surface tiles.
    fn drop_structures(&mut self, doomed: &[Structure]) -> bool {
        for s in doomed {
            self.clear_surface(s);
        }
        self.extensions_mut()
            .structure_list
            .retain(|s| !doomed.contains(s));
        if !doomed.is_empty() {
            self.tool_invalidate_maps();
        }
        !doomed.is_empty()
    }

    /// Bare land under every footprint tile that still holds the building's surface.
    fn clear_surface(&mut self, s: &Structure) {
        for (x, y) in s.tiles() {
            if self.tile(x, y).is_some_and(|t| is_surface(t & LOMASK)) {
                self.set_tile(x, y, DIRT);
            }
        }
    }

    fn plan_structure(&self, genre: u8, x: i32, y: i32) -> ToolResult {
        let list = &self.extensions().structure_list;
        let Some(kind) = kind_of(genre) else {
            return ToolResult::Failed;
        };
        if !self.structure_rules()
            || (is_service_genre(genre) && !self.service_rules())
            || list.len() >= MAX_STRUCTURES
            || !self.fits_on_map(kind, x, y)
        {
            return ToolResult::Failed;
        }
        let site = Structure { genre, x, y };
        let tiles: Vec<Tile> = site
            .tiles()
            .iter()
            .filter_map(|&(tx, ty)| self.tile(tx, ty))
            .collect();
        let no_road = kind.needs_road && !self.touches(&site, |t| classify(t) == CLASS_ROAD);
        let no_rail = kind.needs_rail && !self.touches(&site, is_rail);
        if tiles.iter().any(|&t| is_water(t)) || no_road || no_rail {
            return ToolResult::Failed;
        }
        if tiles.iter().any(|&t| t & LOMASK != DIRT) {
            return ToolResult::NeedBulldoze;
        }
        if self.total_funds < i64::from(kind.cost) {
            return ToolResult::NoMoney;
        }
        ToolResult::Ok
    }

    /// Whether a tile accepted by `wanted` lies next to a side of the footprint (the four
    /// neighbours of a 1 x 1).
    fn touches(&self, site: &Structure, wanted: fn(Tile) -> bool) -> bool {
        let k = site.kind();
        let ring = (-1..=k.width)
            .flat_map(|dx| (-1..=k.height).map(move |dy| (dx, dy)))
            .filter(|&(dx, dy)| (dx < 0 || dx >= k.width) != (dy < 0 || dy >= k.height))
            .map(|(dx, dy)| (site.x + dx, site.y + dy));
        ring.filter_map(|(x, y)| self.tile(x, y)).any(wanted)
    }

    /// A public service building while the services are off (it cannot be built then).
    fn is_orphan_service(&self, s: &Structure) -> bool {
        is_service_genre(s.genre) && !self.service_rules()
    }

    fn fits_on_map(&self, kind: &Kind, x: i32, y: i32) -> bool {
        self.on_map(x, y) && self.on_map(x + kind.width - 1, y + kind.height - 1)
    }

    /// What every tool of the buildings does last, as the water tools do.
    fn finish_structure_tool(&mut self, result: ToolResult, x: i32, y: i32) -> ToolResult {
        self.report_refusal(result, x, y);
        self.sim_pass = 0;
        self.tool_invalidate_maps();
        result
    }
}
