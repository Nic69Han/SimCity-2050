//! The farms: light industrial zones on cheap land, far from the pollution. The set is derived
//! (never saved): recomputed from the records and the land value and pollution maps by
//! [`Simulation::recompute_farms`], at every monthly balance, when a file is loaded and when the
//! rule is turned on.

use super::{
    zone_genre, DENSITY_LIGHT, FARM_LAND_VALUE_MAX, FARM_POLLUTION_MAX, FARM_RING, GENRE_INDUSTRIAL,
};
use crate::simulation::Simulation;

/// The centres of the farms, sorted by `(x, y)`. Runtime state: ignored when comparing.
#[derive(Debug, Clone, Default)]
pub struct Farms {
    centres: Vec<(i32, i32)>,
}

impl PartialEq for Farms {
    fn eq(&self, _: &Farms) -> bool {
        true
    }
}
impl Eq for Farms {}

impl Farms {
    pub fn len(&self) -> usize {
        self.centres.len()
    }

    pub fn is_empty(&self) -> bool {
        self.centres.is_empty()
    }

    pub fn as_slice(&self) -> &[(i32, i32)] {
        &self.centres
    }

    /// Whether the zone centred on `(x, y)` is a farm.
    pub fn contains(&self, x: i32, y: i32) -> bool {
        self.centres.binary_search(&(x, y)).is_ok()
    }

    /// Whether the footprint (3 x 3) of a farm touches the square of `size` tiles whose
    /// top-left tile is `(x, y)`.
    pub fn touches(&self, x: i32, y: i32, size: i32) -> bool {
        let first = self.centres.partition_point(|c| c.0 + 1 < x);
        self.centres[first..]
            .iter()
            .take_while(|c| c.0 - 1 < x + size)
            .any(|c| c.1 + 1 >= y && c.1 - 1 < y + size)
    }
}

impl Simulation {
    /// The highest pollution on the square ring of [`FARM_RING`] tiles around `(x, y)`.
    fn ring_pollution(&self, x: i32, y: i32) -> i32 {
        let r = FARM_RING;
        (-r..=r)
            .flat_map(|d| {
                [
                    (x + d, y - r),
                    (x + d, y + r),
                    (x - r, y + d),
                    (x + r, y + d),
                ]
            })
            .map(|(px, py)| i32::from(self.pollution_density_map.world_get(px, py)))
            .max()
            .unwrap_or(0)
    }

    fn is_farm_site(&self, x: i32, y: i32) -> bool {
        i32::from(self.land_value_map.world_get(x, y)) < FARM_LAND_VALUE_MAX
            && self.ring_pollution(x, y) < FARM_POLLUTION_MAX
    }

    /// Rebuilds the farms: the light zones that are industrial and on a farm site. Empty with
    /// the rule off.
    pub(crate) fn recompute_farms(&mut self) {
        let on = self.density_rules();
        let centres: Vec<(i32, i32)> = self
            .extensions()
            .density_zones
            .as_slice()
            .iter()
            .filter(|r| on && r.density == DENSITY_LIGHT)
            .filter(|r| {
                self.tile(r.x, r.y).and_then(zone_genre) == Some(GENRE_INDUSTRIAL)
                    && self.is_farm_site(r.x, r.y)
            })
            .map(|r| (r.x, r.y))
            .collect();
        self.extensions_mut().farms = Farms { centres };
    }
}

/// Pollution `p` of the block of `size` tiles at world tile `(x, y)`: none where a farm stands.
pub(crate) fn pollution(sim: &Simulation, x: i32, y: i32, p: i32) -> i32 {
    let farms = &sim.extensions().farms;
    if p == 0 || farms.is_empty() || !sim.density_rules() {
        return p;
    }
    if farms.touches(x, y, sim.pollution_density_map.block_size()) {
        0
    } else {
        p
    }
}
