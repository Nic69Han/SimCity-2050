//! The wealth layer of the map.

use crate::economy::wealth_of;
use crate::simulation::Simulation;

/// Half the side of a zone: a zone covers the 3 x 3 tiles around its centre.
const ZONE_REACH: i32 = 1;

impl Simulation {
    /// One value per tile (order `x * height + y`): 0 outside a zone, 1 to 3 (modest, average,
    /// wealthy) on the 9 tiles of a zone. All 0 while the rule is off. Bounded by the map size.
    pub fn wealth_layer(&self) -> Vec<u8> {
        let (w, h) = self.world_size();
        let mut out = vec![0u8; (w * h) as usize];
        if !self.economy_rules() {
            return out;
        }
        for z in self.economy_zones() {
            let wealth = wealth_of(z.land) as u8;
            for x in z.x - ZONE_REACH..=z.x + ZONE_REACH {
                for y in z.y - ZONE_REACH..=z.y + ZONE_REACH {
                    if self.on_map(x, y) {
                        out[(x * h + y) as usize] = wealth;
                    }
                }
            }
        }
        out
    }
}
