//! Energy (docs/game-design-v10.md): a choice of power plants that differ by price, power,
//! pollution and life span, plants that **age** and must be replaced, and electricity bought
//! from the neighbours. With the rule ([`Extensions::energy`](crate::extensions::Extensions::energy))
//! off, or the extended buildings ([`Extensions::structures`](crate::extensions::Extensions::structures))
//! off, nothing here acts: the hooks answer their input, the calls are refused or empty and the
//! engine is the original.
//!
//! * **Month.** "Month" is one tax collection (`ext_monthly_balance`), like the other rules. A
//!   plant is `life_years * 12` months old at the end of its life.
//! * **Plants** (genres of the catalog, no new surface tile): [`GENRE_GAS`] 3 x 3, [`GENRE_OIL`]
//!   3 x 3, [`GENRE_WIND`] 1 x 1, [`GENRE_SOLAR`] 3 x 3, [`GENRE_HYDRO`] 2 x 2 (a water tile must
//!   touch its footprint), [`GENRE_MICROWAVE`] 3 x 3, [`GENRE_FUSION`] 4 x 4. Cost, upkeep and
//!   size are in the catalog; power, pollution and life span in [`PLANTS`]. They are conductive
//!   and add their power to the grid like the waste-to-energy plant. The classic coal and
//!   nuclear plants are in [`PLANTS`] too, as genres [`GENRE_COAL`] and [`GENRE_NUCLEAR`]: they
//!   age and lose power while the rule acts, but are still built with the classic tools.
//! * **Age and power** ([`curve`]): 100 % of the power up to 80 % of the life span, then a linear
//!   fall to 50 % at the end of life, then 0 (the plant stops). The age is counted in months by
//!   the monthly balance; a plant that was just built (or never seen) is 0 months old; pulling
//!   a plant down and building it again starts over.
//! * **Pollution** (`effects`): a running plant adds its intensity to the air pollution around
//!   it, falling off linearly with the distance to its footprint (`ext_pollution`).
//! * **Buying** (resource [`RESOURCE_POWER_BUY`](crate::deals::RESOURCE_POWER_BUY) of `deals`):
//!   the amount bought is added to the power of the grid and the city *pays* `amount * price`
//!   at each monthly balance. It never counts in the surplus the city can sell.
//! * **Save**: chunk 10 ([`EnergyState::encode`]): the ages of the plants. Rule off and nothing
//!   stored: nothing is written.
//!
//! No random number is drawn anywhere (the microwave plant has no accident: known limit). Every
//! loop is bounded by [`MAX_PLANTS`], by a footprint or by the map size.

pub mod curve;
mod demand;
mod effects;
mod month;
mod plants;
mod rules;

use crate::power::{COAL_POWER_STRENGTH, NUCLEAR_POWER_STRENGTH};

pub(crate) use effects::pollution;
pub(crate) use month::monthly_balance;
pub use plants::Plant;
pub use rules::STATS_SIZE;

/// Genre reported for the classic coal plant (not a catalog genre).
pub const GENRE_COAL: u8 = 0;
/// Genre reported for the classic nuclear plant (not a catalog genre).
pub const GENRE_NUCLEAR: u8 = 1;
/// Genre of the gas plant (3 x 3).
pub const GENRE_GAS: u8 = 40;
/// Genre of the oil plant (3 x 3).
pub const GENRE_OIL: u8 = 41;
/// Genre of the wind turbine (1 x 1).
pub const GENRE_WIND: u8 = 42;
/// Genre of the solar plant (3 x 3).
pub const GENRE_SOLAR: u8 = 43;
/// Genre of the hydroelectric plant (2 x 2, on the water side).
pub const GENRE_HYDRO: u8 = 44;
/// Genre of the microwave plant (3 x 3).
pub const GENRE_MICROWAVE: u8 = 45;
/// Genre of the fusion plant (4 x 4).
pub const GENRE_FUSION: u8 = 46;
/// Months in a year of life span.
pub const MONTHS_PER_YEAR: u32 = 12;
/// Percent of the life span after which a plant loses power.
pub const WEAR_START_PCT: u32 = 80;
/// Percent of its power a plant still gives just before the end of its life.
pub const WEAR_FLOOR_PCT: i64 = 50;
/// Most plants whose age is kept (the extended buildings are capped at 256, a map holds at
/// most this many classic plants).
pub const MAX_PLANTS: usize = 1024;
/// Largest age in months (the saved field is 16 bits; a plant stopped long ago stays there).
pub const MAX_AGE_MONTHS: u32 = u16::MAX as u32;
/// Bytes of the plant count that opens chunk 10.
const COUNT_SIZE: usize = 2;
/// Bytes of a saved age: x (2, big-endian), y (2), months (2).
pub const RECORD_SIZE: usize = 6;

/// What a kind of plant gives. Costs and upkeep are the catalog's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlantSpec {
    pub genre: u8,
    /// Power tiles supplied while new.
    pub power: i64,
    /// Air pollution at the footprint of a running plant (0: none).
    pub pollution: i32,
    /// Tiles from the footprint past which the pollution is 0.
    pub radius: i32,
    /// Life span in years.
    pub life_years: u32,
}

const fn spec(genre: u8, power: i64, pollution: (i32, i32), life_years: u32) -> PlantSpec {
    PlantSpec {
        genre,
        power,
        pollution: pollution.0,
        radius: pollution.1,
        life_years,
    }
}

/// The plants by genre. The classic ones pollute through the classic scan, not through here.
pub const PLANTS: [PlantSpec; 9] = [
    spec(GENRE_COAL, COAL_POWER_STRENGTH, (0, 0), 50),
    spec(GENRE_NUCLEAR, NUCLEAR_POWER_STRENGTH, (0, 0), 50),
    spec(GENRE_GAS, 400, (30, 3), 40),
    spec(GENRE_OIL, 500, (50, 4), 40),
    spec(GENRE_WIND, 30, (0, 0), 20),
    spec(GENRE_SOLAR, 250, (0, 0), 30),
    spec(GENRE_HYDRO, 300, (0, 0), 60),
    spec(GENRE_MICROWAVE, 2_000, (0, 0), 50),
    spec(GENRE_FUSION, 3_000, (0, 0), 80),
];

/// The spec of `genre`, if it is a plant.
pub fn spec_of(genre: u8) -> Option<&'static PlantSpec> {
    PLANTS.iter().find(|p| p.genre == genre)
}

/// Whether `genre` is one of the seven plants of the catalog.
pub fn is_plant_genre(genre: u8) -> bool {
    (GENRE_GAS..=GENRE_FUSION).contains(&genre)
}

/// The age of one plant, by its anchor (top-left tile; the centre tile for a classic plant).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Age {
    pub x: i32,
    pub y: i32,
    pub months: u32,
}

/// The saved ages: sorted by `(x, y)`, no duplicate, at most [`MAX_PLANTS`]. A plant without an
/// entry is 0 months old.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EnergyState {
    ages: Vec<Age>,
}

impl EnergyState {
    pub fn is_empty(&self) -> bool {
        self.ages.is_empty()
    }

    pub fn as_slice(&self) -> &[Age] {
        &self.ages
    }

    /// Months of the plant anchored at `(x, y)` (0 when unknown).
    pub fn age_of(&self, x: i32, y: i32) -> u32 {
        match self.ages.binary_search_by_key(&(x, y), |a| (a.x, a.y)) {
            Ok(i) => self.ages[i].months,
            Err(_) => 0,
        }
    }

    /// Sets an age (capped at [`MAX_AGE_MONTHS`]). `false` when a new plant does not fit.
    pub fn set(&mut self, x: i32, y: i32, months: u32) -> bool {
        let months = months.min(MAX_AGE_MONTHS);
        match self.ages.binary_search_by_key(&(x, y), |a| (a.x, a.y)) {
            Ok(i) => self.ages[i].months = months,
            Err(_) if self.ages.len() >= MAX_PLANTS => return false,
            Err(i) => self.ages.insert(i, Age { x, y, months }),
        }
        true
    }

    /// Forgets the plant anchored at `(x, y)`.
    pub fn forget(&mut self, x: i32, y: i32) {
        if let Ok(i) = self.ages.binary_search_by_key(&(x, y), |a| (a.x, a.y)) {
            self.ages.remove(i);
        }
    }

    /// Keeps the ages for which `keep` is true.
    pub fn retain(&mut self, keep: impl FnMut(&Age) -> bool) {
        self.ages.retain(keep);
    }

    /// The bytes of chunk 10: the count, then the records; nothing when empty.
    pub fn encode(&self) -> Vec<u8> {
        if self.ages.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(COUNT_SIZE + self.ages.len() * RECORD_SIZE);
        out.extend_from_slice(&(self.ages.len() as u16).to_be_bytes());
        for a in &self.ages {
            out.extend_from_slice(&(a.x as u16).to_be_bytes());
            out.extend_from_slice(&(a.y as u16).to_be_bytes());
            out.extend_from_slice(&(a.months as u16).to_be_bytes());
        }
        out
    }

    /// The state stored in `bytes` for a `width` x `height` map. Refused: a cut count, a count
    /// that does not match the length or is over [`MAX_PLANTS`] or 0, a record off the map or
    /// not in strictly increasing `(x, y)` order.
    pub fn decode(bytes: &[u8], width: i32, height: i32) -> Result<EnergyState, &'static str> {
        if bytes.len() < COUNT_SIZE {
            return Err("energy chunk is cut short");
        }
        let count = usize::from(u16::from_be_bytes([bytes[0], bytes[1]]));
        if count == 0 || count > MAX_PLANTS {
            return Err("energy chunk has an impossible number of plants");
        }
        if bytes.len() != COUNT_SIZE + count * RECORD_SIZE {
            return Err("energy chunk is not a whole number of records");
        }
        let mut state = EnergyState::default();
        for r in bytes[COUNT_SIZE..].as_chunks::<RECORD_SIZE>().0 {
            let x = i32::from(u16::from_be_bytes([r[0], r[1]]));
            let y = i32::from(u16::from_be_bytes([r[2], r[3]]));
            let months = u32::from(u16::from_be_bytes([r[4], r[5]]));
            let last = state.ages.last().map(|a| (a.x, a.y));
            if x >= width || y >= height || last.is_some_and(|l| l >= (x, y)) {
                return Err("a plant of the energy chunk is off the map or out of order");
            }
            state.ages.push(Age { x, y, months });
        }
        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tables_are_sane() {
        assert_eq!(PLANTS.len(), 9);
        assert!(PLANTS.iter().all(|p| p.power > 0 && p.life_years > 0));
        assert!(PLANTS.iter().all(|p| (p.pollution > 0) == (p.radius > 0)));
        let polluting: Vec<u8> = PLANTS
            .iter()
            .filter(|p| p.pollution > 0)
            .map(|p| p.genre)
            .collect();
        assert_eq!(polluting, [GENRE_GAS, GENRE_OIL]);
        assert_eq!(spec_of(GENRE_WIND).map(|p| p.power), Some(30));
        assert_eq!(spec_of(2), None);
        assert!((GENRE_GAS..=GENRE_FUSION).all(|g| is_plant_genre(g) && spec_of(g).is_some()));
        assert!(!is_plant_genre(GENRE_COAL) && !is_plant_genre(39) && !is_plant_genre(47));
        const { assert!(WEAR_START_PCT < 100 && WEAR_FLOOR_PCT < 100) };
        const { assert!(MAX_PLANTS <= u16::MAX as usize) };
    }

    #[test]
    fn the_ages_stay_sorted_replace_forget_and_are_capped() {
        let mut s = EnergyState::default();
        assert!(s.is_empty() && s.encode().is_empty());
        assert!(s.set(9, 2, 5) && s.set(3, 8, 6) && s.set(3, 5, 7));
        let order: Vec<_> = s.as_slice().iter().map(|a| (a.x, a.y)).collect();
        assert_eq!(order, [(3, 5), (3, 8), (9, 2)]);
        assert!(s.set(3, 8, 600));
        assert_eq!((s.age_of(3, 8), s.age_of(4, 8)), (600, 0));
        assert!(s.set(3, 8, u32::MAX));
        assert_eq!(s.age_of(3, 8), MAX_AGE_MONTHS);
        s.forget(3, 8);
        s.forget(50, 50);
        assert_eq!(s.as_slice().len(), 2);
        let mut full = EnergyState::default();
        for i in 0..MAX_PLANTS as i32 {
            assert!(full.set(i, 1, 1));
        }
        assert!(!full.set(0, 2, 1) && full.set(0, 1, 2));
        assert_eq!(full.as_slice().len(), MAX_PLANTS);
    }

    fn sample() -> EnergyState {
        let mut s = EnergyState::default();
        s.set(70, 60, 65_535);
        s.set(1, 2, 0);
        s.set(1, 3, 123);
        s
    }

    #[test]
    fn the_state_round_trips() {
        let s = sample();
        let bytes = s.encode();
        assert_eq!(bytes.len(), COUNT_SIZE + 3 * RECORD_SIZE);
        assert_eq!(EnergyState::decode(&bytes, 80, 67), Ok(s));
    }

    #[test]
    fn a_bad_chunk_is_refused() {
        let rec =
            |x: u16, y: u16, m: u16| [x.to_be_bytes(), y.to_be_bytes(), m.to_be_bytes()].concat();
        let with = |n: u16, recs: &[Vec<u8>]| [n.to_be_bytes().to_vec(), recs.concat()].concat();
        let too_many: Vec<Vec<u8>> = (0..=MAX_PLANTS as u16).map(|i| rec(i, 1, 1)).collect();
        let bad = [
            vec![],
            vec![0],
            with(0, &[]),
            with(1, &[]),
            with(1, &[rec(1, 1, 1), rec(2, 2, 2)]),
            with(1, &[rec(80, 1, 5)]),
            with(1, &[rec(1, 67, 5)]),
            with(2, &[rec(5, 5, 1), rec(5, 5, 1)]),
            with(2, &[rec(6, 5, 1), rec(5, 9, 1)]),
            with(MAX_PLANTS as u16 + 1, &too_many),
            [with(1, &[rec(1, 1, 1)]), vec![0]].concat(),
        ];
        for (i, b) in bad.iter().enumerate() {
            assert!(EnergyState::decode(b, 80, 67).is_err(), "case {i}");
        }
    }
}
