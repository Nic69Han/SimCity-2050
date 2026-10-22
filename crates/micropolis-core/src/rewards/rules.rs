//! The rewards and deals on a [`Simulation`]: the switch, the lists the adapter shows, the
//! answers to the offers and the placement gate. See the module documentation of
//! [`crate::rewards`].

use super::month::refresh;
use super::{
    deal_of, is_deal_genre, is_reward_genre, RewardState, ANSWER_ACCEPTED, ANSWER_PROPOSED,
    ANSWER_REFUSED, DEALS, REWARDS,
};
use crate::simulation::Simulation;
use crate::structures::Structure;

/// Numbers of [`Simulation::reward_stats`].
pub const STATS_SIZE: usize = 4;

/// A reward as the adapter shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RewardView {
    pub genre: u8,
    pub unlocked: bool,
    pub placed: bool,
    pub population: i64,
    pub satisfaction: i32,
}

/// A special deal as the adapter shows it; `state` is the answer (0 none, 1 proposed, 2 accepted,
/// 3 refused).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OfferView {
    pub genre: u8,
    pub income: i32,
    pub state: u8,
    pub population: i64,
}

/// What [`Simulation::answer_offer`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnswerResult {
    /// The answer is recorded.
    Done = 1,
    /// The rewards rule is off.
    RulesOff = 0,
    /// Not an offer, or one that is not proposed.
    Unknown = -1,
}

fn clamp32(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

impl Simulation {
    /// Whether the rewards rules are on (off by default: the engine is the original). They act
    /// only while the extended buildings are on too ([`reward_active`](Self::reward_active)).
    pub fn reward_rules(&self) -> bool {
        self.extensions().rewards
    }

    /// Whether the rewards rules act: on, and the extended buildings on.
    pub fn reward_active(&self) -> bool {
        self.extensions().rewards && self.structure_rules()
    }

    /// Turns the rewards rules on or off. Off pulls down the buildings of genres 50-63 (no
    /// refund) and forgets the unlocks and the answers. On checks the thresholds at once.
    pub fn set_reward_rules(&mut self, on: bool) {
        if on == self.reward_rules() {
            return;
        }
        let ext = self.extensions_mut();
        ext.rewards = on;
        ext.reward_state = RewardState::default();
        if on {
            refresh(self);
        } else {
            self.repair_structures();
        }
    }

    /// Forgets the state of a rule that is off (a loaded file).
    pub(crate) fn repair_rewards(&mut self) {
        if !self.reward_rules() {
            self.extensions_mut().reward_state = RewardState::default();
        }
    }

    /// The five rewards. Empty while the rule is off.
    pub fn reward_list(&self) -> Vec<RewardView> {
        if !self.reward_rules() {
            return Vec::new();
        }
        let ext = self.extensions();
        REWARDS
            .iter()
            .map(|r| RewardView {
                genre: r.genre,
                unlocked: ext.reward_state.is_unlocked(r.genre),
                placed: self.is_placed(r.genre),
                population: r.population,
                satisfaction: r.satisfaction,
            })
            .collect()
    }

    /// The four special deals. Empty while the rule is off.
    pub fn offer_list(&self) -> Vec<OfferView> {
        if !self.reward_rules() {
            return Vec::new();
        }
        DEALS
            .iter()
            .map(|d| OfferView {
                genre: d.genre,
                income: d.income,
                state: self.extensions().reward_state.answer_of(d.genre),
                population: d.population,
            })
            .collect()
    }

    /// Accepts or refuses the offer `genre`, which must be proposed. Accepting allows one
    /// placement; refusing closes the offer for good.
    pub fn answer_offer(&mut self, genre: u8, accept: bool) -> AnswerResult {
        if !self.reward_rules() {
            return AnswerResult::RulesOff;
        }
        let state = &mut self.extensions_mut().reward_state;
        if !is_deal_genre(genre) || state.answer_of(genre) != ANSWER_PROPOSED {
            return AnswerResult::Unknown;
        }
        state.set_answer(
            genre,
            if accept {
                ANSWER_ACCEPTED
            } else {
                ANSWER_REFUSED
            },
        );
        AnswerResult::Done
    }

    /// `[satisfaction_pct, income_of_the_last_year, rewards_unlocked, deals_accepted]`. All 0
    /// while the rule is off.
    pub fn reward_stats(&self) -> [i32; STATS_SIZE] {
        if !self.reward_rules() {
            return [0; STATS_SIZE];
        }
        let ext = self.extensions();
        [
            i32::from(self.city_yes),
            clamp32(ext.reward_report.income),
            ext.reward_state.unlocked_count(),
            ext.reward_state.accepted_count(),
        ]
    }

    /// Placement gate of `place_structure`: a genre that is not a reward or a deal is always
    /// allowed; a reward needs the rule, its unlock and none standing; a deal needs the rule,
    /// its acceptance and none standing.
    pub(crate) fn reward_allows(&self, genre: u8) -> bool {
        if !is_reward_genre(genre) && !is_deal_genre(genre) {
            return true;
        }
        self.reward_rules() && self.is_earned(genre) && !self.is_placed(genre)
    }

    /// A reward or deal building that may not stand (rule off, not unlocked, not accepted).
    pub(crate) fn is_orphan_reward(&self, s: &Structure) -> bool {
        (is_reward_genre(s.genre) || is_deal_genre(s.genre))
            && !(self.reward_rules() && self.is_earned(s.genre))
    }

    fn is_earned(&self, genre: u8) -> bool {
        let state = &self.extensions().reward_state;
        if is_reward_genre(genre) {
            state.is_unlocked(genre)
        } else {
            deal_of(genre).is_some() && state.answer_of(genre) == ANSWER_ACCEPTED
        }
    }

    fn is_placed(&self, genre: u8) -> bool {
        let list = self.extensions().structure_list.as_slice();
        list.iter().any(|s| s.genre == genre)
    }
}
