//! The ageing of a plant: pure functions of the age in months.

use super::{PlantSpec, MONTHS_PER_YEAR, WEAR_FLOOR_PCT, WEAR_START_PCT};

/// Months a plant lives.
pub fn life_months(spec: &PlantSpec) -> u32 {
    spec.life_years * MONTHS_PER_YEAR
}

/// Age (months) up to which a plant gives all its power.
pub fn wear_start(spec: &PlantSpec) -> u32 {
    life_months(spec) * WEAR_START_PCT / 100
}

/// Power tiles a plant of `spec` gives at `age` months: all of them up to [`wear_start`], then
/// a linear fall to [`WEAR_FLOOR_PCT`] % at the end of life, then 0.
pub fn power_at(spec: &PlantSpec, age: u32) -> i64 {
    let (life, start) = (life_months(spec), wear_start(spec));
    if age >= life {
        0
    } else if age <= start {
        spec.power
    } else {
        let span = i64::from(life - start);
        let into = i64::from(age - start);
        let kept = 100 * span - (100 - WEAR_FLOOR_PCT) * into;
        spec.power * kept / (100 * span)
    }
}

/// Whether the plant has begun to lose power (past [`wear_start`]; a stopped plant too).
pub fn is_worn(spec: &PlantSpec, age: u32) -> bool {
    age > wear_start(spec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::energy::{spec_of, GENRE_GAS, GENRE_WIND, PLANTS};

    #[test]
    fn full_power_up_to_eighty_percent_then_a_fall_then_nothing() {
        let wind = spec_of(GENRE_WIND).unwrap(); // 30 tiles, 20 years = 240 months
        assert_eq!((life_months(wind), wear_start(wind)), (240, 192));
        for age in [0, 1, 100, 192] {
            assert_eq!(power_at(wind, age), 30, "age {age}");
            assert!(!is_worn(wind, age));
        }
        assert!(is_worn(wind, 193));
        assert_eq!(power_at(wind, 216), 30 * 75 / 100); // halfway: 75 %
        assert_eq!(power_at(wind, 239), 15); // 30 * 50.2 % rounded down
        assert_eq!(power_at(wind, 240), 0);
        assert_eq!(power_at(wind, u32::MAX / 2), 0);
        assert!(is_worn(wind, 240));
    }

    #[test]
    fn the_power_never_rises_with_age_and_stays_in_range_for_every_plant() {
        for p in &PLANTS {
            let mut last = p.power;
            for age in 0..=life_months(p) + 1 {
                let now = power_at(p, age);
                assert!(now <= last && (0..=p.power).contains(&now));
                if age > wear_start(p) && age < life_months(p) {
                    assert!(now * 2 >= p.power, "{} at {age}", p.genre);
                }
                last = now;
            }
        }
        let gas = spec_of(GENRE_GAS).unwrap();
        assert_eq!(power_at(gas, wear_start(gas) + 1), 397);
    }
}
