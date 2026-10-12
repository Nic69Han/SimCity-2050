#![allow(dead_code)] // each test file uses a part of these helpers
//! Helpers shared by the save/load tests (`tests/save_*.rs`). Not a test target itself.

use micropolis_core::simulation::Simulation;
use micropolis_core::tool::EditingTool;

pub const HAIGHT: &[u8] = include_bytes!("../../../../assets/cities/haight.cty");

/// FNV-1a over bytes: a stable fingerprint for golden values.
pub fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 1_469_598_103_934_665_603;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(1_099_511_628_211);
    }
    h
}

/// A starter-like build around the centre of the map: roads, three zones, a power plant and
/// a park. Placements the city cannot afford or that are invalid are simply refused.
pub fn starter(sim: &mut Simulation) {
    let (w, h) = sim.world_size();
    let (cx, cy) = (w / 2, h / 2);
    sim.set_speed(3);
    sim.set_passes(1);
    sim.tool_drag(EditingTool::Road, cx - 15, cy, cx + 15, cy);
    sim.tool_drag(EditingTool::Road, cx, cy - 10, cx, cy + 10);
    sim.tool_down(EditingTool::Residential, cx - 6, cy - 3);
    sim.tool_down(EditingTool::Commercial, cx + 4, cy - 3);
    sim.tool_down(EditingTool::Industrial, cx + 4, cy + 3);
    sim.tool_down(EditingTool::CoalPower, cx - 10, cy + 8);
    sim.tool_down(EditingTool::Park, cx - 8, cy - 8);
}

/// `ticks` simulation ticks at speed 3, one pass per tick.
pub fn run(sim: &mut Simulation, ticks: usize) {
    sim.set_speed(3);
    sim.set_passes(1);
    for _ in 0..ticks {
        sim.sim_tick();
    }
}

/// What a test compares between two engines: the tiles and the counters the fingerprints use.
pub fn state(s: &Simulation) -> (Vec<u16>, i64, i64, i16, i16, i16, i16) {
    (
        s.tiles.clone(),
        s.total_funds,
        s.city_time,
        s.total_pop,
        s.res_valve,
        s.com_valve,
        s.ind_valve,
    )
}

/// The city as a file, the bytes that define it (any size).
pub fn file_of(s: &Simulation) -> Vec<u8> {
    s.save_city()
}

/// Splits a city file into the bytes before the tile map and the tile map (column-major),
/// for the file's own size `width` x `height`.
pub fn split_tiles(file: &[u8], width: i32, height: i32) -> (&[u8], Vec<u16>) {
    let n = (width as usize) * (height as usize);
    let at = file.len() - 2 * n;
    let tiles = (0..n)
        .map(|i| u16::from_be_bytes([file[at + 2 * i], file[at + 2 * i + 1]]))
        .collect();
    (&file[..at], tiles)
}

/// The tiles that differ between two tile maps. A load recomputes derived tile data (the
/// power bits, the shapes of roads, rails and wires, bridges), as the original's `loadFile`
/// does: the differential test scripts/compare-saveload.sh checks the resulting tile maps
/// against the original. Here: the changes are few (at most 1 tile in 100).
pub fn derived_changes(a: &[u16], b: &[u16], label: &str) -> usize {
    assert_eq!(a.len(), b.len(), "{label}: tile counts");
    let changed = a.iter().zip(b).filter(|(x, y)| x != y).count();
    assert!(
        changed * 100 <= a.len(),
        "{label}: {changed} of {} tiles changed by a load",
        a.len()
    );
    changed
}
