//! Economy (docs/game-design-v11.md): **taxes** by kind of zone and wealth, **bonds** to pay for
//! big works, and **goods** (industry makes them, commerce sells them, the surplus is exported and
//! the shortage imported). With the rule ([`Extensions::economy`](crate::extensions::Extensions::economy))
//! off nothing here acts: the hooks answer their input, the calls are refused or empty and the
//! engine is the original. The rule does not need the extended buildings.
//!
//! * **Year.** One pass of `ext_monthly_balance`, which the classic engine runs at each tax
//!   collection (once per game year, `TAX_FREQUENCY` city ticks).
//! * **Wealth** of a zone: the land value of the block of its centre tile, "modest" under
//!   [`WEALTH_MID`], "average" under [`WEALTH_HIGH`], "wealthy" above ([`wealth_of`]).
//! * **Taxes** ([`zones`]): nine rates (kind R, C, I x wealth), 0..=[`RATE_MAX`] %. Until the
//!   player sets one, all nine follow the single rate of the budget (`city_tax`). The income of
//!   a case is `sum(zone population x land value) x rate x difficulty / (8 x 120 x 100)`. The zone
//!   population is on the residential scale of the classic code (residents x 8: a commercial or
//!   industrial zone counts [`TIER_POPULATION`](crate::waste::TIER_POPULATION) per tier), so the
//!   `/ 8` brings it back to the `total_pop x land value / 120` of the classic formula. Hook
//!   `ext_tax_fund`; with the rule on the single rate of the budget no longer changes the income.
//! * **Demand** ([`month`]): per kind, the valve gets `TAX_TABLE[single rate] - TAX_TABLE[mean
//!   rate]` (the rates weighted by zone population, plus the game level like the classic code),
//!   within +-[`VALVE_TAX_LIMIT`] per call and never past the classic valve ranges.
//! * **Bonds** ([`bonds`]): at most [`MAX_BONDS`] of [`BOND_AMOUNT`] dollars; the rate (per
//!   thousand a year) is fixed at issue: [`BOND_BASE_PERMILLE`] + [`BOND_STEP_PERMILLE`] x bonds
//!   already running. Interest at each year (at least 1 dollar). Repaying needs the funds.
//! * **Goods** ([`goods`]): industry makes [`GOODS_PER_IND`] per resident unit, commerce uses
//!   [`GOODS_PER_COM`]. The surplus is sold at [`GOODS_EXPORT_PRICE`], the shortage bought at
//!   [`GOODS_IMPORT_PRICE`]; `produced + imported = consumed + exported`. A shortage over
//!   [`SHORTAGE_PCT`] % of the consumption lowers the commercial valve by [`SHORTAGE_VALVE`] at
//!   each call of the next year.
//! * **Rule off**: repays the bonds the funds allow, forgets the others, resets the rates.
//! * **Save**: chunk 11 ([`EconomyState::encode`]), written only when it differs from the start
//!   state.
//!
//! No random number is drawn anywhere. Every loop is bounded by the map size, by [`MAX_BONDS`] or
//! by the nine cases.

mod bonds;
mod goods;
mod layer;
mod month;
mod rules;
mod zones;

use crate::waste::TIER_POPULATION;

pub use bonds::Bond;
pub use goods::Goods;
pub(crate) use month::{monthly_balance, tax_fund, valves};
pub use zones::{wealth_of, EcoZone};

/// Kind of a residential zone (the genres of `densities`).
pub const KIND_RESIDENTIAL: i32 = 1;
/// Kind of a commercial zone.
pub const KIND_COMMERCIAL: i32 = 2;
/// Kind of an industrial zone.
pub const KIND_INDUSTRIAL: i32 = 3;
/// Kinds of zones taxed.
pub const KINDS: usize = 3;
/// Classes of wealth.
pub const WEALTHS: usize = 3;
/// Tax rates: one per kind and wealth.
pub const CASES: usize = KINDS * WEALTHS;
/// Largest tax rate, in percent.
pub const RATE_MAX: i32 = 20;
/// Land value under which a zone is modest.
pub const WEALTH_MID: i32 = 60;
/// Land value under which a zone is average (from there, wealthy).
pub const WEALTH_HIGH: i32 = 120;
/// Divisor of the classic tax formula (`total_pop x land value / 120`).
pub const LAND_DIV: i64 = 120;
/// Zone population units (residents x 8) in one unit of the classic `total_pop`.
pub const POP_UNITS: i64 = TIER_POPULATION;
/// Percent of the income by game level (the classic `F_LEVELS`, `[1.4, 1.2, 0.8]`).
pub const DIFFICULTY_PCT: [i64; 3] = [140, 120, 80];
/// Largest push of a valve by the taxes, in either direction, per call.
pub const VALVE_TAX_LIMIT: i32 = 300;
/// Most bonds running at once.
pub const MAX_BONDS: usize = 10;
/// Dollars one bond brings.
pub const BOND_AMOUNT: i32 = 10_000;
/// Yearly rate, per thousand, of a bond issued when none is running.
pub const BOND_BASE_PERMILLE: i32 = 30;
/// Added to the rate of a new bond for each bond already running.
pub const BOND_STEP_PERMILLE: i32 = 10;
/// Goods one unit of industrial population makes in a year.
pub const GOODS_PER_IND: i64 = 2;
/// Goods one unit of commercial population uses in a year.
pub const GOODS_PER_COM: i64 = 3;
/// Dollars earned per unit of goods exported.
pub const GOODS_EXPORT_PRICE: i64 = 1;
/// Dollars paid per unit of goods imported.
pub const GOODS_IMPORT_PRICE: i64 = 2;
/// Percent of the consumption the imports must pass to be a shortage.
pub const SHORTAGE_PCT: i64 = 50;
/// What a shortage takes off the commercial valve at each call of the next year.
pub const SHORTAGE_VALVE: i32 = 200;
/// Largest number of years a bond counts.
pub const MAX_BOND_YEARS: u16 = u16::MAX;
/// Numbers of [`Simulation::goods_stats`](crate::simulation::Simulation::goods_stats).
pub const GOODS_STATS_SIZE: usize = 6;

/// Bytes of a saved bond: amount (4, big-endian), per thousand (2), years (2).
pub const BOND_RECORD_SIZE: usize = 8;
/// Bytes of chunk 11 without its bonds: custom flag (1), rates (9), income (9 x 4), goods
/// (5 x 4), shortage (1), bond count (1).
pub const STATE_FIXED_SIZE: usize = 1 + CASES + 4 * CASES + 4 * 5 + 1 + 1;

const _: () = {
    assert!(WEALTH_MID < WEALTH_HIGH && RATE_MAX < 256);
    assert!(BOND_BASE_PERMILLE + BOND_STEP_PERMILLE * MAX_BONDS as i32 <= 1000);
    assert!(MAX_BONDS < 256 && BOND_AMOUNT > 0);
};

/// The saved numbers of the economy. The start state (what [`Default`] gives) is the state of a
/// city without the rule: it is not written to a file.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EconomyState {
    /// Whether the player set a rate; until then the nine rates are the budget's single rate.
    pub custom: bool,
    /// The nine rates, kind then wealth (read only when `custom`).
    pub rates: [u8; CASES],
    /// Income of the last year by case.
    pub income: [i32; CASES],
    /// The bonds running, oldest first.
    pub bonds: Vec<Bond>,
    /// Goods of the last year.
    pub goods: Goods,
}

impl EconomyState {
    /// The bytes of chunk 11; nothing while the state is the start state.
    pub fn encode(&self) -> Vec<u8> {
        if *self == EconomyState::default() {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(STATE_FIXED_SIZE + BOND_RECORD_SIZE * self.bonds.len());
        out.push(u8::from(self.custom));
        out.extend_from_slice(&self.rates);
        for v in self.income {
            out.extend_from_slice(&v.to_be_bytes());
        }
        self.goods.encode_into(&mut out);
        out.push(self.bonds.len() as u8);
        for b in &self.bonds {
            b.encode_into(&mut out);
        }
        out
    }

    /// The state stored in `bytes`. Refused: a length other than 0 or the fixed part plus whole
    /// bonds, a flag other than 0 or 1, a rate over [`RATE_MAX`], a count over [`MAX_BONDS`] or
    /// not matching the length, a bond out of range, a negative goods counter.
    pub fn decode(bytes: &[u8]) -> Result<EconomyState, &'static str> {
        if bytes.is_empty() {
            return Ok(EconomyState::default());
        }
        if bytes.len() < STATE_FIXED_SIZE {
            return Err("economy chunk is cut short");
        }
        let count = usize::from(bytes[STATE_FIXED_SIZE - 1]);
        if count > MAX_BONDS || bytes.len() != STATE_FIXED_SIZE + BOND_RECORD_SIZE * count {
            return Err("economy chunk has a wrong bond count");
        }
        if bytes[0] > 1 {
            return Err("economy chunk has an unknown flag");
        }
        let mut rates = [0u8; CASES];
        rates.copy_from_slice(&bytes[1..1 + CASES]);
        if rates.iter().any(|&r| i32::from(r) > RATE_MAX) {
            return Err("economy chunk has a rate out of range");
        }
        let mut income = [0i32; CASES];
        let income_at = 1 + CASES;
        for (i, v) in income.iter_mut().enumerate() {
            *v = be_i32(&bytes[income_at + 4 * i..]);
        }
        let goods = Goods::decode(&bytes[income_at + 4 * CASES..STATE_FIXED_SIZE - 1])?;
        let mut bonds = Vec::with_capacity(count);
        for i in 0..count {
            let at = STATE_FIXED_SIZE + BOND_RECORD_SIZE * i;
            bonds.push(Bond::decode(&bytes[at..at + BOND_RECORD_SIZE])?);
        }
        Ok(EconomyState {
            custom: bytes[0] == 1,
            rates,
            income,
            bonds,
            goods,
        })
    }
}

/// The big-endian `i32` that opens `bytes` (at least 4 bytes).
pub(crate) fn be_i32(bytes: &[u8]) -> i32 {
    i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn busy() -> EconomyState {
        let mut s = EconomyState {
            custom: true,
            rates: [1, 2, 3, 4, 5, 6, 7, 8, 20],
            income: [10, -20, 30, 0, 5, 6, 7, 8, i32::MAX],
            ..EconomyState::default()
        };
        s.goods = Goods {
            produced: 100,
            consumed: 60,
            exported: 40,
            imported: 0,
            net: 40,
            shortage: false,
        };
        s.bonds = vec![
            Bond {
                amount: BOND_AMOUNT,
                permille: 30,
                years: 2,
            },
            Bond {
                amount: BOND_AMOUNT,
                permille: 40,
                years: 0,
            },
        ];
        s
    }

    #[test]
    fn the_start_state_is_empty_bytes_and_a_state_round_trips() {
        assert!(EconomyState::default().encode().is_empty());
        assert_eq!(EconomyState::decode(&[]), Ok(EconomyState::default()));
        let s = busy();
        let bytes = s.encode();
        assert_eq!(bytes.len(), STATE_FIXED_SIZE + 2 * BOND_RECORD_SIZE);
        assert_eq!(EconomyState::decode(&bytes), Ok(s));
        // bonds alone (no custom rate) are not the start state
        let only_bonds = EconomyState {
            bonds: busy().bonds,
            ..EconomyState::default()
        };
        assert_eq!(
            EconomyState::decode(&only_bonds.encode()),
            Ok(only_bonds.clone())
        );
        assert!(!only_bonds.encode().is_empty());
    }

    #[test]
    fn a_bad_state_is_refused() {
        let good = busy().encode();
        let mut bad: Vec<Vec<u8>> = vec![vec![0], good[..STATE_FIXED_SIZE - 1].to_vec()];
        let mut flag = good.clone();
        flag[0] = 2;
        bad.push(flag);
        let mut rate = good.clone();
        rate[1] = 21;
        bad.push(rate);
        let mut long = good.clone();
        long.push(0);
        bad.push(long);
        bad.push(good[..good.len() - 1].to_vec());
        let mut count = good.clone();
        count[STATE_FIXED_SIZE - 1] = (MAX_BONDS + 1) as u8;
        bad.push(count);
        let mut amount = good.clone();
        amount[STATE_FIXED_SIZE..STATE_FIXED_SIZE + 4].fill(0);
        bad.push(amount);
        let mut permille = good.clone();
        permille[STATE_FIXED_SIZE + 4] = 0xff;
        bad.push(permille);
        let mut produced = good.clone();
        produced[1 + CASES + 4 * CASES] = 0x80;
        bad.push(produced);
        let mut shortage = good;
        shortage[STATE_FIXED_SIZE - 2] = 2;
        bad.push(shortage);
        for (i, b) in bad.iter().enumerate() {
            assert!(EconomyState::decode(b).is_err(), "case {i}");
        }
    }

    #[test]
    fn the_constants_are_consistent() {
        assert_eq!(CASES, 9);
        assert_eq!(STATE_FIXED_SIZE, 1 + 9 + 36 + 20 + 1 + 1);
        assert_eq!(POP_UNITS, 8);
    }
}
