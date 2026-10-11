//! Port of `random.cpp`.
//!
//! The C++ state is an `unsigned long` (64 bits on Linux, 32 on Windows), but
//! only bits 8..24 of the state are ever observed. Those low bits of a linear
//! congruential generator evolve identically for any width, so a wrapping
//! `u32` reproduces the original sequence exactly on every platform.

#[derive(Debug, Clone)]
pub struct Rng {
    next: u32,
}

impl Rng {
    pub fn new(seed: i32) -> Self {
        Self { next: seed as u32 }
    }

    pub fn seed(&mut self, seed: i32) {
        self.next = seed as u32;
    }

    /// Raw generator step, 16 bits significant (`simRandom`).
    pub fn sim_random(&mut self) -> i32 {
        self.next = self.next.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        ((self.next & 0x00ff_ff00) >> 8) as i32
    }

    /// Uniform 16-bit value, 0..=0xffff (`getRandom16`).
    pub fn random16(&mut self) -> i32 {
        self.sim_random() & 0xffff
    }

    /// Signed 16-bit-ish value (`getRandom16Signed`).
    pub fn random16_signed(&mut self) -> i32 {
        let i = self.random16();
        if i > 0x7fff {
            0x7fff - i
        } else {
            i
        }
    }

    /// Uniform value in `0..=range` using rejection sampling (`getRandom`).
    ///
    /// The C++ original takes a `short`; `range` is therefore an `i16` here and
    /// `range + 1` is computed in `i32`, which fixes the documented overflow
    /// bug for `range == i16::MAX` without changing any other result.
    pub fn random(&mut self, range: i16) -> i16 {
        let range = i32::from(range) + 1;
        let max_multiple = (0xffff / range) * range;
        loop {
            let r = self.random16();
            if r < max_multiple {
                return (r % range) as i16;
            }
        }
    }

    /// Value in `0..=limit` biased towards small numbers (`getERandom`).
    pub fn erandom(&mut self, limit: i16) -> i16 {
        let z = self.random(limit);
        let x = self.random(limit);
        z.min(x)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn take<F: FnMut(&mut Rng) -> i64>(seed: i32, mut f: F) -> Vec<i64> {
        let mut r = Rng::new(seed);
        (0..6).map(|_| f(&mut r)).collect()
    }

    // Golden values produced by the original C++ code (see tests/gold.cpp).
    #[test]
    fn sim_random_matches_cpp() {
        let f = |r: &mut Rng| i64::from(r.sim_random());
        assert_eq!(take(0, f), [48, 56342, 1063, 25884, 43670, 7964]);
        assert_eq!(take(1, f), [50814, 32432, 33252, 27547, 19423, 64372]);
        assert_eq!(take(42, f), [35086, 35179, 42269, 30196, 8304, 17803]);
        assert_eq!(take(-1, f), [14817, 14716, 34411, 24221, 2382, 17092]);
        assert_eq!(take(123456789, f), [53480, 11222, 51347, 47397, 27996, 10168]);
    }

    #[test]
    fn random16_signed_matches_cpp() {
        let f = |r: &mut Rng| i64::from(r.random16_signed());
        assert_eq!(take(0, f), [48, -23575, 1063, 25884, -10903, 7964]);
        assert_eq!(take(1, f), [-18047, 32432, -485, 27547, 19423, -31605]);
        assert_eq!(take(123456789, f), [-20713, 11222, -18580, -14630, 27996, 10168]);
    }

    #[test]
    fn bounded_matches_cpp() {
        let f = |r: &mut Rng| i64::from(r.random(10));
        assert_eq!(take(0, f), [4, 0, 7, 1, 0, 0]);
        assert_eq!(take(1, f), [5, 4, 10, 3, 8, 0]);
        assert_eq!(take(42, f), [7, 1, 7, 1, 10, 5]);
        assert_eq!(take(-1, f), [0, 9, 3, 10, 6, 9]);
    }

    #[test]
    fn erandom_matches_cpp() {
        let f = |r: &mut Rng| i64::from(r.erandom(50));
        assert_eq!(take(0, f), [38, 27, 8, 16, 8, 11]);
        assert_eq!(take(42, f), [40, 4, 4, 8, 21, 15]);
        assert_eq!(take(123456789, f), [2, 18, 19, 16, 16, 6]);
    }

    #[test]
    fn extreme_range_does_not_overflow() {
        let mut r = Rng::new(7);
        for _ in 0..1000 {
            let v = r.random(i16::MAX);
            assert!(v >= 0);
        }
    }
}
