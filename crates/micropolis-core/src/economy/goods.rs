//! The goods of a year: what industry makes, what commerce uses, what is sold or bought.

use super::{
    be_i32, EcoZone, GOODS_EXPORT_PRICE, GOODS_IMPORT_PRICE, GOODS_PER_COM, GOODS_PER_IND,
    KIND_COMMERCIAL, KIND_INDUSTRIAL, SHORTAGE_PCT,
};

/// Goods of the last year. `produced + imported = consumed + exported`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Goods {
    pub produced: i32,
    pub consumed: i32,
    pub exported: i32,
    pub imported: i32,
    /// Dollars earned by the exports less the dollars paid for the imports.
    pub net: i32,
    /// Whether the imports passed [`SHORTAGE_PCT`] % of the consumption.
    pub shortage: bool,
}

fn clamp32(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

impl Goods {
    /// The goods of a year for these zones (population on the residential scale).
    pub fn of_zones(zones: &[EcoZone]) -> Goods {
        let sum = |kind: i32, per: i64| -> i64 {
            zones
                .iter()
                .filter(|z| z.kind == kind)
                .map(|z| z.pop * per)
                .sum()
        };
        Goods::from_totals(
            sum(KIND_INDUSTRIAL, GOODS_PER_IND),
            sum(KIND_COMMERCIAL, GOODS_PER_COM),
        )
    }

    /// The year of a city that makes `produced` and uses `consumed`.
    pub fn from_totals(produced: i64, consumed: i64) -> Goods {
        let exported = (produced - consumed).max(0);
        let imported = (consumed - produced).max(0);
        Goods {
            produced: clamp32(produced),
            consumed: clamp32(consumed),
            exported: clamp32(exported),
            imported: clamp32(imported),
            net: clamp32(exported * GOODS_EXPORT_PRICE - imported * GOODS_IMPORT_PRICE),
            shortage: consumed > 0 && imported * 100 > SHORTAGE_PCT * consumed,
        }
    }

    pub(super) fn encode_into(&self, out: &mut Vec<u8>) {
        for v in [
            self.produced,
            self.consumed,
            self.exported,
            self.imported,
            self.net,
        ] {
            out.extend_from_slice(&v.to_be_bytes());
        }
        out.push(u8::from(self.shortage));
    }

    /// Goods from 21 bytes: five numbers and the shortage flag. Refused with a negative counter
    /// or a flag over 1.
    pub(super) fn decode(bytes: &[u8]) -> Result<Goods, &'static str> {
        let at = |i: usize| be_i32(&bytes[4 * i..]);
        let goods = Goods {
            produced: at(0),
            consumed: at(1),
            exported: at(2),
            imported: at(3),
            net: at(4),
            shortage: bytes[20] == 1,
        };
        let counters = [
            goods.produced,
            goods.consumed,
            goods.exported,
            goods.imported,
        ];
        if counters.iter().any(|&v| v < 0) || bytes[20] > 1 {
            return Err("economy chunk has goods out of range");
        }
        Ok(goods)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zone(kind: i32, pop: i64) -> EcoZone {
        EcoZone {
            kind,
            x: 0,
            y: 0,
            pop,
            land: 50,
        }
    }

    #[test]
    fn a_surplus_is_sold_and_a_shortage_bought() {
        let g = Goods::from_totals(100, 60);
        assert_eq!((g.exported, g.imported, g.net), (40, 0, 40));
        let g = Goods::from_totals(60, 100);
        assert_eq!((g.exported, g.imported, g.net), (0, 40, -80));
        let g = Goods::from_totals(70, 70);
        assert_eq!(
            (g.exported, g.imported, g.net, g.shortage),
            (0, 0, 0, false)
        );
    }

    #[test]
    fn goods_are_conserved() {
        for (p, c) in [(0, 0), (5, 9), (9, 5), (1000, 1000), (0, 77), (77, 0)] {
            let g = Goods::from_totals(p, c);
            assert_eq!(g.produced + g.imported, g.consumed + g.exported, "{p} {c}");
        }
    }

    #[test]
    fn a_shortage_needs_more_than_half_of_the_consumption_imported() {
        // consumption 100: 50 imported is not over 50 %, 51 is
        assert!(!Goods::from_totals(50, 100).shortage);
        assert!(Goods::from_totals(49, 100).shortage);
        assert!(Goods::from_totals(0, 1).shortage);
        assert!(
            !Goods::from_totals(0, 0).shortage,
            "nobody buys: no shortage"
        );
        assert!(!Goods::from_totals(500, 100).shortage);
    }

    #[test]
    fn the_zones_make_two_and_use_two_per_unit() {
        let zones = [
            zone(KIND_INDUSTRIAL, 16),
            zone(KIND_INDUSTRIAL, 8),
            zone(KIND_COMMERCIAL, 10),
            zone(1, 999),
        ];
        let g = Goods::of_zones(&zones);
        assert_eq!((g.produced, g.consumed), (48, 20));
        assert_eq!(Goods::of_zones(&[]), Goods::default());
    }

    #[test]
    fn huge_totals_are_clamped_not_wrapped() {
        let g = Goods::from_totals(i64::MAX / 4, 0);
        assert_eq!(g.produced, i32::MAX);
        assert_eq!(g.net, i32::MAX);
    }
}
