//! Ordinances (docs/game-design-v02.md): the player's city-wide decisions, each with a running
//! cost and a modest effect on crime, pollution, land value and demand.
//!
//! The active ordinances are the bits of [`Extensions::ordinances`] (bit `n` = ordinance `n` of
//! [`ORDINANCES`], `n` in `0..ORDINANCE_COUNT`; higher bits are ignored); they are saved in their
//! own chunk. Everything here is integer arithmetic, deterministic, without random number or
//! allocation, and every loop runs at most [`ORDINANCE_COUNT`] times.
//!
//! * **Cost**: charged once per tax collection (`collect_tax`, which in this engine runs every
//!   `TAX_FREQUENCY` = 48 city-time steps = once per game year; the page calls it "par an"):
//!   `base_cost + per_1000 * (population / 1000)` dollars, with the population of the census
//!   (`Simulation::get_population`, the figure the evaluation shows), per active ordinance.
//! * **Crime, pollution, land value**: the percentages of the active ordinances are summed and
//!   the value becomes `value * (100 + sum) / 100` (integer division, towards zero), then the
//!   call site clamps it to the range of its map. City-wide: the position is not used.
//! * **Demand**: at each valve update the sum `s` of the residential (resp. commercial,
//!   industrial) percentages pushes the valve by `range * s / VALVE_NUDGE_DIVISOR`, where `range`
//!   is the valve range (2000, 1500, 1500) and the divisor is 1000, i.e. `s` % of a tenth of the
//!   range per update (+8 % on a 2000 range: +16). The valve stays inside its range and a zone
//!   kind that needs its stadium, airport or seaport stays capped.

use crate::extensions::Extensions;
use crate::position::Position;
use crate::simulation::Simulation;
use crate::traffic::ZoneType;

/// Number of ordinances; the valid indices are `0..ORDINANCE_COUNT`.
pub const ORDINANCE_COUNT: usize = 8;

/// One ordinance of the table. Percentages are signed integers: a negative crime percentage
/// lowers crime, a positive demand percentage raises demand.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ordinance {
    /// Stable machine name; the page owns the French texts.
    pub key: &'static str,
    /// Fixed part of the cost of one tax collection, in dollars.
    pub base_cost: i32,
    /// Dollars added per full 1000 inhabitants.
    pub per_1000: i32,
    pub crime_pct: i32,
    pub pollution_pct: i32,
    pub land_pct: i32,
    pub res_pct: i32,
    pub com_pct: i32,
    pub ind_pct: i32,
}

const NONE: Ordinance = Ordinance {
    key: "",
    base_cost: 0,
    per_1000: 0,
    crime_pct: 0,
    pollution_pct: 0,
    land_pct: 0,
    res_pct: 0,
    com_pct: 0,
    ind_pct: 0,
};

/// The ordinances. The index is the bit in [`Extensions::ordinances`] and never changes (it is
/// saved); new ordinances are appended.
pub const ORDINANCES: [Ordinance; ORDINANCE_COUNT] = [
    // 0 Police de proximité
    Ordinance {
        key: "community_policing",
        base_cost: 200,
        per_1000: 30,
        crime_pct: -15,
        ..NONE
    },
    // 1 Programme anti-pollution
    Ordinance {
        key: "pollution_control",
        base_cost: 300,
        per_1000: 40,
        pollution_pct: -15,
        ..NONE
    },
    // 2 Recyclage
    Ordinance {
        key: "recycling",
        base_cost: 150,
        per_1000: 25,
        pollution_pct: -8,
        ..NONE
    },
    // 3 Promotion touristique
    Ordinance {
        key: "tourism",
        base_cost: 150,
        per_1000: 20,
        com_pct: 8,
        ..NONE
    },
    // 4 Incitations industrielles
    Ordinance {
        key: "industry_incentives",
        base_cost: 200,
        per_1000: 25,
        ind_pct: 8,
        ..NONE
    },
    // 5 Embellissement urbain
    Ordinance {
        key: "beautification",
        base_cost: 250,
        per_1000: 35,
        land_pct: 10,
        ..NONE
    },
    // 6 Couvre-feu des jeunes
    Ordinance {
        key: "curfew",
        base_cost: 100,
        per_1000: 15,
        crime_pct: -8,
        res_pct: -3,
        ..NONE
    },
    // 7 Promotion de la ville
    Ordinance {
        key: "city_promotion",
        base_cost: 200,
        per_1000: 30,
        res_pct: 8,
        ..NONE
    },
];

/// A valve is pushed by `range * pct / VALVE_NUDGE_DIVISOR` at each update.
pub const VALVE_NUDGE_DIVISOR: i32 = 1000;

/// What the page reads about one ordinance: its cost now and its effects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrdinanceInfo {
    /// Dollars charged at each tax collection, at the current population.
    pub monthly_cost: i32,
    pub crime_pct: i32,
    pub pollution_pct: i32,
    pub land_pct: i32,
    pub res_pct: i32,
    pub com_pct: i32,
    pub ind_pct: i32,
}

/// Cost of `o` for one tax collection at `population` inhabitants.
pub fn cost_at(o: &Ordinance, population: i64) -> i32 {
    let cost = i64::from(o.base_cost) + i64::from(o.per_1000) * (population.max(0) / 1000);
    cost.min(i64::from(i32::MAX)) as i32
}

/// Whether ordinance `index` is set in `mask` (false beyond the table).
fn is_set(mask: u32, index: usize) -> bool {
    index < ORDINANCE_COUNT && mask & (1 << index) != 0
}

/// Sum of one percentage over the active ordinances.
fn sum_pct(mask: u32, pct: fn(&Ordinance) -> i32) -> i32 {
    let mut sum = 0;
    for (i, o) in ORDINANCES.iter().enumerate() {
        if is_set(mask, i) {
            sum += pct(o);
        }
    }
    sum
}

/// `value` changed by `pct` percent (integer division towards zero, never below zero).
fn scaled(value: i32, pct: i32) -> i32 {
    (i64::from(value) * i64::from((100 + pct).max(0)) / 100).min(i64::from(i32::MAX)) as i32
}

/// Net cost of the active ordinances for one tax collection, in dollars (a cost is positive).
pub(crate) fn monthly_balance(sim: &Simulation) -> i32 {
    sim.ordinances_monthly_cost()
}

/// Crime `z` (0..=250) at world tile `(x, y)`, after the ordinances.
pub(crate) fn crime(sim: &Simulation, _x: i32, _y: i32, z: i32) -> i32 {
    scaled(z, sum_pct(sim.extensions().ordinances, |o| o.crime_pct))
}

/// Pollution `p` (0..=255) at world tile `(x, y)`, after the ordinances.
pub(crate) fn pollution(sim: &Simulation, _x: i32, _y: i32, p: i32) -> i32 {
    scaled(p, sum_pct(sim.extensions().ordinances, |o| o.pollution_pct))
}

/// Land value `v` (1..=250) at world tile `(x, y)`, after the ordinances.
pub(crate) fn land_value(sim: &Simulation, _x: i32, _y: i32, v: i32) -> i32 {
    scaled(v, sum_pct(sim.extensions().ordinances, |o| o.land_pct))
}

/// `valve` pushed by `pct` percent of a tenth of `range`, kept inside `-range..=range`.
fn nudged(valve: i16, pct: i32, range: i32) -> i16 {
    (i32::from(valve) + range * pct / VALVE_NUDGE_DIVISOR).clamp(-range, range) as i16
}

/// Adjusts the zoning valves after `set_valves` computed them.
pub(crate) fn valves(sim: &mut Simulation) {
    use crate::simulation::{COM_VALVE_RANGE, IND_VALVE_RANGE, RES_VALVE_RANGE};
    let mask = sim.extensions().ordinances;
    let (res, com, ind) = (
        sum_pct(mask, |o| o.res_pct),
        sum_pct(mask, |o| o.com_pct),
        sum_pct(mask, |o| o.ind_pct),
    );
    sim.res_valve = nudged(sim.res_valve, res, RES_VALVE_RANGE);
    sim.com_valve = nudged(sim.com_valve, com, COM_VALVE_RANGE);
    sim.ind_valve = nudged(sim.ind_valve, ind, IND_VALVE_RANGE);
    // A zone kind that still needs its stadium, airport or seaport keeps its cap.
    if sim.res_cap && sim.res_valve > 0 {
        sim.res_valve = 0;
    }
    if sim.com_cap && sim.com_valve > 0 {
        sim.com_valve = 0;
    }
    if sim.ind_cap && sim.ind_valve > 0 {
        sim.ind_valve = 0;
    }
}

impl Simulation {
    /// Number of ordinances (the valid indices are `0..ordinance_count()`).
    pub fn ordinance_count(&self) -> usize {
        ORDINANCE_COUNT
    }

    /// Stable key of ordinance `index`; `None` beyond the table.
    pub fn ordinance_key(&self, index: usize) -> Option<&'static str> {
        ORDINANCES.get(index).map(|o| o.key)
    }

    /// Cost now and effects of ordinance `index`; `None` beyond the table.
    pub fn ordinance_info(&self, index: usize) -> Option<OrdinanceInfo> {
        let o = ORDINANCES.get(index)?;
        Some(OrdinanceInfo {
            monthly_cost: cost_at(o, self.get_population()),
            crime_pct: o.crime_pct,
            pollution_pct: o.pollution_pct,
            land_pct: o.land_pct,
            res_pct: o.res_pct,
            com_pct: o.com_pct,
            ind_pct: o.ind_pct,
        })
    }

    /// Whether ordinance `index` is on (false beyond the table).
    pub fn ordinance_active(&self, index: usize) -> bool {
        is_set(self.extensions.ordinances, index)
    }

    /// Turns ordinance `index` on or off, from the next tick. `false` (nothing changed) beyond
    /// the table.
    pub fn set_ordinance(&mut self, index: usize, on: bool) -> bool {
        if index >= ORDINANCE_COUNT {
            return false;
        }
        if on {
            self.extensions.ordinances |= 1 << index;
        } else {
            self.extensions.ordinances &= !(1 << index);
        }
        true
    }

    /// What the active ordinances cost at each tax collection, at the current population.
    pub fn ordinances_monthly_cost(&self) -> i32 {
        let population = self.get_population();
        let mask = self.extensions.ordinances;
        let mut total: i64 = 0;
        for (i, o) in ORDINANCES.iter().enumerate() {
            if is_set(mask, i) {
                total += i64::from(cost_at(o, population));
            }
        }
        total.min(i64::from(i32::MAX)) as i32
    }
}

/// Whether the ordinances let a zone of `kind` at `pos` grow.
pub(crate) fn zone_can_grow(_sim: &Simulation, _pos: Position, _kind: ZoneType) -> bool {
    true
}

/// The bytes of the ordinances chunk: the active set, as a big-endian `u32`; nothing when no
/// ordinance is active.
pub(crate) fn encode(ext: &Extensions) -> Vec<u8> {
    if ext.ordinances == 0 {
        Vec::new()
    } else {
        ext.ordinances.to_be_bytes().to_vec()
    }
}

/// The active set stored in `bytes` (empty: none). `Err` with the reason when the chunk is not
/// exactly four bytes.
pub(crate) fn decode(bytes: &[u8]) -> Result<u32, &'static str> {
    match bytes.len() {
        0 => Ok(0),
        4 => Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
        _ => Err("ordinances chunk is not 4 bytes"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sim_with(mask: u32) -> Simulation {
        let mut s = Simulation::new(80, 67);
        s.extensions_mut().ordinances = mask;
        s
    }

    /// A city of exactly `population` inhabitants (res_pop * 20).
    fn populated(mask: u32, population: i64) -> Simulation {
        let mut s = sim_with(mask);
        s.res_pop = (population / 20) as i16;
        s
    }

    #[test]
    fn the_chunk_round_trips_and_is_absent_when_nothing_is_active() {
        let mut ext = Extensions::default();
        assert!(encode(&ext).is_empty());
        ext.ordinances = 0b1010_0001;
        assert_eq!(decode(&encode(&ext)), Ok(0b1010_0001));
        assert_eq!(decode(&[]), Ok(0));
        assert!(decode(&[1, 2, 3]).is_err());
    }

    #[test]
    fn the_table_has_unique_keys_and_modest_effects() {
        assert_eq!(ORDINANCES.len(), ORDINANCE_COUNT);
        for (i, o) in ORDINANCES.iter().enumerate() {
            assert!(!o.key.is_empty());
            assert!(ORDINANCES[..i].iter().all(|p| p.key != o.key), "{}", o.key);
            assert!(o.base_cost > 0 && o.per_1000 > 0, "{}", o.key);
            for pct in [
                o.crime_pct,
                o.pollution_pct,
                o.land_pct,
                o.res_pct,
                o.com_pct,
                o.ind_pct,
            ] {
                assert!((-30..=30).contains(&pct), "{}", o.key);
            }
        }
        // Every effect is used by at least one ordinance.
        let used = |f: fn(&Ordinance) -> i32| ORDINANCES.iter().any(|o| f(o) != 0);
        assert!(used(|o| o.crime_pct) && used(|o| o.pollution_pct) && used(|o| o.land_pct));
        assert!(used(|o| o.res_pct) && used(|o| o.com_pct) && used(|o| o.ind_pct));
    }

    #[test]
    fn set_and_clear_use_the_bit_of_the_index() {
        let mut s = sim_with(0);
        assert!(s.set_ordinance(0, true));
        assert!(s.set_ordinance(5, true));
        assert_eq!(s.extensions().ordinances, 0b10_0001);
        assert!(s.ordinance_active(0) && s.ordinance_active(5) && !s.ordinance_active(1));
        assert!(s.set_ordinance(0, false));
        assert_eq!(s.extensions().ordinances, 0b10_0000);
        assert!(s.set_ordinance(5, false));
        assert!(!s.extensions_active());
        // Setting twice changes nothing more.
        assert!(s.set_ordinance(3, true) && s.set_ordinance(3, true));
        assert_eq!(s.extensions().ordinances, 1 << 3);
    }

    #[test]
    fn an_invalid_index_changes_nothing() {
        let mut s = sim_with(0b101);
        for i in [ORDINANCE_COUNT, ORDINANCE_COUNT + 1, 31, 32, usize::MAX] {
            assert!(!s.set_ordinance(i, true), "{i}");
            assert!(!s.set_ordinance(i, false), "{i}");
            assert!(!s.ordinance_active(i), "{i}");
            assert!(
                s.ordinance_info(i).is_none() && s.ordinance_key(i).is_none(),
                "{i}"
            );
        }
        assert_eq!(s.extensions().ordinances, 0b101);
        // A stray high bit (an edited file) is neither active nor charged.
        let s = populated(1 << 31, 10_000);
        assert!(!s.ordinance_active(31));
        assert_eq!(s.ordinances_monthly_cost(), 0);
    }

    #[test]
    fn the_cost_is_base_plus_per_thousand_inhabitants() {
        let o = &ORDINANCES[0]; // 200 + 30 per 1000
        assert_eq!(cost_at(o, 0), 200);
        assert_eq!(cost_at(o, 999), 200);
        assert_eq!(cost_at(o, 1000), 230);
        assert_eq!(cost_at(o, 25_999), 200 + 30 * 25);
        assert_eq!(cost_at(o, -5), 200);
        assert_eq!(cost_at(o, i64::MAX), i32::MAX);
        let s = populated(0b11, 10_000);
        assert_eq!(s.ordinance_info(0).unwrap().monthly_cost, 200 + 30 * 10);
        assert_eq!(s.ordinance_info(1).unwrap().monthly_cost, 300 + 40 * 10);
        // The total counts the active ones only.
        assert_eq!(s.ordinances_monthly_cost(), 500 + 700);
        assert_eq!(populated(0, 10_000).ordinances_monthly_cost(), 0);
        // Every ordinance on, at a population large enough to overflow i32 if added naively.
        let all = populated((1 << ORDINANCE_COUNT) - 1, 20 * i64::from(i16::MAX));
        assert!(all.ordinances_monthly_cost() > 0);
    }

    #[test]
    fn the_monthly_balance_is_the_total_cost() {
        let s = populated(0b100, 4_000);
        assert_eq!(monthly_balance(&s), 150 + 25 * 4);
        assert_eq!(monthly_balance(&populated(0, 4_000)), 0);
    }

    #[test]
    fn crime_pollution_and_land_value_follow_their_percentages() {
        // police de proximité (-15 % crime)
        let s = sim_with(1 << 0);
        assert_eq!(crime(&s, 3, 4, 100), 85);
        assert_eq!(crime(&s, 3, 4, 250), 212);
        assert_eq!(crime(&s, 3, 4, 0), 0);
        assert_eq!(pollution(&s, 3, 4, 100), 100);
        assert_eq!(land_value(&s, 3, 4, 100), 100);
        // anti-pollution (-15 %) and recyclage (-8 %) add up to -23 %
        let s = sim_with((1 << 1) | (1 << 2));
        assert_eq!(pollution(&s, 0, 0, 200), 154);
        assert_eq!(crime(&s, 0, 0, 200), 200);
        // embellissement (+10 % land value)
        let s = sim_with(1 << 5);
        assert_eq!(land_value(&s, 0, 0, 100), 110);
        assert_eq!(land_value(&s, 0, 0, 1), 1);
        assert_eq!(land_value(&s, 0, 0, 250), 275); // the call site clamps to 250
                                                    // police + couvre-feu: -23 % crime
        let s = sim_with((1 << 0) | (1 << 6));
        assert_eq!(crime(&s, 0, 0, 100), 77);
        // nothing active: unchanged
        let s = sim_with(0);
        assert_eq!(
            (
                crime(&s, 0, 0, 77),
                pollution(&s, 0, 0, 78),
                land_value(&s, 0, 0, 79)
            ),
            (77, 78, 79)
        );
    }

    #[test]
    fn effects_stay_within_bounds_after_the_call_site_clamp() {
        let all = sim_with((1 << ORDINANCE_COUNT) - 1);
        for v in 0..=255 {
            let c = crime(&all, 0, 0, v).clamp(0, 250);
            assert!(c <= v.clamp(0, 250));
            let p = pollution(&all, 0, 0, v).clamp(0, 255);
            assert!(p <= v);
            let l = land_value(&all, 0, 0, v.max(1)).clamp(1, 250);
            assert!(l >= v.clamp(1, 250));
        }
        assert_eq!(scaled(100, -500), 0, "never negative");
    }

    #[test]
    fn valves_are_nudged_inside_their_range() {
        // promotion de la ville: +8 % residential: 2000 * 8 / 1000 = 16
        let mut s = sim_with(1 << 7);
        s.res_valve = 100;
        valves(&mut s);
        assert_eq!((s.res_valve, s.com_valve, s.ind_valve), (116, 0, 0));
        // promotion touristique +8 % on 1500, incitations +8 % on 1500: 12 each
        let mut s = sim_with((1 << 3) | (1 << 4));
        valves(&mut s);
        assert_eq!((s.res_valve, s.com_valve, s.ind_valve), (0, 12, 12));
        // couvre-feu: -3 % residential: -6
        let mut s = sim_with(1 << 6);
        valves(&mut s);
        assert_eq!(s.res_valve, -6);
        // promotion + couvre-feu: +5 % = 10
        let mut s = sim_with((1 << 6) | (1 << 7));
        valves(&mut s);
        assert_eq!(s.res_valve, 10);
        // the range is a ceiling and a floor
        let mut s = sim_with(1 << 7);
        s.res_valve = 1995;
        valves(&mut s);
        assert_eq!(s.res_valve, 2000);
        let mut s = sim_with(1 << 6);
        s.res_valve = -1998;
        valves(&mut s);
        assert_eq!(s.res_valve, -2000);
        // nothing active: unchanged
        let mut s = sim_with(0);
        s.res_valve = 7;
        valves(&mut s);
        assert_eq!(s.res_valve, 7);
    }

    #[test]
    fn a_capped_zone_kind_stays_capped() {
        let mut s = sim_with((1 << 3) | (1 << 4) | (1 << 7));
        s.res_cap = true;
        s.com_cap = true;
        s.ind_cap = true;
        valves(&mut s);
        assert_eq!((s.res_valve, s.com_valve, s.ind_valve), (0, 0, 0));
    }

    #[test]
    fn the_hooks_use_the_table_without_random_numbers() {
        let mut s = sim_with(1 << 0);
        let before = s.rng.clone();
        assert_eq!(s.ext_crime(1, 1, 100), 85);
        s.ext_valves();
        assert_eq!(s.rng.random16(), before.clone().random16());
        // The hook pays the cost through spend at the collection.
        let mut s = populated(1 << 0, 10_000);
        let funds = s.total_funds;
        s.ext_monthly_balance();
        assert_eq!(s.total_funds, funds - 500);
    }
}
