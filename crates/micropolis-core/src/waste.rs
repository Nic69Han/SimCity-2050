//! Waste (docs/game-design-v08.md): every zone produces garbage from its population; the city
//! has to treat it, or it piles up, pollutes and lowers the land value. With the rule
//! ([`Extensions::waste`](crate::extensions::Extensions::waste)) off, or the extended buildings
//! ([`Extensions::structures`](crate::extensions::Extensions::structures)) off, nothing here
//! acts: the hooks answer their input, the calls are refused or empty and the engine is the
//! original.
//!
//! * **Month.** "Month" is one tax collection (`ext_monthly_balance`, once per [`YEAR_STEPS`]
//!   city-time steps), like the running costs of the other rules.
//! * **Buildings** (genres of the catalog, no new surface tile): the landfill
//!   ([`GENRE_LANDFILL`], 3 x 3, [`LANDFILL_CAPACITY`] units, then full), the incinerator
//!   ([`GENRE_INCINERATOR`], 2 x 2, burns [`INCINERATOR_CAPACITY`] a month, needs power), the
//!   recycling centre ([`GENRE_RECYCLING`], 2 x 2) and the waste-to-energy plant
//!   ([`GENRE_WASTE_TO_ENERGY`], 3 x 3, burns [`WTE_CAPACITY`] a month and adds
//!   [`WTE_POWER_STRENGTH`] power tiles to the grid, like a plant). Only intact buildings that
//!   work (powered when they need it) count.
//! * **Production** (`production`): a zone makes `population * PRODUCTION_PCT[genre] / 100`
//!   units, the population being the classic zone population (commercial and industrial tiers
//!   count [`TIER_POPULATION`] each).
//! * **Treatment order** (`month`): recycling (each centre within [`RECYCLING_RADIUS`] of a
//!   zone cuts its production by [`RECYCLING_PCT`] %, at most [`RECYCLING_MAX_PCT`] %), then the
//!   incinerators, the waste-to-energy plants, the landfills (in list order), the export deals
//!   (resource 2 of `deals`: the city *pays* the neighbour `price` per unit exported, up to the
//!   deal's amount), and what is left piles up on the tiles around the zones that made it
//!   (`spread`), at most [`TILE_CAP`] per tile. Spare capacity then eats the pile slowly
//!   ([`BACKLOG_DECAY`] per tile per month).
//! * **Conservation**: `produced = treated + recycled + exported + (pile after - pile before) +
//!   lost` for every month ([`WasteReport`]); `lost` is the part no tile could hold (0 unless
//!   the whole map is full).
//! * **Effects** (`effects`): the pile raises the pollution and lowers the land value of its
//!   block; the working landfills, incinerators and plants pollute around them.
//! * **Save**: chunk 8 ([`WasteState::encode`]): the landfill fills, then the piled tiles.
//!   Rule off and nothing stored: nothing is written. The report of the last month is runtime
//!   state, never saved.
//!
//! No random number is drawn anywhere. Every loop is bounded by [`MAX_FILLS`], by the number of
//! zones, by a footprint, by [`SPILL_RADIUS`] or by the map size.

mod effects;
mod month;
mod production;
mod rules;
mod spread;
mod treatment;

use std::collections::BTreeMap;

pub(crate) use effects::{land_value, pollution};
pub(crate) use month::monthly_balance;
pub use rules::STATS_SIZE;

/// Genre of the landfill (3 x 3).
pub const GENRE_LANDFILL: u8 = 20;
/// Genre of the incinerator (2 x 2, needs power).
pub const GENRE_INCINERATOR: u8 = 21;
/// Genre of the recycling centre (2 x 2).
pub const GENRE_RECYCLING: u8 = 22;
/// Genre of the waste-to-energy plant (3 x 3).
pub const GENRE_WASTE_TO_ENERGY: u8 = 23;
/// City-time steps in a game year (the tax collection period, see `simulate.rs`).
pub const YEAR_STEPS: i64 = 48;
/// Garbage a zone makes per 100 inhabitants, indexed `[residential, commercial, industrial]`.
pub const PRODUCTION_PCT: [i64; 3] = [25, 40, 60];
/// Inhabitants one commercial or industrial tier stands for (their zone population is a tier
/// from 1, the residential one is already a head count).
pub const TIER_POPULATION: i64 = 8;
/// Units a landfill holds before it is full.
pub const LANDFILL_CAPACITY: i64 = 20_000;
/// Units an incinerator burns a month.
pub const INCINERATOR_CAPACITY: i64 = 300;
/// Units a waste-to-energy plant burns a month.
pub const WTE_CAPACITY: i64 = 500;
/// Power tiles a waste-to-energy plant supplies (a coal plant: 700).
pub const WTE_POWER_STRENGTH: i64 = 400;
/// Tiles from a recycling centre's footprint up to which it cuts the production of a zone.
pub const RECYCLING_RADIUS: i32 = 8;
/// Percent of a zone's production one recycling centre in reach recycles.
pub const RECYCLING_PCT: i64 = 30;
/// Most percent of a zone's production the recycling centres recycle together.
pub const RECYCLING_MAX_PCT: i64 = 60;
/// Most units on one tile.
pub const TILE_CAP: u8 = u8::MAX;
/// Most units the spare capacity removes from one tile in a month.
pub const BACKLOG_DECAY: i64 = 4;
/// Chebyshev radius of the square (around a zone centre) the pile spills over before it
/// spills anywhere on the map.
pub const SPILL_RADIUS: i32 = 3;
/// Units on a block per point of pollution it gets (pollution = pile / this).
pub const POLLUTION_DIV: i32 = 8;
/// Units on a block per point of land value it loses.
pub const LAND_VALUE_DIV: i32 = 6;
/// Pollution `(at the footprint, radius)` of a working building, by genre: it falls off
/// linearly to 0 past the radius.
pub const BUILDING_POLLUTION: [(u8, i32, i32); 3] = [
    (GENRE_LANDFILL, 40, 3),
    (GENRE_INCINERATOR, 60, 4),
    (GENRE_WASTE_TO_ENERGY, 30, 3),
];
/// Most landfills with a recorded fill (one per building).
pub const MAX_FILLS: usize = crate::structures::MAX_STRUCTURES;
/// Bytes of a saved fill: x (2, big-endian), y (2), units (4).
pub const FILL_RECORD_SIZE: usize = 8;
/// Bytes of a saved piled tile: x (2, big-endian), y (2), units (1).
pub const TILE_RECORD_SIZE: usize = 5;
/// Bytes of the count of fills that opens chunk 8.
const COUNT_SIZE: usize = 2;

/// What happened in the last month, in units (runtime state: never saved, ignored when
/// comparing).
#[derive(Debug, Clone, Copy, Default)]
pub struct WasteReport {
    /// Garbage the zones made, before any recycling.
    pub produced: i64,
    /// Garbage burned or buried (the pile that was eaten included).
    pub treated: i64,
    /// Garbage the recycling centres kept from being made.
    pub recycled: i64,
    /// Garbage sent to the neighbours.
    pub exported: i64,
    /// Garbage no tile could hold.
    pub lost: i64,
    /// Dollars paid to the neighbours for the exports.
    pub export_cost: i64,
    /// Units burned by the waste-to-energy plants.
    pub energised: i64,
}

impl PartialEq for WasteReport {
    fn eq(&self, _: &WasteReport) -> bool {
        true
    }
}
impl Eq for WasteReport {}

/// The fill of one landfill, by its top-left tile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fill {
    pub x: i32,
    pub y: i32,
    pub units: i64,
}

/// The saved waste of a city: the piled garbage (sparse, never a 0) and the landfill fills
/// (sorted by `(x, y)`, never 0 units).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WasteState {
    /// Tile index `x * height + y` to units `1..=255`.
    pile: BTreeMap<u32, u8>,
    fills: Vec<Fill>,
}

impl WasteState {
    pub fn is_empty(&self) -> bool {
        self.pile.is_empty() && self.fills.is_empty()
    }

    /// Units piled on the tile of index `index`.
    pub fn pile_at(&self, index: u32) -> u8 {
        self.pile.get(&index).copied().unwrap_or(0)
    }

    /// Sets the units piled on a tile (0 clears it).
    pub fn set_pile(&mut self, index: u32, units: u8) {
        if units == 0 {
            self.pile.remove(&index);
        } else {
            self.pile.insert(index, units);
        }
    }

    /// The piled tiles in index order: `(index, units)`.
    pub fn piles(&self) -> impl Iterator<Item = (u32, u8)> + '_ {
        self.pile.iter().map(|(&i, &u)| (i, u))
    }

    /// Total units piled on the map.
    pub fn pile_total(&self) -> i64 {
        self.pile.values().map(|&u| i64::from(u)).sum()
    }

    /// Units in the landfill whose top-left tile is `(x, y)`.
    pub fn fill_at(&self, x: i32, y: i32) -> i64 {
        match self.fills.binary_search_by_key(&(x, y), |f| (f.x, f.y)) {
            Ok(i) => self.fills[i].units,
            Err(_) => 0,
        }
    }

    /// Sets the units of a landfill (0 forgets it). `false` when a new one does not fit.
    pub fn set_fill(&mut self, x: i32, y: i32, units: i64) -> bool {
        match self.fills.binary_search_by_key(&(x, y), |f| (f.x, f.y)) {
            Ok(i) if units <= 0 => {
                self.fills.remove(i);
            }
            Ok(i) => self.fills[i].units = units,
            Err(_) if units <= 0 => {}
            Err(_) if self.fills.len() >= MAX_FILLS => return false,
            Err(i) => self.fills.insert(i, Fill { x, y, units }),
        }
        true
    }

    /// Keeps the fills for which `keep` is true.
    pub fn retain_fills(&mut self, keep: impl FnMut(&Fill) -> bool) {
        self.fills.retain(keep);
    }

    pub fn fills(&self) -> &[Fill] {
        &self.fills
    }

    /// The bytes of chunk 8: the fill count, the fills, the piled tiles; nothing when empty.
    pub fn encode(&self, height: i32) -> Vec<u8> {
        if self.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::new();
        out.extend_from_slice(&(self.fills.len() as u16).to_be_bytes());
        for f in &self.fills {
            out.extend_from_slice(&(f.x as u16).to_be_bytes());
            out.extend_from_slice(&(f.y as u16).to_be_bytes());
            out.extend_from_slice(&(f.units as u32).to_be_bytes());
        }
        for (index, units) in self.piles() {
            let h = height as u32;
            out.extend_from_slice(&((index / h) as u16).to_be_bytes());
            out.extend_from_slice(&((index % h) as u16).to_be_bytes());
            out.push(units);
        }
        out
    }

    /// The state stored in `bytes` for a `width` x `height` map. Refused: a cut count or record,
    /// more than [`MAX_FILLS`] fills, a fill off the map, empty or over [`LANDFILL_CAPACITY`],
    /// fills or tiles not in strictly increasing order, a tile off the map or empty.
    pub fn decode(bytes: &[u8], width: i32, height: i32) -> Result<WasteState, &'static str> {
        if bytes.len() < COUNT_SIZE {
            return Err("waste chunk is cut short");
        }
        let count = usize::from(u16::from_be_bytes([bytes[0], bytes[1]]));
        let fills_end = COUNT_SIZE + count * FILL_RECORD_SIZE;
        if count > MAX_FILLS {
            return Err("waste chunk has too many landfills");
        }
        if bytes.len() < fills_end || !(bytes.len() - fills_end).is_multiple_of(TILE_RECORD_SIZE) {
            return Err("waste chunk is not a whole number of records");
        }
        let mut state = WasteState::default();
        for r in bytes[COUNT_SIZE..fills_end].chunks_exact(FILL_RECORD_SIZE) {
            let x = i32::from(u16::from_be_bytes([r[0], r[1]]));
            let y = i32::from(u16::from_be_bytes([r[2], r[3]]));
            let units = i64::from(u32::from_be_bytes([r[4], r[5], r[6], r[7]]));
            let last = state.fills.last().map(|f| (f.x, f.y));
            if x >= width || y >= height || last.is_some_and(|l| l >= (x, y)) {
                return Err("a landfill of the waste chunk is off the map or out of order");
            }
            if !(1..=LANDFILL_CAPACITY).contains(&units) {
                return Err("a landfill of the waste chunk has an impossible fill");
            }
            state.fills.push(Fill { x, y, units });
        }
        let mut last_index = None;
        for r in bytes[fills_end..].chunks_exact(TILE_RECORD_SIZE) {
            let x = i32::from(u16::from_be_bytes([r[0], r[1]]));
            let y = i32::from(u16::from_be_bytes([r[2], r[3]]));
            if x >= width || y >= height || r[4] == 0 {
                return Err("a tile of the waste chunk is off the map or empty");
            }
            let index = (x * height + y) as u32;
            if last_index.is_some_and(|l| l >= index) {
                return Err("tiles of the waste chunk are not in order");
            }
            last_index = Some(index);
            state.pile.insert(index, r[4]);
        }
        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tables_are_sane() {
        const { assert!(RECYCLING_PCT <= RECYCLING_MAX_PCT && RECYCLING_MAX_PCT < 100) };
        assert!(PRODUCTION_PCT.iter().all(|&p| p > 0));
        assert!(WTE_POWER_STRENGTH < crate::power::COAL_POWER_STRENGTH);
        assert!(BUILDING_POLLUTION.iter().all(|&(_, p, r)| p > 0 && r > 0));
        assert!(LANDFILL_CAPACITY <= i64::from(u32::MAX));
    }

    #[test]
    fn setting_a_pile_to_zero_clears_it_and_the_total_adds_up() {
        let mut s = WasteState::default();
        assert!(s.is_empty());
        s.set_pile(7, 10);
        s.set_pile(3, 5);
        assert_eq!((s.pile_at(7), s.pile_at(8), s.pile_total()), (10, 0, 15));
        assert_eq!(s.piles().collect::<Vec<_>>(), [(3, 5), (7, 10)]);
        s.set_pile(7, 0);
        s.set_pile(3, 0);
        assert!(s.is_empty());
    }

    #[test]
    fn the_fills_stay_sorted_replace_clear_and_are_capped() {
        let mut s = WasteState::default();
        assert!(s.set_fill(9, 2, 5) && s.set_fill(3, 8, 6) && s.set_fill(3, 5, 7));
        let order: Vec<_> = s.fills().iter().map(|f| (f.x, f.y)).collect();
        assert_eq!(order, [(3, 5), (3, 8), (9, 2)]);
        assert!(s.set_fill(3, 8, 60));
        assert_eq!((s.fill_at(3, 8), s.fill_at(4, 8)), (60, 0));
        assert!(s.set_fill(3, 8, 0) && s.set_fill(50, 50, 0));
        assert_eq!(s.fills().len(), 2);
        let mut full = WasteState::default();
        for i in 0..MAX_FILLS as i32 {
            assert!(full.set_fill(i, 1, 1));
        }
        assert!(!full.set_fill(0, 2, 1) && full.set_fill(0, 1, 2));
        assert_eq!(full.fills().len(), MAX_FILLS);
    }

    fn sample() -> WasteState {
        let mut s = WasteState::default();
        s.set_fill(70, 60, LANDFILL_CAPACITY);
        s.set_fill(1, 2, 12);
        s.set_pile(5 * 67 + 6, 200);
        s.set_pile(79 * 67 + 66, 255);
        s
    }

    #[test]
    fn the_state_round_trips_and_an_empty_one_is_empty_bytes() {
        assert!(WasteState::default().encode(67).is_empty());
        let s = sample();
        let bytes = s.encode(67);
        assert_eq!(bytes.len(), COUNT_SIZE + 2 * FILL_RECORD_SIZE + 2 * TILE_RECORD_SIZE);
        assert_eq!(WasteState::decode(&bytes, 80, 67), Ok(s));
    }

    #[test]
    fn a_bad_chunk_is_refused() {
        let fill = |x: u16, y: u16, u: u32| {
            let mut v = x.to_be_bytes().to_vec();
            v.extend_from_slice(&y.to_be_bytes());
            v.extend_from_slice(&u.to_be_bytes());
            v
        };
        let tile = |x: u16, y: u16, u: u8| {
            let mut v = x.to_be_bytes().to_vec();
            v.extend_from_slice(&y.to_be_bytes());
            v.push(u);
            v
        };
        let with = |n: u16, fills: &[Vec<u8>], tiles: &[Vec<u8>]| {
            [n.to_be_bytes().to_vec(), fills.concat(), tiles.concat()].concat()
        };
        let too_many = with(
            MAX_FILLS as u16 + 1,
            &vec![fill(1, 1, 1); MAX_FILLS + 1],
            &[],
        );
        let bad = [
            vec![],
            vec![0],
            with(1, &[], &[]),
            with(0, &[], &[vec![1, 2, 3]]),
            with(1, &[fill(80, 1, 5)], &[]),
            with(1, &[fill(1, 67, 5)], &[]),
            with(1, &[fill(1, 1, 0)], &[]),
            with(1, &[fill(1, 1, LANDFILL_CAPACITY as u32 + 1)], &[]),
            with(2, &[fill(5, 5, 1), fill(5, 5, 1)], &[]),
            with(2, &[fill(6, 5, 1), fill(5, 9, 1)], &[]),
            with(0, &[], &[tile(80, 1, 1)]),
            with(0, &[], &[tile(1, 67, 1)]),
            with(0, &[], &[tile(1, 1, 0)]),
            with(0, &[], &[tile(1, 1, 1), tile(1, 1, 1)]),
            with(0, &[], &[tile(2, 1, 1), tile(1, 9, 1)]),
            too_many,
        ];
        for (i, b) in bad.iter().enumerate() {
            assert!(WasteState::decode(b, 80, 67).is_err(), "case {i}");
        }
    }
}
