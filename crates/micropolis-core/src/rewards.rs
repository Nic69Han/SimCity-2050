//! Rewards and special deals (docs/game-design-v12.md): buildings the city **earns** (free, one
//! of each, unlocked for good once the population and the satisfaction reach their thresholds)
//! and buildings **offered by petitioners** (free, a yearly income, a drawback). With the rule
//! ([`Extensions::rewards`](crate::extensions::Extensions::rewards)) off, or the extended
//! buildings ([`Extensions::structures`](crate::extensions::Extensions::structures)) off, nothing
//! here acts: the hooks answer their input, the calls are refused or empty and the engine is
//! the original.
//!
//! * **Year.** One pass of `ext_monthly_balance`, which the classic engine runs at each tax
//!   collection (once per game year). It unlocks, proposes and pays. Turning the rule on also
//!   runs the unlock and offer check once, so a city that already qualifies sees it at once.
//! * **Population** is [`Simulation::get_population`](crate::simulation::Simulation::get_population)
//!   (inhabitants); **satisfaction** is `city_yes`, the percentage of favourable opinions of the
//!   yearly evaluation.
//! * **Rewards** (genres 50-54, [`REWARDS`], catalog entries that reuse the park's `amenity`):
//!   unlocked when population >= its threshold and satisfaction >= its threshold; never locked
//!   again. Placing one needs it unlocked and none of its genre standing.
//! * **Offers** (genres 60-63, [`DEALS`]): proposed at the pass where the population reaches the
//!   threshold. [`answer_offer`](Simulation::answer_offer) accepts (one placement allowed) or
//!   refuses (closed for good). Each year the income is paid while the building stands and is
//!   powered. The drawbacks (`effects`) act while the building stands, powered or not.
//! * **Save**: chunk 12 ([`RewardState::encode`]): 2 bytes of unlock bits (bit = genre - 50),
//!   2 bytes of answers (2 bits per offer, offer = genre - 60). Written only when not zero.
//!
//! No random number is drawn anywhere. Every loop is bounded by the two tables, the structure
//! list ([`MAX_STRUCTURES`](crate::structures::MAX_STRUCTURES)) or a footprint.

mod effects;
mod month;
mod rules;
mod state;

pub(crate) use effects::{crime, land_value, pollution};
pub(crate) use month::monthly_balance;
pub use rules::{AnswerResult, OfferView, RewardView, STATS_SIZE};
pub use state::RewardState;

/// What the last year paid: runtime state, never saved, ignored when comparing.
#[derive(Debug, Clone, Copy, Default)]
pub struct RewardReport {
    /// Dollars the accepted deals paid.
    pub income: i64,
}

impl PartialEq for RewardReport {
    fn eq(&self, _: &RewardReport) -> bool {
        true
    }
}
impl Eq for RewardReport {}

/// Genre of the mayor's house (2 x 2).
pub const GENRE_MAYOR_HOUSE: u8 = 50;
/// Genre of the city hall (3 x 3).
pub const GENRE_CITY_HALL: u8 = 51;
/// Genre of the mayor's statue (1 x 1).
pub const GENRE_STATUE: u8 = 52;
/// Genre of the courthouse (3 x 3).
pub const GENRE_COURTHOUSE: u8 = 53;
/// Genre of the triumphal arch (2 x 2).
pub const GENRE_ARCH: u8 = 54;
/// Genre of the casino (3 x 3).
pub const GENRE_CASINO: u8 = 60;
/// Genre of the state prison (4 x 4).
pub const GENRE_STATE_PRISON: u8 = 61;
/// Genre of the toxic dump (4 x 4).
pub const GENRE_TOXIC_DUMP: u8 = 62;
/// Genre of the missile base (4 x 4).
pub const GENRE_MISSILE_BASE: u8 = 63;
/// First reward genre (a bit of the unlock mask is `genre - REWARD_BASE`).
pub const REWARD_BASE: u8 = 50;
/// First special deal genre (the offer index is `genre - DEAL_BASE`).
pub const DEAL_BASE: u8 = 60;
/// No answer yet: the petitioner has not come.
pub const ANSWER_NONE: u8 = 0;
/// The petitioner proposes the deal.
pub const ANSWER_PROPOSED: u8 = 1;
/// The deal is accepted.
pub const ANSWER_ACCEPTED: u8 = 2;
/// The deal is refused for good.
pub const ANSWER_REFUSED: u8 = 3;
/// Bytes of chunk 12: unlock bits (2), answers (2).
pub const CHUNK_SIZE: usize = 4;

/// What a reward asks (size, radius and land value bonus are the catalog's).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RewardSpec {
    pub genre: u8,
    /// Inhabitants needed.
    pub population: i64,
    /// Satisfaction (`city_yes`, percent) needed.
    pub satisfaction: i32,
}

/// A drawback: `amount` at the footprint, falling off linearly to 0 past `radius`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Drawback {
    pub amount: i32,
    pub radius: i32,
}

const NONE: Drawback = Drawback::new(0, 0);

impl Drawback {
    pub const fn new(amount: i32, radius: i32) -> Drawback {
        Drawback { amount, radius }
    }

    /// The effect at distance `d` of the footprint (0 past the radius).
    pub fn at(&self, d: i32) -> i32 {
        if d > self.radius {
            0
        } else {
            self.amount * (self.radius + 1 - d) / (self.radius + 1)
        }
    }
}

/// What a special deal brings and costs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DealSpec {
    pub genre: u8,
    /// Inhabitants at which the offer is proposed.
    pub population: i64,
    /// Dollars per year while the building stands and is powered.
    pub income: i32,
    /// Added to the crime.
    pub crime: Drawback,
    /// Added to the air pollution.
    pub pollution: Drawback,
    /// Taken off the land value (the amount is positive).
    pub land_malus: Drawback,
}

/// The rewards, by genre.
pub const REWARDS: [RewardSpec; 5] = [
    RewardSpec {
        genre: GENRE_MAYOR_HOUSE,
        population: 2_000,
        satisfaction: 0,
    },
    RewardSpec {
        genre: GENRE_CITY_HALL,
        population: 10_000,
        satisfaction: 0,
    },
    RewardSpec {
        genre: GENRE_STATUE,
        population: 5_000,
        satisfaction: 70,
    },
    RewardSpec {
        genre: GENRE_COURTHOUSE,
        population: 20_000,
        satisfaction: 0,
    },
    RewardSpec {
        genre: GENRE_ARCH,
        population: 50_000,
        satisfaction: 80,
    },
];

/// The special deals, by genre.
pub const DEALS: [DealSpec; 4] = [
    DealSpec {
        genre: GENRE_CASINO,
        population: 8_000,
        income: 3_000,
        crime: Drawback::new(30, 12),
        pollution: NONE,
        land_malus: NONE,
    },
    DealSpec {
        genre: GENRE_STATE_PRISON,
        population: 15_000,
        income: 5_000,
        crime: Drawback::new(20, 10),
        pollution: NONE,
        land_malus: Drawback::new(30, 10),
    },
    DealSpec {
        genre: GENRE_TOXIC_DUMP,
        population: 25_000,
        income: 8_000,
        crime: NONE,
        pollution: Drawback::new(80, 12),
        land_malus: NONE,
    },
    DealSpec {
        genre: GENRE_MISSILE_BASE,
        population: 40_000,
        income: 10_000,
        crime: NONE,
        pollution: NONE,
        land_malus: Drawback::new(40, 14),
    },
];

/// The reward spec of `genre`.
pub fn reward_of(genre: u8) -> Option<&'static RewardSpec> {
    REWARDS.iter().find(|r| r.genre == genre)
}

/// The deal spec of `genre`.
pub fn deal_of(genre: u8) -> Option<&'static DealSpec> {
    DEALS.iter().find(|d| d.genre == genre)
}

/// Whether `genre` is a reward (50-54).
pub fn is_reward_genre(genre: u8) -> bool {
    reward_of(genre).is_some()
}

/// Whether `genre` is a special deal (60-63).
pub fn is_deal_genre(genre: u8) -> bool {
    deal_of(genre).is_some()
}

const _: () = {
    assert!(REWARDS.len() <= 16 && DEALS.len() * 2 <= 16);
    assert!(DEAL_BASE > REWARD_BASE + REWARDS.len() as u8);
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::structures::kind_of;

    #[test]
    fn the_tables_follow_the_contract() {
        let r: Vec<(u8, i64, i32)> = REWARDS
            .iter()
            .map(|r| (r.genre, r.population, r.satisfaction))
            .collect();
        assert_eq!(
            r,
            [
                (50, 2_000, 0),
                (51, 10_000, 0),
                (52, 5_000, 70),
                (53, 20_000, 0),
                (54, 50_000, 80)
            ]
        );
        let d: Vec<(u8, i64, i32)> = DEALS
            .iter()
            .map(|d| (d.genre, d.population, d.income))
            .collect();
        assert_eq!(
            d,
            [
                (60, 8_000, 3_000),
                (61, 15_000, 5_000),
                (62, 25_000, 8_000),
                (63, 40_000, 10_000)
            ]
        );
        assert!(is_reward_genre(54));
        assert!(!is_reward_genre(55) && !is_deal_genre(59) && is_deal_genre(63));
        assert!(!is_deal_genre(64) && !is_reward_genre(63));
    }

    #[test]
    fn the_catalog_holds_every_genre_free_with_the_contract_sizes_and_effects() {
        let sizes = [(50, 2), (51, 3), (52, 1), (53, 3), (54, 2)];
        let amenity = [
            (50, 6, 20),
            (51, 8, 25),
            (52, 5, 15),
            (53, 8, 20),
            (54, 10, 30),
        ];
        for ((g, side), (_, radius, bonus)) in sizes.iter().zip(amenity) {
            let k = kind_of(*g).expect("catalog");
            assert_eq!((k.width, k.height, k.cost, k.upkeep), (*side, *side, 0, 0));
            assert_eq!((k.radius, k.bonus, k.flags), (radius, bonus, 0));
            assert_eq!(k.effect, crate::structures::EFFECT_LAND_VALUE);
        }
        for (g, side) in [(60, 3), (61, 4), (62, 4), (63, 4)] {
            let k = kind_of(g).expect("catalog");
            assert_eq!((k.width, k.height, k.cost, k.upkeep), (side, side, 0, 0));
            assert_eq!(k.flags, crate::structures::FLAG_POWER);
        }
    }

    #[test]
    fn a_drawback_falls_off_linearly_to_its_radius() {
        let d = Drawback::new(30, 12);
        assert_eq!((d.at(0), d.at(6), d.at(12), d.at(13)), (30, 16, 2, 0));
        assert_eq!(NONE.at(0), 0);
        for s in DEALS {
            for w in [s.crime, s.pollution, s.land_malus] {
                assert!(w.amount >= 0 && (w.amount == 0) == (w.radius == 0));
            }
        }
    }
}
