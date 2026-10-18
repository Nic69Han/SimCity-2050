//! The agents' own random generator (SplitMix64). It is seeded from the city state and never
//! touches the simulation's generator, so switching the agents on or off cannot change the
//! classic random sequence.

/// A deterministic 64-bit generator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentRng(u64);

impl AgentRng {
    /// A generator seeded from three city values (size and time are enough to be reproducible).
    pub fn seeded(a: u64, b: u64, c: u64) -> Self {
        let mut r = AgentRng(0x9E37_79B9_7F4A_7C15);
        for v in [a, b, c] {
            r.0 ^= v;
            r.next_u64();
        }
        r
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A value in `0..n` (0 when `n` is 0).
    pub fn below(&mut self, n: u32) -> u32 {
        if n == 0 {
            return 0;
        }
        ((self.next_u64() >> 32) % u64::from(n)) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence_other_seed_other_sequence() {
        let mut a = AgentRng::seeded(1, 2, 3);
        let mut b = AgentRng::seeded(1, 2, 3);
        let mut c = AgentRng::seeded(1, 2, 4);
        let xs: Vec<u64> = (0..8).map(|_| a.next_u64()).collect();
        assert!(xs.iter().all(|&x| x == b.next_u64()));
        assert_ne!(xs[0], c.next_u64());
    }

    #[test]
    fn below_stays_in_range() {
        let mut r = AgentRng::seeded(9, 9, 9);
        assert!((0..1000).all(|_| r.below(7) < 7));
        assert_eq!(r.below(0), 0);
    }
}
