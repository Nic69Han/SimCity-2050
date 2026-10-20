//! Public services (docs/game-design-v09.md): schools, colleges, libraries and museums raise the
//! **education quotient** (EQ); clinics and hospitals lengthen the **life expectancy**; the prison
//! lowers crime. The buildings are genres 30-36 of the structures catalog. With the rule
//! ([`Extensions::services`](crate::extensions::Extensions::services)) off, or the structures off,
//! nothing here acts: the hooks answer their input, the buildings cannot be placed and the engine
//! is the original.
//!
//! * **Coverage.** Each residential zone (its residents are its classic zone population) is
//!   served by the nearest working building of each genre whose footprint is within the building
//!   radius (Manhattan distance, ties to the oldest building). A building shares its
//!   [`Service::capacity`] among the residents assigned to it: it serves `min(assigned, capacity)`.
//!   The coverage of a genre is the percentage of all the residents it serves.
//! * **Targets.** The EQ target adds [`Service::weight`] x coverage for the four education
//!   genres (at most [`EQ_MAX`]); the life expectancy target is [`LIFE_BASE`] plus the same sum
//!   for the two health genres (at most [`LIFE_MAX`]). Both values move once a month
//!   by at most [`EQ_STEP`] / [`LIFE_STEP`] toward the target. They start at [`EQ_START`] and
//!   [`LIFE_START`], which are the targets of a city without service: effects are bonuses, so
//!   turning the rule on without a building changes nothing.
//! * **Effects.** `ext_valves`: a bounded push of the commercial valve with the EQ and of the
//!   residential valve with the life expectancy (never above [`VALVE_PUSH_CEILING`], never past a
//!   stadium or airport cap). `ext_pollution`: up to [`POLLUTION_CUT_MAX_PCT`] percent less
//!   pollution at the maximum EQ (the pollution map mixes industry, traffic and plants: the cut is
//!   on the block's value). `ext_crime`: a working prison cuts the crime in its radius, scaled by
//!   how well its places meet the demand. `ext_land_value`: a working prison lowers the land value
//!   nearby.
//! * **Prison demand.** `residents x crime average / PRISON_DEMAND_DIV` detainees; the places are
//!   the capacities of the working prisons.
//! * **Upkeep** is the one of the structures (`structures::monthly_balance` sums every intact
//!   building): nothing is added to `ext_monthly_balance`, so nothing is counted twice.
//! * **Save**: the switch is bit 0 of the second byte of the rules chunk; chunk 9 holds the EQ and
//!   the life expectancy (2 bytes), written only when they differ from the start values.
//!
//! No random number is drawn anywhere. Every loop is bounded by [`MAX_STRUCTURES`]
//! (crate::structures::MAX_STRUCTURES), by the map size, by the radius constants or by the
//! 7 genres.

mod effects;
mod report;
mod rules;

use crate::structures::Structure;

pub(crate) use effects::{crime, land_value, pollution, valves};
pub use rules::STATS_SIZE;

/// Genre of the school (2 x 2).
pub const GENRE_SCHOOL: u8 = 30;
/// Genre of the college (3 x 3).
pub const GENRE_COLLEGE: u8 = 31;
/// Genre of the library (2 x 2).
pub const GENRE_LIBRARY: u8 = 32;
/// Genre of the museum (3 x 3).
pub const GENRE_MUSEUM: u8 = 33;
/// Genre of the clinic (1 x 1).
pub const GENRE_CLINIC: u8 = 34;
/// Genre of the hospital (3 x 3).
pub const GENRE_HOSPITAL: u8 = 35;
/// Genre of the prison (3 x 3).
pub const GENRE_PRISON: u8 = 36;

/// What a service building is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    Education,
    Health,
    Justice,
}

/// The service side of a catalog entry: its class, its capacity and its weight.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Service {
    pub genre: u8,
    pub class: Class,
    /// Residents (in classic zone population units) the building can serve; for a prison, the
    /// detainees it can hold.
    pub capacity: i32,
    /// EQ points (education) or years of life expectancy (health) at a coverage of 100 percent.
    pub weight: i32,
}

const fn service(genre: u8, class: Class, capacity: i32, weight: i32) -> Service {
    Service {
        genre,
        class,
        capacity,
        weight,
    }
}

/// The service buildings, in genre order.
pub const SERVICES: [Service; 7] = [
    service(GENRE_SCHOOL, Class::Education, 150, 60),
    service(GENRE_COLLEGE, Class::Education, 300, 40),
    service(GENRE_LIBRARY, Class::Education, 200, 30),
    service(GENRE_MUSEUM, Class::Education, 250, 20),
    service(GENRE_CLINIC, Class::Health, 80, 15),
    service(GENRE_HOSPITAL, Class::Health, 400, 25),
    service(GENRE_PRISON, Class::Justice, 100, 0),
];

/// The service of `genre`, if it is a service building.
pub fn service_of(genre: u8) -> Option<&'static Service> {
    SERVICES.iter().find(|s| s.genre == genre)
}

/// Whether `genre` is one of the service buildings.
pub fn is_service_genre(genre: u8) -> bool {
    service_of(genre).is_some()
}

/// Largest education quotient.
pub const EQ_MAX: i32 = 150;
/// Education quotient of a new city (and the target without any school).
pub const EQ_START: i32 = 0;
/// Largest change of the EQ in one month.
pub const EQ_STEP: i32 = 3;
/// Smallest life expectancy, in years.
pub const LIFE_MIN: i32 = 40;
/// Largest life expectancy, in years.
pub const LIFE_MAX: i32 = 90;
/// Life expectancy target without any health building.
pub const LIFE_BASE: i32 = 50;
/// Life expectancy of a new city.
pub const LIFE_START: i32 = LIFE_BASE;
/// Largest change of the life expectancy in one month, in years.
pub const LIFE_STEP: i32 = 1;

/// Valve push per call (one every two simulated cycles): EQ points per point of commercial push.
pub const EQ_VALVE_DIV: i32 = 50;
/// Valve push per call: years above [`LIFE_BASE`] per point of residential push.
pub const LIFE_VALVE_DIV: i32 = 10;
/// The services never push a valve above this value (the valves range up to 1500-2000).
pub const VALVE_PUSH_CEILING: i32 = 500;
/// Percent of the pollution removed at [`EQ_MAX`] (linear in the EQ).
pub const POLLUTION_CUT_MAX_PCT: i32 = 30;
/// Percent of the crime a fully effective prison removes at its footprint.
pub const PRISON_CRIME_CUT_PCT: i32 = 40;
/// Largest percent of the crime the prisons remove together.
pub const PRISON_CRIME_CUT_MAX_PCT: i32 = 60;
/// Detainees = residents x crime average / this.
pub const PRISON_DEMAND_DIV: i32 = 1000;
/// Land value points a prison removes at its footprint.
pub const PRISON_LAND_MALUS: i32 = 25;
/// Tiles from the footprint up to which a prison lowers the land value.
pub const PRISON_LAND_RADIUS: i32 = 6;
/// Largest land value malus the prisons give a block together.
pub const PRISON_LAND_MALUS_CAP: i32 = 40;
/// Bytes of chunk 9: EQ (1), life expectancy (1).
pub const STATE_SIZE: usize = 2;

const _: () = {
    // the weights of a class add up to the range its target can cover
    assert!(
        SERVICES[0].weight + SERVICES[1].weight + SERVICES[2].weight + SERVICES[3].weight
            == EQ_MAX - EQ_START
    );
    assert!(SERVICES[4].weight + SERVICES[5].weight == LIFE_MAX - LIFE_BASE);
    assert!(LIFE_MIN <= LIFE_BASE && PRISON_CRIME_CUT_PCT <= PRISON_CRIME_CUT_MAX_PCT);
};

/// The two saved numbers: the education quotient and the life expectancy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceState {
    pub eq: i32,
    pub life: i32,
}

impl Default for ServiceState {
    fn default() -> Self {
        ServiceState {
            eq: EQ_START,
            life: LIFE_START,
        }
    }
}

impl ServiceState {
    /// The bytes of chunk 9; nothing while the numbers are the start values.
    pub fn encode(&self) -> Vec<u8> {
        if *self == ServiceState::default() {
            return Vec::new();
        }
        vec![self.eq as u8, self.life as u8]
    }

    /// The state stored in `bytes`. Refused: a length other than 0 or [`STATE_SIZE`], an EQ above
    /// [`EQ_MAX`] or a life expectancy out of [`LIFE_MIN`]..=[`LIFE_MAX`].
    pub fn decode(bytes: &[u8]) -> Result<ServiceState, &'static str> {
        match bytes {
            [] => Ok(ServiceState::default()),
            &[eq, life] => {
                let state = ServiceState {
                    eq: i32::from(eq),
                    life: i32::from(life),
                };
                if state.eq > EQ_MAX || !(LIFE_MIN..=LIFE_MAX).contains(&state.life) {
                    return Err("services chunk is out of range");
                }
                Ok(state)
            }
            _ => Err("services chunk is not 2 bytes"),
        }
    }
}

/// Numbers measured at the last monthly pass, read by the hooks. Runtime state: never saved,
/// ignored when comparing.
#[derive(Debug, Clone, Copy, Default)]
pub struct ServiceCache {
    /// The month (`city_time >> 2`) of the last pass, `None` before the first.
    pub(crate) month: Option<i64>,
    /// Detainees the city would send to prison.
    pub(crate) prison_demand: i32,
}

impl PartialEq for ServiceCache {
    fn eq(&self, _: &ServiceCache) -> bool {
        true
    }
}
impl Eq for ServiceCache {}

/// Percent of its demand a set of prisons meets with `places` (100 when nobody is to be held).
pub(crate) fn met_pct(places: i32, demand: i32) -> i32 {
    if demand <= places {
        100
    } else {
        places * 100 / demand
    }
}

/// `value` moved toward `target` by at most `step`.
pub(crate) fn step_toward(value: i32, target: i32, step: i32) -> i32 {
    value + (target - value).clamp(-step, step)
}

/// Whether `s` is a listed prison.
pub(crate) fn is_prison(s: &Structure) -> bool {
    s.genre == GENRE_PRISON
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structures::{kind_of, CATALOG};

    #[test]
    fn every_service_has_a_catalog_entry_that_needs_power() {
        assert_eq!(CATALOG.len(), 7 + SERVICES.len());
        for s in &SERVICES {
            let k = kind_of(s.genre).expect("in the catalog");
            assert_eq!(k.flags, crate::structures::FLAG_POWER, "genre {}", s.genre);
            assert!(s.capacity > 0 && k.radius > 0 && k.upkeep > 0);
        }
        let sizes: Vec<_> = SERVICES
            .iter()
            .map(|s| kind_of(s.genre).map(|k| (k.width, k.height)))
            .collect();
        let want = [(2, 2), (3, 3), (2, 2), (3, 3), (1, 1), (3, 3), (3, 3)];
        assert_eq!(sizes, want.map(Some));
        assert!(service_of(1).is_none() && !is_service_genre(29) && is_service_genre(36));
    }

    #[test]
    fn the_state_round_trips_and_the_start_values_are_empty_bytes() {
        assert!(ServiceState::default().encode().is_empty());
        assert_eq!(ServiceState::decode(&[]), Ok(ServiceState::default()));
        for (eq, life) in [(1, 50), (0, 51), (EQ_MAX, LIFE_MAX), (7, LIFE_MIN)] {
            let s = ServiceState { eq, life };
            assert_eq!(s.encode().len(), STATE_SIZE);
            assert_eq!(ServiceState::decode(&s.encode()), Ok(s));
        }
    }

    #[test]
    fn a_bad_state_is_refused() {
        let bad: [&[u8]; 6] = [
            &[1],
            &[1, 50, 0],
            &[151, 50],
            &[0, 39],
            &[0, 91],
            &[255, 255],
        ];
        for (i, b) in bad.iter().enumerate() {
            assert!(ServiceState::decode(b).is_err(), "case {i}");
        }
    }

    #[test]
    fn steps_are_bounded_and_land_on_the_target() {
        assert_eq!(step_toward(10, 100, 3), 13);
        assert_eq!(step_toward(10, 0, 3), 7);
        assert_eq!(step_toward(10, 11, 3), 11);
        assert_eq!(step_toward(10, 10, 3), 10);
    }

    #[test]
    fn the_prison_effect_is_the_share_of_the_demand_that_has_a_place() {
        assert_eq!(met_pct(0, 0), 100);
        assert_eq!(met_pct(100, 100), 100);
        assert_eq!(met_pct(100, 400), 25);
        assert_eq!(met_pct(0, 10), 0);
    }
}
