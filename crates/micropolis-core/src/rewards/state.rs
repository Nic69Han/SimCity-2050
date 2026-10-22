//! What a city remembers of its rewards and deals: the unlocked rewards and the answers.

use super::{ANSWER_ACCEPTED, ANSWER_NONE, CHUNK_SIZE, DEALS, DEAL_BASE, REWARDS, REWARD_BASE};

/// Bits of the unlock mask a reward genre can use.
const UNLOCK_MASK: u16 = (1 << REWARDS.len()) - 1;
/// Bits of the answers an offer can use.
const ANSWER_MASK: u16 = (1 << (2 * DEALS.len())) - 1;

/// The saved state: bit `genre - 50` of `unlocked` is a reward unlocked for good; the answer of
/// offer `genre - 60` is 2 bits of `answers` (0 none, 1 proposed, 2 accepted, 3 refused). The
/// start state (what [`Default`] gives) is not written to a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RewardState {
    unlocked: u16,
    answers: u16,
}

impl RewardState {
    pub fn is_empty(&self) -> bool {
        *self == RewardState::default()
    }

    /// Whether the reward `genre` is unlocked (false for any other genre).
    pub fn is_unlocked(&self, genre: u8) -> bool {
        genre
            .checked_sub(REWARD_BASE)
            .filter(|b| usize::from(*b) < REWARDS.len())
            .is_some_and(|b| self.unlocked >> b & 1 == 1)
    }

    /// Unlocks the reward `genre` for good (nothing for another genre).
    pub fn unlock(&mut self, genre: u8) {
        if let Some(b) = genre
            .checked_sub(REWARD_BASE)
            .filter(|b| usize::from(*b) < REWARDS.len())
        {
            self.unlocked |= 1 << b;
        }
    }

    /// The answer of the offer `genre` ([`ANSWER_NONE`] for a genre that is not an offer).
    pub fn answer_of(&self, genre: u8) -> u8 {
        match offer_index(genre) {
            Some(i) => (self.answers >> (2 * i) & 0b11) as u8,
            None => ANSWER_NONE,
        }
    }

    /// Sets the answer of the offer `genre` (`answer` in 0..=3; nothing for another genre).
    pub fn set_answer(&mut self, genre: u8, answer: u8) {
        if let Some(i) = offer_index(genre) {
            self.answers =
                self.answers & !(0b11 << (2 * i)) | (u16::from(answer & 0b11) << (2 * i));
        }
    }

    /// Rewards unlocked.
    pub fn unlocked_count(&self) -> i32 {
        self.unlocked.count_ones() as i32
    }

    /// Offers accepted.
    pub fn accepted_count(&self) -> i32 {
        DEALS
            .iter()
            .filter(|d| self.answer_of(d.genre) == ANSWER_ACCEPTED)
            .count() as i32
    }

    /// The bytes of chunk 12; nothing for the start state.
    pub fn encode(&self) -> Vec<u8> {
        if self.is_empty() {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(CHUNK_SIZE);
        out.extend_from_slice(&self.unlocked.to_be_bytes());
        out.extend_from_slice(&self.answers.to_be_bytes());
        out
    }

    /// The state stored in `bytes`. Refused: a length other than [`CHUNK_SIZE`], an unlock bit
    /// or an answer bit of a genre that does not exist, the start state (never written).
    pub fn decode(bytes: &[u8]) -> Result<RewardState, &'static str> {
        let [u1, u2, a1, a2] = *bytes else {
            return Err("rewards chunk is not 4 bytes");
        };
        let state = RewardState {
            unlocked: u16::from_be_bytes([u1, u2]),
            answers: u16::from_be_bytes([a1, a2]),
        };
        if state.unlocked & !UNLOCK_MASK != 0 || state.answers & !ANSWER_MASK != 0 {
            return Err("rewards chunk has a bit of an unknown genre");
        }
        if state.is_empty() {
            return Err("rewards chunk is empty");
        }
        Ok(state)
    }
}

fn offer_index(genre: u8) -> Option<u8> {
    genre
        .checked_sub(DEAL_BASE)
        .filter(|i| usize::from(*i) < DEALS.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rewards::{ANSWER_PROPOSED, ANSWER_REFUSED};

    #[test]
    fn unlocks_are_bits_by_genre_and_only_for_rewards() {
        let mut s = RewardState::default();
        assert!(s.is_empty() && s.encode().is_empty());
        s.unlock(52);
        s.unlock(60); // an offer, not a reward
        s.unlock(55);
        s.unlock(49);
        assert!(s.is_unlocked(52) && !s.is_unlocked(51) && !s.is_unlocked(60));
        assert_eq!(s.unlocked_count(), 1);
        assert_eq!(s.encode(), vec![0, 0b100, 0, 0]);
    }

    #[test]
    fn answers_are_two_bits_by_offer() {
        let mut s = RewardState::default();
        s.set_answer(61, ANSWER_PROPOSED);
        s.set_answer(63, ANSWER_REFUSED);
        s.set_answer(60, ANSWER_ACCEPTED);
        s.set_answer(64, ANSWER_ACCEPTED);
        s.set_answer(50, ANSWER_ACCEPTED);
        let a: Vec<u8> = (60..=64).map(|g| s.answer_of(g)).collect();
        assert_eq!(a, [2, 1, 0, 3, 0]);
        assert_eq!(s.accepted_count(), 1);
        assert_eq!(s.encode(), vec![0, 0, 0, 0b1100_0110]);
        s.set_answer(60, ANSWER_NONE);
        assert_eq!(s.answer_of(60), ANSWER_NONE);
    }

    #[test]
    fn the_state_round_trips_and_a_bad_chunk_is_refused() {
        let mut s = RewardState::default();
        s.unlock(50);
        s.unlock(54);
        s.set_answer(62, ANSWER_ACCEPTED);
        assert_eq!(RewardState::decode(&s.encode()), Ok(s));
        let bad: [&[u8]; 7] = [
            &[],
            &[0, 1, 0],
            &[0, 1, 0, 0, 0],
            &[0, 0, 0, 0],
            &[0, 0b10_0000, 0, 0],
            &[1, 0, 0, 0],
            &[0, 0, 1, 0],
        ];
        for (i, b) in bad.iter().enumerate() {
            assert!(RewardState::decode(b).is_err(), "case {i}");
        }
    }
}
