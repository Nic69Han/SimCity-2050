//! The zones the economy sees (kind, population, land value), their wealth and the income of
//! each tax case.

use super::{
    CASES, DIFFICULTY_PCT, KINDS, KIND_COMMERCIAL, KIND_INDUSTRIAL, KIND_RESIDENTIAL, LAND_DIV,
    POP_UNITS, WEALTHS, WEALTH_HIGH, WEALTH_MID,
};
use crate::densities::{zone_genre, GENRE_COMMERCIAL, GENRE_INDUSTRIAL, GENRE_RESIDENTIAL};
use crate::simulation::Simulation;
use crate::tile::LOMASK;
use crate::tile_chars::FREEZ;
use crate::waste::TIER_POPULATION;

/// A residential, commercial or industrial zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EcoZone {
    /// 1 residential, 2 commercial, 3 industrial.
    pub kind: i32,
    /// Centre tile.
    pub x: i32,
    pub y: i32,
    /// Population on the residential scale (residents; commercial and industrial tiers count
    /// [`TIER_POPULATION`] each).
    pub pop: i64,
    /// Land value (0..=250) of the block of the centre tile.
    pub land: i32,
}

/// Wealth (1 modest, 2 average, 3 wealthy) of a land value.
pub fn wealth_of(land: i32) -> i32 {
    if land < WEALTH_MID {
        1
    } else if land < WEALTH_HIGH {
        2
    } else {
        3
    }
}

/// Index of the tax case (0..[`CASES`]) of a kind (1..=3) and a wealth (1..=3).
pub fn case_of(kind: i32, wealth: i32) -> usize {
    ((kind - 1) as usize) * WEALTHS + (wealth - 1) as usize
}

impl EcoZone {
    /// The tax case of this zone.
    pub fn case(&self) -> usize {
        case_of(self.kind, wealth_of(self.land))
    }
}

impl Simulation {
    /// Every zone of the map, in tile order (`x` then `y`). Bounded by the map size.
    pub(crate) fn economy_zones(&self) -> Vec<EcoZone> {
        let (w, h) = self.world_size();
        let mut out = Vec::new();
        for x in 0..w {
            for y in 0..h {
                let Some(tile) = self.tile(x, y) else {
                    continue;
                };
                let Some(genre) = zone_genre(tile) else {
                    continue;
                };
                let t = tile & LOMASK;
                let (kind, pop) = match genre {
                    GENRE_RESIDENTIAL if t == FREEZ => (KIND_RESIDENTIAL, 0),
                    GENRE_RESIDENTIAL => (KIND_RESIDENTIAL, i64::from(self.get_res_zone_pop(t))),
                    GENRE_COMMERCIAL => (
                        KIND_COMMERCIAL,
                        i64::from(self.get_com_zone_pop(t)) * TIER_POPULATION,
                    ),
                    GENRE_INDUSTRIAL => (
                        KIND_INDUSTRIAL,
                        i64::from(self.get_ind_zone_pop(t)) * TIER_POPULATION,
                    ),
                    _ => continue,
                };
                let land = i32::from(self.land_value_map.world_get(x, y));
                out.push(EcoZone {
                    kind,
                    x,
                    y,
                    pop: pop.max(0),
                    land,
                });
            }
        }
        out
    }
}

/// Income of each case in dollars: `sum(pop x land) x rate x difficulty / (8 x 120 x 100)`,
/// rounded down per case. `level` is the game level (0..=2, anything else counts as 2).
pub fn income_by_case(zones: &[EcoZone], rates: &[i32; CASES], level: usize) -> [i64; CASES] {
    let mut weighted = [0i64; CASES];
    for z in zones {
        weighted[z.case()] += z.pop * i64::from(z.land);
    }
    let pct = DIFFICULTY_PCT[level.min(DIFFICULTY_PCT.len() - 1)];
    let mut out = [0i64; CASES];
    for (i, w) in weighted.iter().enumerate() {
        out[i] = w * i64::from(rates[i]) * pct / (POP_UNITS * LAND_DIV * 100);
    }
    out
}

/// Mean rate of a kind, in percent, weighted by the population of its zones (rounded to the
/// nearest); `None` when the kind has no population.
pub fn mean_rate(zones: &[EcoZone], rates: &[i32; CASES], kind: i32) -> Option<i32> {
    let (mut sum, mut pop) = (0i64, 0i64);
    for z in zones.iter().filter(|z| z.kind == kind) {
        sum += z.pop * i64::from(rates[z.case()]);
        pop += z.pop;
    }
    if pop == 0 {
        return None;
    }
    Some(((2 * sum + pop) / (2 * pop)) as i32)
}

const _: () = assert!(KINDS == 3 && KIND_RESIDENTIAL == 1 && KIND_INDUSTRIAL == 3);

#[cfg(test)]
mod tests {
    use super::*;

    fn zone(kind: i32, pop: i64, land: i32) -> EcoZone {
        EcoZone {
            kind,
            x: 0,
            y: 0,
            pop,
            land,
        }
    }

    #[test]
    fn wealth_follows_the_land_value_thresholds() {
        let at = |v| wealth_of(v);
        assert_eq!(
            [at(0), at(59), at(60), at(119), at(120), at(250)],
            [1, 1, 2, 2, 3, 3]
        );
    }

    #[test]
    fn the_case_is_kind_then_wealth() {
        assert_eq!(case_of(1, 1), 0);
        assert_eq!(case_of(1, 3), 2);
        assert_eq!(case_of(2, 1), 3);
        assert_eq!(case_of(3, 3), 8);
        assert_eq!(zone(KIND_COMMERCIAL, 1, 130).case(), 5);
    }

    #[test]
    fn the_income_is_the_classic_formula_on_the_residential_scale() {
        // 960 population units (120 classic units) at land value 100, 10 %, easy: classic
        // 120 x 100 / 120 x 10 = 1000, x 1.4
        let zones = [zone(KIND_RESIDENTIAL, 960, 100)];
        let mut rates = [0; CASES];
        rates[case_of(1, 2)] = 10;
        let income = income_by_case(&zones, &rates, 0);
        assert_eq!(income[case_of(1, 2)], 1_400);
        assert_eq!(income.iter().sum::<i64>(), 1_400);
        assert_eq!(income_by_case(&zones, &rates, 1)[1], 1_200);
        assert_eq!(income_by_case(&zones, &rates, 2)[1], 800);
        assert_eq!(
            income_by_case(&zones, &rates, 9)[1],
            800,
            "levels are capped"
        );
    }

    #[test]
    fn each_case_takes_its_own_rate_and_a_zero_rate_pays_nothing() {
        let zones = [
            zone(KIND_RESIDENTIAL, 960, 30),
            zone(KIND_COMMERCIAL, 960, 100),
            zone(KIND_INDUSTRIAL, 960, 200),
        ];
        let mut rates = [0; CASES];
        rates[case_of(1, 1)] = 20;
        rates[case_of(2, 2)] = 10;
        let income = income_by_case(&zones, &rates, 0);
        assert_eq!(income[case_of(1, 1)], 960 * 30 * 20 * 140 / (960 * 100));
        assert_eq!(income[case_of(2, 2)], 1_400);
        assert_eq!(income[case_of(3, 3)], 0);
        assert_eq!(income[case_of(1, 2)], 0, "no zone there");
    }

    #[test]
    fn the_mean_rate_is_weighted_by_population() {
        let zones = [
            zone(KIND_RESIDENTIAL, 30, 10),
            zone(KIND_RESIDENTIAL, 10, 100),
            zone(KIND_INDUSTRIAL, 0, 100),
        ];
        let mut rates = [0; CASES];
        rates[case_of(1, 1)] = 4;
        rates[case_of(1, 2)] = 8;
        // (30 x 4 + 10 x 8) / 40 = 5
        assert_eq!(mean_rate(&zones, &rates, 1), Some(5));
        assert_eq!(mean_rate(&zones, &rates, 2), None);
        assert_eq!(mean_rate(&zones, &rates, 3), None, "no population");
        rates[case_of(1, 2)] = 9; // 210 / 40 = 5.25 rounds to 5
        assert_eq!(mean_rate(&zones, &rates, 1), Some(5));
    }
}
