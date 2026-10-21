//! The power the grid asks for: the tiles the power scan would energise with unlimited plants.

use crate::simulation::Simulation;
use crate::tile::CONDBIT;

/// The four neighbours of a tile, the offsets the power scan walks.
const STEPS: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

impl Simulation {
    /// Tiles connected to the `seeds` through conductive tiles, the seeds included: what the
    /// classic power scan would energise with enough power. Each tile is visited once, so the
    /// work is bounded by the map size.
    pub(crate) fn grid_demand(&self, seeds: &[(i32, i32)]) -> i64 {
        let (w, h) = self.world_size();
        let index = |x: i32, y: i32| (x * h + y) as usize;
        let mut seen = vec![false; (w * h) as usize];
        let mut stack = Vec::new();
        for &(x, y) in seeds {
            if self.on_map(x, y) && !seen[index(x, y)] {
                seen[index(x, y)] = true;
                stack.push((x, y));
            }
        }
        let mut count = 0;
        while let Some((x, y)) = stack.pop() {
            count += 1;
            for (dx, dy) in STEPS {
                let (nx, ny) = (x + dx, y + dy);
                let conductive = self.tile(nx, ny).is_some_and(|t| t & CONDBIT != 0);
                if conductive && !seen[index(nx, ny)] {
                    seen[index(nx, ny)] = true;
                    stack.push((nx, ny));
                }
            }
        }
        count
    }
}
