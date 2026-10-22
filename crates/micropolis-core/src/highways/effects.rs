//! What highways do to the engine: the traffic density, the upkeep, the speed of the cars.

use super::{HIGHWAY_TRAFFIC_DIV, HIGHWAY_UPKEEP};
use crate::simulation::Simulation;

/// Traffic density `t` of the block at world tile `(x, y)` (its origin): divided by
/// [`HIGHWAY_TRAFFIC_DIV`] when the block holds a highway tile. `t` while the rule is off.
pub(crate) fn traffic(sim: &Simulation, x: i32, y: i32, t: i32) -> i32 {
    let list = &sim.extensions().highway_list;
    if !sim.highway_rules() || list.is_empty() {
        return t;
    }
    let bs = sim.traffic_density_map.block_size();
    let (x0, y0) = (x - x % bs, y - y % bs);
    let holds = (0..bs).any(|dx| (0..bs).any(|dy| list.contains(x0 + dx, y0 + dy)));
    if holds {
        t / HIGHWAY_TRAFFIC_DIV
    } else {
        t
    }
}

/// Dollars of the yearly upkeep (a cost is positive); 0 while the rule is off.
pub(crate) fn monthly_balance(sim: &Simulation) -> i32 {
    if !sim.highway_rules() {
        return 0;
    }
    let tiles = sim.extensions().highway_list.len() as i64;
    (tiles * i64::from(HIGHWAY_UPKEEP)).clamp(0, i64::from(i32::MAX)) as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tile::ROADS;

    fn city() -> Simulation {
        let mut s = Simulation::new(40, 30);
        for x in 5..15 {
            s.set_tile(x, 10, ROADS);
        }
        s.extensions_mut().highways = true;
        s.total_funds = 1000;
        s
    }

    #[test]
    fn a_block_with_a_highway_tile_has_its_traffic_divided() {
        let mut s = city();
        assert_eq!(traffic(&s, 8, 10, 100), 100, "no highway yet");
        assert_eq!(s.place_highway(9, 10), crate::tool::ToolResult::Ok);
        let bs = s.traffic_density_map.block_size();
        let origin = 9 - 9 % bs;
        assert_eq!(
            traffic(&s, origin, 10 - 10 % bs, 100),
            100 / HIGHWAY_TRAFFIC_DIV
        );
        assert_eq!(traffic(&s, 30, 20, 100), 100, "another block");
        s.extensions_mut().highways = false;
        assert_eq!(traffic(&s, origin, 10, 100), 100, "rule off");
    }

    #[test]
    fn the_upkeep_is_per_tile() {
        let mut s = city();
        assert_eq!(monthly_balance(&s), 0);
        for x in 5..9 {
            s.place_highway(x, 10);
        }
        assert_eq!(monthly_balance(&s), 4 * HIGHWAY_UPKEEP);
        s.extensions_mut().highways = false;
        assert_eq!(monthly_balance(&s), 0);
    }
}
