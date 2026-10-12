//! wasm adapter: map overlays (translation only, ARCHITECTURE.md rule 4).
//!
//! The engine keeps its density and coverage maps per cluster of tiles
//! (`Map`, with a block size of 1, 2 or 8 tiles). These functions hand those
//! maps to the page unchanged; the page decides the colours.

use crate::City;
use micropolis_core::map::Map;
use wasm_bindgen::prelude::*;

/// Overlay kinds (`City::overlay`, `City::overlay_layout`).
pub const OVERLAY_POPULATION: i32 = 0;
pub const OVERLAY_LAND_VALUE: i32 = 1;
pub const OVERLAY_CRIME: i32 = 2;
pub const OVERLAY_POLLUTION: i32 = 3;
pub const OVERLAY_TRAFFIC: i32 = 4;
pub const OVERLAY_POWER: i32 = 5;
pub const OVERLAY_FIRE: i32 = 6;
pub const OVERLAY_POLICE: i32 = 7;

/// Values of a map as bytes, column-major like the engine's storage. Values
/// below 0 become 0 and values above 255 saturate at 255.
fn to_bytes<T: Copy + Into<i32>>(map: &Map<T>) -> Vec<u8> {
    map.as_slice()
        .iter()
        .map(|&v| v.into().clamp(0, 255) as u8)
        .collect()
}

#[wasm_bindgen]
impl City {
    /// `[block, cols, rows]` of overlay `kind`: each cell covers `block` x
    /// `block` tiles, and there are `cols` x `rows` cells. Empty when `kind`
    /// is not an overlay.
    pub fn overlay_layout(&self, kind: i32) -> Vec<i32> {
        let layout = |size: (i32, i32), block: i32| vec![block, size.0, size.1];
        let sim = &self.sim;
        match kind {
            OVERLAY_POPULATION => layout(
                sim.population_density_map.size(),
                sim.population_density_map.block_size(),
            ),
            OVERLAY_LAND_VALUE => {
                layout(sim.land_value_map.size(), sim.land_value_map.block_size())
            }
            OVERLAY_CRIME => layout(sim.crime_rate_map.size(), sim.crime_rate_map.block_size()),
            OVERLAY_POLLUTION => layout(
                sim.pollution_density_map.size(),
                sim.pollution_density_map.block_size(),
            ),
            OVERLAY_TRAFFIC => layout(
                sim.traffic_density_map.size(),
                sim.traffic_density_map.block_size(),
            ),
            OVERLAY_POWER => layout(sim.power_grid_map.size(), sim.power_grid_map.block_size()),
            OVERLAY_FIRE => layout(
                sim.fire_station_effect_map.size(),
                sim.fire_station_effect_map.block_size(),
            ),
            OVERLAY_POLICE => layout(
                sim.police_station_effect_map.size(),
                sim.police_station_effect_map.block_size(),
            ),
            _ => Vec::new(),
        }
    }

    /// Cell values of overlay `kind`, one byte per cell in the layout of
    /// `overlay_layout` (column-major: cell `(cx, cy)` is at `cx * rows + cy`).
    /// Empty when `kind` is not an overlay.
    pub fn overlay(&self, kind: i32) -> Vec<u8> {
        let sim = &self.sim;
        match kind {
            OVERLAY_POPULATION => to_bytes(&sim.population_density_map),
            OVERLAY_LAND_VALUE => to_bytes(&sim.land_value_map),
            OVERLAY_CRIME => to_bytes(&sim.crime_rate_map),
            OVERLAY_POLLUTION => to_bytes(&sim.pollution_density_map),
            OVERLAY_TRAFFIC => to_bytes(&sim.traffic_density_map),
            OVERLAY_POWER => to_bytes(&sim.power_grid_map),
            OVERLAY_FIRE => to_bytes(&sim.fire_station_effect_map),
            OVERLAY_POLICE => to_bytes(&sim.police_station_effect_map),
            _ => Vec::new(),
        }
    }
}
