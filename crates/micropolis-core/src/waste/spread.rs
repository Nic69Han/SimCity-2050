//! Where the garbage that nothing treated piles up: around the zones that made it, then
//! anywhere there is room.

use super::{WasteState, SPILL_RADIUS, TILE_CAP};

/// Room left on the tile of index `index`.
fn room(state: &WasteState, index: u32) -> i64 {
    i64::from(TILE_CAP) - i64::from(state.pile_at(index))
}

fn add(state: &mut WasteState, index: u32, units: i64) {
    let now = i64::from(state.pile_at(index)) + units;
    state.set_pile(index, now.clamp(0, i64::from(TILE_CAP)) as u8);
}

/// Spreads `amount` evenly over `tiles` (indexes), filling the tiles that run out of room
/// first; returns what did not fit. At most `tiles.len() + 1` passes: each pass that leaves
/// something over fills at least one tile.
fn spread_evenly(state: &mut WasteState, tiles: &[u32], mut amount: i64) -> i64 {
    for _ in 0..=tiles.len() {
        let open: Vec<u32> = tiles
            .iter()
            .copied()
            .filter(|&i| room(state, i) > 0)
            .collect();
        if amount == 0 || open.is_empty() {
            break;
        }
        let n = open.len() as i64;
        for (k, &index) in open.iter().enumerate() {
            let share = ((amount + (n - k as i64) - 1) / (n - k as i64)).min(room(state, index));
            add(state, index, share);
            amount -= share;
        }
    }
    amount
}

/// The tile indexes of the square of Chebyshev radius `r` around `(cx, cy)`, on the map.
fn square(cx: i32, cy: i32, r: i32, width: i32, height: i32) -> Vec<u32> {
    let mut out = Vec::new();
    for x in (cx - r).max(0)..=(cx + r).min(width - 1) {
        for y in (cy - r).max(0)..=(cy + r).min(height - 1) {
            out.push((x * height + y) as u32);
        }
    }
    out
}

/// Puts `amount` units on the map for the zone centred on `(cx, cy)`: evenly on its own nine
/// tiles, then on the square of [`SPILL_RADIUS`] around it, then on the first tiles of the map
/// with room. Returns the units that no tile could hold. Bounded by the squares and the map.
pub fn deposit(
    state: &mut WasteState,
    (cx, cy): (i32, i32),
    amount: i64,
    (width, height): (i32, i32),
) -> i64 {
    let mut left = amount;
    for r in [1, SPILL_RADIUS] {
        left = spread_evenly(state, &square(cx, cy, r, width, height), left);
    }
    for index in 0..(width * height) as u32 {
        if left == 0 {
            break;
        }
        let put = left.min(room(state, index));
        add(state, index, put);
        left -= put;
    }
    left
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIZE: (i32, i32) = (20, 10);

    fn at(s: &WasteState, x: i32, y: i32) -> u8 {
        s.pile_at((x * SIZE.1 + y) as u32)
    }

    #[test]
    fn a_small_amount_spreads_evenly_over_the_nine_tiles_of_the_zone() {
        let mut s = WasteState::default();
        assert_eq!(deposit(&mut s, (5, 5), 18, SIZE), 0);
        assert_eq!(s.pile_total(), 18);
        for x in 4..=6 {
            for y in 4..=6 {
                assert_eq!(at(&s, x, y), 2, "({x}, {y})");
            }
        }
        assert_eq!(at(&s, 7, 5), 0);
        // an amount that does not divide: nothing is lost
        let mut s = WasteState::default();
        assert_eq!(deposit(&mut s, (5, 5), 11, SIZE), 0);
        assert_eq!(s.pile_total(), 11);
        assert!(s.piles().all(|(_, u)| u == 1 || u == 2));
    }

    #[test]
    fn a_tile_never_holds_more_than_the_cap_and_the_rest_spills_over() {
        let mut s = WasteState::default();
        let nine = 9 * i64::from(TILE_CAP);
        assert_eq!(deposit(&mut s, (5, 5), nine + 40, SIZE), 0);
        assert_eq!(s.pile_total(), nine + 40);
        assert!(s.piles().all(|(_, u)| u <= TILE_CAP));
        assert_eq!(at(&s, 5, 5), TILE_CAP);
        // the spill lands in the 7 x 7 square first
        assert!(s.piles().all(|(i, _)| {
            let (x, y) = ((i / SIZE.1 as u32) as i32, (i % SIZE.1 as u32) as i32);
            (x - 5).abs() <= 3 && (y - 5).abs() <= 3
        }));
    }

    #[test]
    fn past_the_square_it_goes_anywhere_and_a_full_map_loses_the_rest() {
        let mut s = WasteState::default();
        let square49 = 49 * i64::from(TILE_CAP);
        assert_eq!(deposit(&mut s, (5, 5), square49 + 10, SIZE), 0);
        assert_eq!(s.pile_total(), square49 + 10);
        let everything = i64::from(SIZE.0 * SIZE.1) * i64::from(TILE_CAP);
        let mut s = WasteState::default();
        assert_eq!(deposit(&mut s, (0, 0), everything + 77, SIZE), 77);
        assert_eq!(s.pile_total(), everything);
        assert_eq!(deposit(&mut s, (3, 3), 5, SIZE), 5);
    }

    #[test]
    fn a_zone_at_the_corner_stays_on_the_map() {
        let mut s = WasteState::default();
        assert_eq!(deposit(&mut s, (0, 0), 40, SIZE), 0);
        assert_eq!(s.pile_total(), 40);
        assert!(at(&s, 0, 0) > 0);
    }
}
