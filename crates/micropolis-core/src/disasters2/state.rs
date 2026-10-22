//! What a city remembers of its disasters (the drought) and what it reports (the last one).

use super::{CHUNK_SIZE, DROUGHT_MONTHS};

/// The saved state: the months of drought left. The start state (0) is not written to a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DisasterState {
    pub drought_months: u16,
}

impl DisasterState {
    pub fn is_empty(&self) -> bool {
        *self == DisasterState::default()
    }

    /// The bytes of chunk 14; nothing for the start state.
    pub fn encode(&self) -> Vec<u8> {
        if self.is_empty() {
            return Vec::new();
        }
        self.drought_months.to_be_bytes().to_vec()
    }

    /// The state stored in `bytes`. Refused: a length other than [`CHUNK_SIZE`], more than
    /// [`DROUGHT_MONTHS`] months, the start state (never written).
    pub fn decode(bytes: &[u8]) -> Result<DisasterState, &'static str> {
        let Ok(raw) = <[u8; CHUNK_SIZE]>::try_from(bytes) else {
            return Err("disasters chunk is not 2 bytes");
        };
        match u16::from_be_bytes(raw) {
            0 => Err("disasters chunk is empty"),
            m if m > DROUGHT_MONTHS => Err("disasters chunk has too many months of drought"),
            m => Ok(DisasterState { drought_months: m }),
        }
    }
}

/// The last disaster: runtime state, never saved, ignored when comparing.
#[derive(Debug, Clone, Copy)]
pub struct DisasterReport {
    /// 0 none, else the kind (1..=4).
    pub last: u8,
    /// Where it struck (-1 when none or without a place).
    pub x: i32,
    pub y: i32,
}

impl Default for DisasterReport {
    fn default() -> Self {
        DisasterReport {
            last: 0,
            x: -1,
            y: -1,
        }
    }
}

impl PartialEq for DisasterReport {
    fn eq(&self, _: &DisasterReport) -> bool {
        true
    }
}
impl Eq for DisasterReport {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_state_round_trips_and_a_bad_chunk_is_refused() {
        assert!(DisasterState::default().encode().is_empty());
        let s = DisasterState { drought_months: 7 };
        assert_eq!(s.encode(), vec![0, 7]);
        assert_eq!(DisasterState::decode(&s.encode()), Ok(s));
        let max = DisasterState {
            drought_months: DROUGHT_MONTHS,
        };
        assert_eq!(DisasterState::decode(&max.encode()), Ok(max));
        let bad: [&[u8]; 5] = [&[], &[1], &[0, 0], &[0, 13], &[0, 1, 0]];
        for (i, b) in bad.iter().enumerate() {
            assert!(DisasterState::decode(b).is_err(), "case {i}");
        }
    }

    #[test]
    fn the_report_starts_empty_and_never_differs() {
        let r = DisasterReport::default();
        assert_eq!((r.last, r.x, r.y), (0, -1, -1));
        assert_eq!(
            r,
            DisasterReport {
                last: 3,
                x: 4,
                y: 5
            }
        );
    }
}
