//! The bonds: issue, yearly interest, repayment. Pure functions on the list plus the calls of
//! the engine; see the module documentation of [`crate::economy`].

use super::{
    be_i32, BOND_AMOUNT, BOND_BASE_PERMILLE, BOND_RECORD_SIZE, BOND_STEP_PERMILLE, MAX_BONDS,
    MAX_BOND_YEARS,
};

/// A bond: what it brought, its yearly rate (fixed at issue) and the years it has run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bond {
    pub amount: i32,
    /// Yearly rate in thousandths.
    pub permille: u16,
    pub years: u16,
}

impl Bond {
    pub(super) fn encode_into(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.amount.to_be_bytes());
        out.extend_from_slice(&self.permille.to_be_bytes());
        out.extend_from_slice(&self.years.to_be_bytes());
    }

    /// A bond from [`BOND_RECORD_SIZE`] bytes; refused with an amount of 0 or less, or a rate
    /// over 1000 per thousand.
    pub(super) fn decode(bytes: &[u8]) -> Result<Bond, &'static str> {
        debug_assert_eq!(bytes.len(), BOND_RECORD_SIZE);
        let bond = Bond {
            amount: be_i32(bytes),
            permille: u16::from_be_bytes([bytes[4], bytes[5]]),
            years: u16::from_be_bytes([bytes[6], bytes[7]]),
        };
        if bond.amount <= 0 || bond.permille > 1000 {
            return Err("economy chunk has a bond out of range");
        }
        Ok(bond)
    }

    /// Dollars of one year of interest: at least 1.
    pub fn interest(&self) -> i32 {
        let due = i64::from(self.amount) * i64::from(self.permille) / 1000;
        due.clamp(1, i64::from(i32::MAX)) as i32
    }
}

/// The next bond when `running` are already there; `None` at the cap.
pub fn next_bond(running: usize) -> Option<Bond> {
    if running >= MAX_BONDS {
        return None;
    }
    Some(Bond {
        amount: BOND_AMOUNT,
        permille: (BOND_BASE_PERMILLE + BOND_STEP_PERMILLE * running as i32) as u16,
        years: 0,
    })
}

/// Interest of every bond for one year, in dollars; each bond gets a year older.
pub fn pay_year(bonds: &mut [Bond]) -> i64 {
    let mut total = 0;
    for b in bonds.iter_mut() {
        total += i64::from(b.interest());
        b.years = b.years.saturating_add(1).min(MAX_BOND_YEARS);
    }
    total
}

/// Repays, oldest first, every bond `funds` can pay in turn; returns the dollars spent and keeps
/// the others in `bonds`. Bounded by [`MAX_BONDS`].
pub fn repay_what_can_be(bonds: &mut Vec<Bond>, funds: i64) -> i64 {
    let mut left = funds;
    let mut spent = 0;
    bonds.retain(|b| {
        let amount = i64::from(b.amount);
        if left >= amount {
            left -= amount;
            spent += amount;
            false
        } else {
            true
        }
    });
    spent
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rate_rises_with_the_bonds_running_and_stops_at_the_cap() {
        for running in 0..MAX_BONDS {
            let b = next_bond(running).expect("below the cap");
            assert_eq!(i32::from(b.permille), 30 + 10 * running as i32);
            assert_eq!((b.amount, b.years), (BOND_AMOUNT, 0));
        }
        assert_eq!(next_bond(MAX_BONDS), None);
        assert_eq!(next_bond(MAX_BONDS + 5), None);
    }

    #[test]
    fn interest_is_rounded_down_and_never_under_one_dollar() {
        let b = |amount, permille| Bond {
            amount,
            permille,
            years: 0,
        };
        assert_eq!(b(10_000, 30).interest(), 300);
        assert_eq!(b(10_000, 130).interest(), 1_300);
        assert_eq!(b(999, 1).interest(), 1);
        assert_eq!(b(1, 0).interest(), 1);
    }

    #[test]
    fn a_year_costs_the_interest_and_ages_every_bond() {
        let mut bonds = vec![next_bond(0).unwrap(), next_bond(1).unwrap()];
        assert_eq!(pay_year(&mut bonds), 300 + 400);
        assert_eq!(bonds[0].years, 1);
        bonds[1].years = MAX_BOND_YEARS;
        pay_year(&mut bonds);
        assert_eq!((bonds[0].years, bonds[1].years), (2, MAX_BOND_YEARS));
    }

    #[test]
    fn repaying_takes_the_bonds_the_funds_allow_and_keeps_the_rest() {
        let mut bonds: Vec<Bond> = (0..4).map(|i| next_bond(i).unwrap()).collect();
        assert_eq!(repay_what_can_be(&mut bonds, 25_000), 20_000);
        assert_eq!(bonds.len(), 2);
        assert_eq!(bonds[0].permille, 50, "the oldest were repaid");
        assert_eq!(repay_what_can_be(&mut bonds, 9_999), 0);
        assert_eq!(repay_what_can_be(&mut bonds, i64::MAX), 20_000);
        assert!(bonds.is_empty());
        assert_eq!(repay_what_can_be(&mut bonds, 1_000_000), 0);
    }
}
