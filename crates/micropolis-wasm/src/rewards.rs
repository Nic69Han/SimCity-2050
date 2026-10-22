//! wasm adapter: the rewards and special deals (docs/game-design-v12.md); the rules live in
//! `micropolis_core::rewards` (translation only, ARCHITECTURE.md rule 4).
//!
//! * `reward_rules() -> bool`, `set_reward_rules(on)`: the switch (off by default: the engine is
//!   the original). The rules act only while the extended buildings (`structure_rules`) are on
//!   too. Turning it off pulls down the buildings of genres 50..=63 (no refund) and forgets the
//!   unlocks and the answers; turning it on checks the thresholds at once.
//! * `rewards() -> Int32Array`: records of [`REWARD_LEN`] (5) values `[genre, unlocked 0/1, placed
//!   0/1, population_needed, satisfaction_needed]`, genres 50..=54. Empty while the rule is off.
//! * `special_offers() -> Int32Array`: records of [`OFFER_LEN`] (4) values `[genre, yearly_income,
//!   state, population_needed]`, genres 60..=63; state 0 none, 1 proposed, 2 accepted, 3 refused.
//!   Empty while the rule is off.
//! * `answer_offer(genre, accept) -> i32`: 1 done, 0 rule off, -1 unknown offer or one that is not
//!   proposed.
//! * `reward_stats() -> Int32Array`: `STATS_SIZE` (4) values `[satisfaction_pct,
//!   special_income_last_year, rewards_unlocked, deals_accepted]`; all 0 while the rule is off.
//!
//! The buildings are catalog genres 50..=54 and 60..=63 placed with `place_structure`, which
//! refuses (0) a reward not unlocked or already standing and a deal not accepted or already
//! standing.

use crate::City;
use wasm_bindgen::prelude::*;

/// Values per record of `rewards`.
pub const REWARD_LEN: usize = 5;
/// Values per record of `special_offers`.
pub const OFFER_LEN: usize = 4;

fn clamp(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

/// A genre sent by the page: anything that is not a `u8` is unknown (genre 0).
fn genre_of(genre: i32) -> u8 {
    u8::try_from(genre).unwrap_or(0)
}

#[wasm_bindgen]
impl City {
    /// Whether the rewards rules are on (off by default).
    pub fn reward_rules(&self) -> bool {
        self.sim.reward_rules()
    }

    /// Turns the rewards rules on or off.
    pub fn set_reward_rules(&mut self, on: bool) {
        self.sim.set_reward_rules(on);
    }

    /// The rewards, records `[genre, unlocked, placed, population_needed, satisfaction_needed]`.
    pub fn rewards(&self) -> Vec<i32> {
        let list = self.sim.reward_list();
        let mut out = Vec::with_capacity(list.len() * REWARD_LEN);
        for r in &list {
            out.extend_from_slice(&[
                i32::from(r.genre),
                i32::from(r.unlocked),
                i32::from(r.placed),
                clamp(r.population),
                r.satisfaction,
            ]);
        }
        out
    }

    /// The special deals, records `[genre, yearly_income, state, population_needed]`.
    pub fn special_offers(&self) -> Vec<i32> {
        let list = self.sim.offer_list();
        let mut out = Vec::with_capacity(list.len() * OFFER_LEN);
        for o in &list {
            out.extend_from_slice(&[
                i32::from(o.genre),
                o.income,
                i32::from(o.state),
                clamp(o.population),
            ]);
        }
        out
    }

    /// Accepts or refuses a proposed offer: 1 done, 0 rule off, -1 unknown or not proposed.
    pub fn answer_offer(&mut self, genre: i32, accept: bool) -> i32 {
        self.sim.answer_offer(genre_of(genre), accept) as i32
    }

    /// `[satisfaction_pct, special_income_last_year, rewards_unlocked, deals_accepted]`.
    pub fn reward_stats(&self) -> Vec<i32> {
        self.sim.reward_stats().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use crate::City;
    use micropolis_core::rewards::STATS_SIZE;

    #[test]
    fn the_adapter_translates_the_switch_the_lists_and_the_answers() {
        let mut city = City::new(1);
        assert!(!city.reward_rules());
        assert!(city.rewards().is_empty() && city.special_offers().is_empty());
        assert_eq!(city.reward_stats(), vec![0; STATS_SIZE]);
        assert_eq!(city.answer_offer(60, true), 0);
        city.set_reward_rules(true);
        assert!(city.reward_rules());
        assert_eq!(city.rewards().len(), 5 * super::REWARD_LEN);
        assert_eq!(city.special_offers().len(), 4 * super::OFFER_LEN);
        assert_eq!(&city.rewards()[..5], &[50, 0, 0, 2000, 0]);
        assert_eq!(&city.special_offers()[..4], &[60, 3000, 0, 8000]);
        assert_eq!(city.answer_offer(60, true), -1, "not proposed");
        assert_eq!(city.answer_offer(-5, true), -1);
        assert_eq!(city.answer_offer(1000, true), -1);
        city.set_reward_rules(false);
        assert!(city.rewards().is_empty());
    }
}
