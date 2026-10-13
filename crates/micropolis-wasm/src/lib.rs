//! WebAssembly adapter (see ARCHITECTURE.md, rule 4): converts types and
//! forwards calls to `micropolis-core`. It contains no game rule.

use micropolis_core::events::Event;
use micropolis_core::simulation::{GameLevel, Simulation};
use micropolis_core::tool::{EditingTool, ToolResult, TOOL_COUNT};
use wasm_bindgen::prelude::*;

// Feature modules: each adds its own `#[wasm_bindgen] impl City` block (one owner per file).
mod budget;
mod messages;
mod overlays;
mod relief;
mod saves;
mod sizes;
mod sprites;

/// Seed of the random generator when a city file is loaded: the same file always gives the
/// same city (the original seeds from the clock, which cannot be reproduced).
const LOAD_SEED: i32 = 1;

/// Year the original front-end gives to city time 0.
const STARTING_YEAR: i16 = 1900;

/// Speed and passes the original `generateSomeCity` test harness applies after
/// generation (`setSpeed(3)`, `setPasses(1)`), so the page can run a new city.
const NEW_CITY_SPEED: i16 = 3;
const NEW_CITY_PASSES: i32 = 1;

/// The tool with the page's index `i`, or `None` when the index is not a tool.
fn tool_at(i: u32) -> Option<EditingTool> {
    EditingTool::from_index(i32::try_from(i).ok()?)
}

/// The tool with id `id`: the page's tool ids are the signed `EditingTool` indices.
fn tool_of(id: i32) -> Option<EditingTool> {
    EditingTool::from_index(id)
}

#[wasm_bindgen]
pub struct City {
    pub(crate) sim: Simulation,
}

#[wasm_bindgen]
impl City {
    /// An empty city of the original 120x100 size.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: i32) -> City {
        let mut sim = Simulation::with_default_size();
        sim.starting_year = STARTING_YEAR;
        sim.new_city(GameLevel::Easy, seed);
        City { sim }
    }

    /// Load the bytes of a plain `.cty` file (120x100); the error is `<code>: <detail>`.
    pub fn load_cty(&mut self, bytes: &[u8]) -> Result<(), JsError> {
        self.sim
            .load_cty_seeded(bytes, LOAD_SEED)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// The plain `.cty` bytes of the city. Only the original 120x100 size can be written in
    /// that format: any other size is refused with `size_not_saveable` (use `save_city`). A
    /// `.cty` has no relief block, so a city with an edited relief or with the relief rules on
    /// is refused with `relief_not_saveable` (use `save_city`).
    pub fn save_cty(&self) -> Result<Vec<u8>, JsError> {
        saves::save_cty_bytes(self).map_err(JsError::new)
    }

    pub fn width(&self) -> i32 {
        self.sim.world_size().0
    }

    pub fn height(&self) -> i32 {
        self.sim.world_size().1
    }

    /// Raw tiles, column-major (`x * height + y`), status bits included.
    pub fn tiles(&self) -> Vec<u16> {
        self.sim.tiles.clone()
    }

    pub fn funds(&self) -> f64 {
        self.sim.total_funds as f64
    }

    pub fn year(&self) -> i32 {
        self.sim.calendar().0 as i32
    }

    /// Month, 0..=11.
    pub fn month(&self) -> i32 {
        self.sim.calendar().1 as i32
    }

    /// City population as the original front-end shows it (`getPopulation`:
    /// residents plus eight times the workers, times 20).
    pub fn population(&self) -> i32 {
        i32::try_from(self.sim.get_population()).unwrap_or(i32::MAX)
    }

    /// Advance the simulation by one tick (`simTick`). Does nothing while the
    /// speed is 0.
    pub fn tick(&mut self) {
        self.sim.sim_tick();
    }

    /// Speed 0 (paused) to 3 (fast), as `setSpeed`.
    pub fn set_speed(&mut self, speed: i32) {
        self.sim.set_speed(speed as i16);
    }

    pub fn speed(&self) -> i32 {
        i32::from(self.sim.sim_speed)
    }

    pub fn enable_disasters(&mut self, on: bool) {
        self.sim.set_enable_disasters(on);
    }

    /// Residential, commercial and industrial demand valves.
    pub fn demand(&self) -> Vec<i32> {
        vec![
            i32::from(self.sim.res_valve),
            i32::from(self.sim.com_valve),
            i32::from(self.sim.ind_valve),
        ]
    }

    pub fn score(&self) -> i32 {
        i32::from(self.sim.city_score)
    }

    /// Number of pending events, then discards them. Events carry no payload
    /// the page needs yet; it simply redraws after a load.
    pub fn take_events(&mut self) -> u32 {
        self.sim
            .drain_events()
            .iter()
            .filter(|e| matches!(e, Event::NewCity))
            .count() as u32
    }

    /// Number of building tools, indexed 0..tool_count() for `tool_info` and `tool_key`.
    pub fn tool_count(&self) -> u32 {
        TOOL_COUNT as u32
    }

    /// `[id, cost, size]` of the tool at index `i`; empty if there is no such tool.
    pub fn tool_info(&self, i: u32) -> Vec<i32> {
        match tool_at(i) {
            Some(tool) => vec![tool as i32, tool.cost(), tool.size()],
            None => Vec::new(),
        }
    }

    /// Stable ASCII name of the tool at index `i`; empty if there is no such tool.
    pub fn tool_key(&self, i: u32) -> String {
        tool_at(i).map_or_else(String::new, |tool| tool.key().to_string())
    }

    /// Apply a tool at a click (`ToolResult` code). An unknown tool id changes
    /// nothing and returns `Failed`.
    pub fn tool_down(&mut self, id: i32, x: i32, y: i32) -> i32 {
        match tool_of(id) {
            Some(tool) => self.sim.tool_down(tool, x, y) as i32,
            None => ToolResult::Failed as i32,
        }
    }

    /// Apply a tool along the line from `(x0, y0)` to `(x1, y1)`. An unknown
    /// tool id does nothing.
    pub fn tool_drag(&mut self, id: i32, x0: i32, y0: i32, x1: i32, y1: i32) {
        if let Some(tool) = tool_of(id) {
            self.sim.tool_drag(tool, x0, y0, x1, y1);
        }
    }

    /// `[result, cost]` of what `tool_down` would do at `(x, y)`, without
    /// changing the city. An unknown tool id gives `[0, 0]`.
    pub fn tool_preview(&self, id: i32, x: i32, y: i32) -> Vec<i32> {
        match tool_of(id) {
            Some(tool) => {
                let preview = self.sim.tool_preview(tool, x, y);
                vec![preview.result as i32, preview.cost]
            }
            None => vec![ToolResult::Failed as i32, 0],
        }
    }

    /// `[x0, y0, w, h]`: the tiles a tool covers when used at `(x, y)`. An
    /// unknown tool id gives the single tile `(x, y)`.
    pub fn tool_footprint(&self, id: i32, x: i32, y: i32) -> Vec<i32> {
        match tool_of(id) {
            Some(tool) => {
                let (x0, y0, w, h) = tool.footprint(x, y);
                vec![x0, y0, w, h]
            }
            None => vec![x, y, 1, 1],
        }
    }

    /// `[category, density, land_value, crime, pollution, growth]` of the tile
    /// at `(x, y)`, as the `ZoneStatus` of the core (string-table indices for
    /// the category, 1..=20 for the other values). Empty when `(x, y)` is off
    /// the map.
    pub fn query(&self, x: i32, y: i32) -> Vec<i32> {
        match self.sim.do_zone_status(x, y) {
            Some(zone) => {
                let mut out = Vec::with_capacity(6);
                out.push(zone.category);
                out.extend_from_slice(&zone.status);
                out
            }
            None => Vec::new(),
        }
    }

    /// Replace the city by a new random one generated from `seed`, with the
    /// speed and passes the oracle uses (speed 3, one pass). Funds start at the
    /// easy level's 20000.
    pub fn new_random_city(&mut self, seed: i32) {
        self.sim.new_random_city(seed);
        self.sim.set_speed(NEW_CITY_SPEED);
        self.sim.set_passes(NEW_CITY_PASSES);
    }
}
