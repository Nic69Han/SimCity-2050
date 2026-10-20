//! wasm adapter: the deals with the neighbouring cities (docs/game-design-v02b.md); the rules live
//! in `micropolis_core::deals` (translation only, ARCHITECTURE.md rule 4).
//!
//! * `deals_rules() -> bool`, `set_deals_rules(on)`: the switch (off by default: no offer, no
//!   income, the engine is the original). Turning it off drops every deal for free.
//! * `deal_offers() -> Int32Array`: the offers on the table, flat records of [`OFFER_LEN`] values
//!   `[neighbour, resource, amount, price, yearly_income, status]`, in offer order (the position
//!   of a record is the `offer_index` of `accept_deal`). Neighbour 0..=3 = north, east, south,
//!   west; resource 0 = electricity, 1 = water; `status` is the code `accept_deal` would answer
//!   now. Empty with the rule off.
//! * `active_deals() -> Int32Array`: the signed deals, flat records of [`DEAL_LEN`] values
//!   `[neighbour, resource, amount, price, yearly_income, covered, cancel_penalty]`, oldest first
//!   (the position is the `index` of `cancel_deal`); `covered` is 1 when the city can supply the
//!   deal now, 0 when it would break at the next tax collection.
//! * `accept_deal(offer_index) -> i32` and `cancel_deal(index) -> i32`: 1 done, 0 invalid index,
//!   -1 rule off, -2 already signed, -3 not enough surplus, -4 too many deals.
//! * Waste (docs/game-design-v08.md): resource 2 = garbage, offers 8..=11 (north to west), listed
//!   only while the waste rules are on. The city *pays* the neighbour, so for such a record the
//!   adapter shows `price` and `yearly_income` **negated** (a negative number is a cost); the
//!   engine keeps them positive. `amount` is the units taken per month. `cancel_penalty` stays the
//!   positive number of dollars paid.
//! * `surplus() -> Int32Array`: `[electricity, water]`, the free surplus (capacity - used - signed
//!   deals; negative when a deal is not covered); `[0, 0]` with the rule off.

use crate::City;
use micropolis_core::deals::{settle, Deal, OFFER_COUNT, RESOURCE_WASTE, TOTAL_OFFER_COUNT};
use wasm_bindgen::prelude::*;

/// Values per record of `deal_offers`.
pub const OFFER_LEN: usize = 6;
/// Values per record of `active_deals`.
pub const DEAL_LEN: usize = 7;

fn clamp(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn terms(d: &Deal) -> [i32; 5] {
    // the city pays for its garbage to be taken: a cost is shown negative
    let sign = if d.resource == RESOURCE_WASTE { -1 } else { 1 };
    [
        i32::from(d.neighbour),
        i32::from(d.resource),
        d.amount,
        sign * d.price,
        sign * d.yearly_income(),
    ]
}

/// An index from the page as the core's; a negative one maps to one no list holds.
fn index(i: i32) -> usize {
    usize::try_from(i).unwrap_or(usize::MAX)
}

#[wasm_bindgen]
impl City {
    /// Whether the deals with the neighbours are on.
    pub fn deals_rules(&self) -> bool {
        self.sim.deals_rules()
    }

    /// Turns the deals on or off (off drops every signed deal).
    pub fn set_deals_rules(&mut self, on: bool) {
        self.sim.set_deals_rules(on);
    }

    /// The offers, flat records `[neighbour, resource, amount, price, yearly_income, status]`.
    pub fn deal_offers(&self) -> Vec<i32> {
        let mut out = Vec::new();
        if !self.sim.deals_rules() {
            return out;
        }
        let shown = if self.sim.waste_rules() {
            TOTAL_OFFER_COUNT
        } else {
            OFFER_COUNT
        };
        out.reserve(shown * OFFER_LEN);
        for i in 0..shown {
            if let Some(offer) = self.sim.deal_offer(i) {
                out.extend_from_slice(&terms(&offer));
                out.push(self.sim.deal_offer_status(i) as i32);
            }
        }
        out
    }

    /// The signed deals, flat records
    /// `[neighbour, resource, amount, price, yearly_income, covered, cancel_penalty]`.
    pub fn active_deals(&self) -> Vec<i32> {
        let list = self.sim.extensions().deal_list;
        let (_, covered) = settle(&list, self.sim.raw_surplus());
        let mut out = Vec::with_capacity(list.len() * DEAL_LEN);
        for (i, d) in list.as_slice().iter().enumerate() {
            out.extend_from_slice(&terms(d));
            out.push(i32::from(covered[i]));
            out.push(micropolis_core::deals::cancel_penalty(d));
        }
        out
    }

    /// Signs offer `offer_index`; returns the result code (1 = signed).
    pub fn accept_deal(&mut self, offer_index: i32) -> i32 {
        self.sim.accept_deal(index(offer_index)) as i32
    }

    /// Cancels signed deal `deal_index` and pays the penalty; returns the result code (1 = done).
    pub fn cancel_deal(&mut self, deal_index: i32) -> i32 {
        self.sim.cancel_deal(index(deal_index)) as i32
    }

    /// `[electricity, water]` free surplus.
    pub fn surplus(&self) -> Vec<i32> {
        let s = self.sim.deal_surplus();
        vec![clamp(s[0]), clamp(s[1])]
    }
}

#[cfg(test)]
mod tests {
    use crate::City;
    use micropolis_core::tile::ZONEBIT;
    use micropolis_core::tile_chars::POWERPLANT;

    #[test]
    fn the_adapter_translates_records_and_codes() {
        let mut city = City::new(1);
        assert!(!city.deals_rules());
        assert!(city.deal_offers().is_empty());
        assert_eq!(city.surplus(), vec![0, 0]);
        assert_eq!(city.accept_deal(0), -1);
        assert_eq!(city.cancel_deal(0), -1);
        city.set_deals_rules(true);
        let offers = city.deal_offers();
        assert_eq!(offers.len(), 8 * super::OFFER_LEN);
        assert_eq!(&offers[..5], &[0, 0, 100, 5, 500]);
        assert_eq!(offers[5], -3, "no power, no surplus");
        for bad in [-1, 12, i32::MAX, i32::MIN] {
            assert_eq!(city.accept_deal(bad), 0, "{bad}");
            assert_eq!(city.cancel_deal(bad), 0, "{bad}");
        }
        city.set_waste_rules(true);
        let offers = city.deal_offers();
        assert_eq!(offers.len(), 12 * super::OFFER_LEN);
        let w = &offers[8 * super::OFFER_LEN..9 * super::OFFER_LEN];
        assert_eq!(w, &[0, 2, 60, -3, -180, 1], "garbage: a cost, shown negative");
        assert_eq!(city.accept_deal(8), 1);
        assert_eq!(city.active_deals(), vec![0, 2, 60, -3, -180, 1, 90]);
        assert_eq!(city.cancel_deal(0), 1);
        city.set_waste_rules(false);
        assert_eq!(city.deal_offers().len(), 8 * super::OFFER_LEN);
        city.sim.set_tile(3, 3, POWERPLANT | ZONEBIT);
        assert_eq!(city.surplus(), vec![700, 0]);
        assert_eq!(city.deal_offers()[5], 1);
        assert_eq!(city.accept_deal(0), 1);
        assert_eq!(city.accept_deal(0), -2);
        assert_eq!(city.active_deals(), vec![0, 0, 100, 5, 500, 1, 250]);
        assert_eq!(city.surplus(), vec![600, 0]);
        assert_eq!(city.cancel_deal(0), 1);
        assert!(city.active_deals().is_empty());
    }
}
