//! Deals with the neighbouring cities (docs/game-design-v02b.md, "Accords avec les voisins"): the
//! player sells surplus electricity and water to four neighbours (index 0 north, 1 east, 2 south,
//! 3 west; the page owns the names) for a yearly income.
//!
//! Everything is integer arithmetic, deterministic (no random number, never the simulation
//! generator) and bounded: at most [`MAX_DEALS`] deals, every loop at most [`OFFER_COUNT`] or
//! [`MAX_DEALS`] times. The rule is behind [`Extensions::deals`] (off by default: no offer, no
//! income, the engine is the original); the signed deals are saved in chunk 5.
//!
//! * **Offers**: [`OFFER_COUNT`] = 8 offers, index `neighbour * 2 + resource`. The terms depend only
//!   on the census population (the tier `0..=3`: below 2000, 10000, 50000, above) and on the
//!   years elapsed (`city_time / 48`): `amount = base_amount * (tier + 1)` units per year and
//!   `price = base_price * (100 + min(years, 50)) / 100` dollars per unit. The bases are in
//!   [`OFFERS`]. A signed deal keeps the terms it was signed at.
//! * **Surplus** (the units a resource can still sell): electricity = generating capacity -
//!   power used; water = pump capacity - zones watered. *Capacity* of electricity is the engine's
//!   own: [`COAL_POWER_UNITS`] (700, `COAL_POWER_STRENGTH`) per coal plant and
//!   [`NUCLEAR_POWER_UNITS`] (2000) per nuclear plant found on the map (a scan of the plant centre
//!   tiles, so it is the same at every phase of the cycle). *Used* is the number of tiles the last
//!   power scan energised (`power_grid_map`), which is exactly what the engine charges against its
//!   `max_power`. Water: [`WATER_PER_PUMP`] = 20 zones per pump of the water network, used = zones
//!   watered (`water_stats`); with the water rules off the water capacity is 0. The *free* surplus
//!   also subtracts the amounts of the signed deals of that resource.
//! * **Signing** ([`Simulation::accept_deal`]): needs the rule on, a valid offer, no deal yet for
//!   that neighbour and resource, a free slot, and a free surplus of at least the amount.
//! * **Income**: each tax collection (once per game year, `ext_monthly_balance`) pays
//!   `amount * price` for every deal, in order, whose amount the surplus still covers
//!   (each paid deal takes its amount out of the surplus left for the next ones).
//! * **Break**: a deal the surplus does not cover is cancelled by the neighbour: the city pays
//!   [`BREAK_PENALTY_PCT`] % (100) of its yearly income and the engine sends
//!   [`MESSAGE_DEAL_BROKEN`] (no position).
//! * **Cancelling** ([`Simulation::cancel_deal`]): the city pays [`CANCEL_PENALTY_PCT`] % (50) of the
//!   yearly income at once; the deal is gone.
//! * Turning the rule off drops every deal, free of charge.

use crate::extensions::Extensions;
use crate::simulation::{Simulation, NOWHERE};
use crate::tile::{LOMASK, ZONEBIT};
use crate::tile_chars::{NUCLEAR, POWERPLANT};

/// Neighbouring cities (north, east, south, west).
pub const NEIGHBOUR_COUNT: usize = 4;
/// Resource 0: electricity (units: tiles of power).
pub const RESOURCE_ELECTRICITY: u8 = 0;
/// Resource 1: water (units: zones watered).
pub const RESOURCE_WATER: u8 = 1;
/// Resources sold.
pub const RESOURCE_COUNT: usize = 2;
/// Offers on the table: one per neighbour and resource.
pub const OFFER_COUNT: usize = NEIGHBOUR_COUNT * RESOURCE_COUNT;
/// Most deals at a time (one per offer).
pub const MAX_DEALS: usize = OFFER_COUNT;
/// Power tiles a coal plant supplies (`COAL_POWER_STRENGTH` of `power.rs`).
pub const COAL_POWER_UNITS: i64 = 700;
/// Power tiles a nuclear plant supplies (`NUCLEAR_POWER_STRENGTH` of `power.rs`).
pub const NUCLEAR_POWER_UNITS: i64 = 2000;
/// Zones one water pump can serve.
pub const WATER_PER_PUMP: i64 = 20;
/// Percent of the yearly income paid when the player cancels a deal.
pub const CANCEL_PENALTY_PCT: i64 = 50;
/// Percent of the yearly income paid when the city cannot supply a deal any more.
pub const BREAK_PENALTY_PCT: i64 = 100;
/// Game message sent when a deal breaks (the original messages stop at 57; no position).
pub const MESSAGE_DEAL_BROKEN: i16 = 58;
/// City-time steps in a game year (the tax collection period).
const YEAR_STEPS: i64 = 48;
/// Years after which the price drift stops.
const PRICE_DRIFT_YEARS: i64 = 50;
/// Population tiers: the tier is the number of thresholds the population reaches.
const TIER_POPULATION: [i64; 3] = [2_000, 10_000, 50_000];
/// Bytes of one saved deal: neighbour, resource, amount (i32 BE), price (i32 BE).
const DEAL_BYTES: usize = 10;
/// Largest amount or price a file may hold.
const MAX_TERM: i32 = 1_000_000;

/// Base amount (units per year) and base price (dollars per unit and year) of the offer of each
/// neighbour for each resource: `OFFERS[neighbour][resource]`.
pub const OFFERS: [[(i32, i32); RESOURCE_COUNT]; NEIGHBOUR_COUNT] = [
    [(100, 5), (4, 60)],
    [(150, 4), (5, 50)],
    [(200, 6), (6, 70)],
    [(250, 4), (8, 55)],
];

/// Results of [`Simulation::accept_deal`] (and the codes the page gets).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum DealResult {
    /// The deal is signed (or cancelled).
    Done = 1,
    /// No such offer or deal.
    Invalid = 0,
    /// The deals rule is off.
    RulesOff = -1,
    /// A deal with that neighbour for that resource already exists.
    Already = -2,
    /// The free surplus is smaller than the amount.
    NoSurplus = -3,
    /// [`MAX_DEALS`] deals are signed.
    Full = -4,
}

/// One term sheet: a neighbour buys `amount` units of a resource per year at `price` dollars per unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Deal {
    pub neighbour: u8,
    pub resource: u8,
    pub amount: i32,
    pub price: i32,
}

impl Deal {
    /// Dollars per year: `amount * price`, at most `i32::MAX`.
    pub fn yearly_income(&self) -> i32 {
        (i64::from(self.amount) * i64::from(self.price)).min(i64::from(i32::MAX)) as i32
    }
}

/// The signed deals: a fixed array, so [`Extensions`] stays `Copy`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DealList {
    items: [Deal; MAX_DEALS],
    len: u8,
}

impl DealList {
    pub fn len(&self) -> usize {
        usize::from(self.len)
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// The signed deals, oldest first.
    pub fn as_slice(&self) -> &[Deal] {
        &self.items[..self.len()]
    }

    fn has(&self, neighbour: u8, resource: u8) -> bool {
        self.as_slice()
            .iter()
            .any(|d| d.neighbour == neighbour && d.resource == resource)
    }

    pub(crate) fn push(&mut self, deal: Deal) -> bool {
        if self.len() >= MAX_DEALS {
            return false;
        }
        self.items[self.len()] = deal;
        self.len += 1;
        true
    }

    fn remove(&mut self, index: usize) -> Option<Deal> {
        let n = self.len();
        if index >= n {
            return None;
        }
        let gone = self.items[index];
        for i in index..n - 1 {
            self.items[i] = self.items[i + 1];
        }
        self.items[n - 1] = Deal::default();
        self.len -= 1;
        Some(gone)
    }

    /// The saved form: [`DEAL_BYTES`] per deal; empty when there is none.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.len() * DEAL_BYTES);
        for d in self.as_slice() {
            out.push(d.neighbour);
            out.push(d.resource);
            out.extend_from_slice(&d.amount.to_be_bytes());
            out.extend_from_slice(&d.price.to_be_bytes());
        }
        out
    }

    /// Checks and reads the saved form. `Err` when the length is not a whole number of at most
    /// [`MAX_DEALS`] deals, or a deal has an unknown neighbour or resource, an amount or a price
    /// out of `1..=1_000_000`, or repeats a (neighbour, resource) pair.
    pub fn decode(bytes: &[u8]) -> Result<DealList, &'static str> {
        if !bytes.len().is_multiple_of(DEAL_BYTES) || bytes.len() / DEAL_BYTES > MAX_DEALS {
            return Err("deals chunk has a bad length");
        }
        let mut list = DealList::default();
        for n in 0..bytes.len() / DEAL_BYTES {
            let rec = &bytes[n * DEAL_BYTES..(n + 1) * DEAL_BYTES];
            let deal = Deal {
                neighbour: rec[0],
                resource: rec[1],
                amount: i32::from_be_bytes([rec[2], rec[3], rec[4], rec[5]]),
                price: i32::from_be_bytes([rec[6], rec[7], rec[8], rec[9]]),
            };
            if usize::from(deal.neighbour) >= NEIGHBOUR_COUNT
                || usize::from(deal.resource) >= RESOURCE_COUNT
            {
                return Err("deal with an unknown neighbour or resource");
            }
            if !(1..=MAX_TERM).contains(&deal.amount) || !(1..=MAX_TERM).contains(&deal.price) {
                return Err("deal with an amount or a price out of range");
            }
            if list.has(deal.neighbour, deal.resource) || !list.push(deal) {
                return Err("deals repeat a neighbour and resource");
            }
        }
        Ok(list)
    }
}

/// Population tier `0..=3` of a population.
pub fn tier_of(population: i64) -> i64 {
    TIER_POPULATION.iter().filter(|&&t| population >= t).count() as i64
}

/// The offer `index` (`0..OFFER_COUNT`) for a city of `population` inhabitants after `years`
/// game years; `None` for an invalid index. Pure: depends on nothing else.
pub fn offer_for(index: usize, population: i64, years: i64) -> Option<Deal> {
    if index >= OFFER_COUNT {
        return None;
    }
    let (neighbour, resource) = (index / RESOURCE_COUNT, index % RESOURCE_COUNT);
    let (base_amount, base_price) = OFFERS[neighbour][resource];
    let amount = i64::from(base_amount) * (tier_of(population) + 1);
    let price = i64::from(base_price) * (100 + years.clamp(0, PRICE_DRIFT_YEARS)) / 100;
    Some(Deal {
        neighbour: neighbour as u8,
        resource: resource as u8,
        amount: amount as i32,
        price: price as i32,
    })
}

/// Free surplus of a resource: `capacity - used - committed`.
pub fn free_surplus(capacity: i64, used: i64, committed: i64) -> i64 {
    capacity - used - committed
}

/// Net dollars of one tax collection for `list` against the raw surplus `raw` of
/// `[electricity, water]`: `(net, kept)` where `net` is positive for money earned and `kept` says,
/// deal by deal, whether it was paid (`false`: it breaks). Pure.
pub fn settle(list: &DealList, raw: [i64; RESOURCE_COUNT]) -> (i64, [bool; MAX_DEALS]) {
    let mut left = raw;
    let mut kept = [false; MAX_DEALS];
    let mut net = 0i64;
    for (i, d) in list.as_slice().iter().enumerate() {
        let r = usize::from(d.resource);
        let income = i64::from(d.yearly_income());
        if left[r] >= i64::from(d.amount) {
            left[r] -= i64::from(d.amount);
            net += income;
            kept[i] = true;
        } else {
            net -= income * BREAK_PENALTY_PCT / 100;
        }
    }
    (net, kept)
}

/// Penalty for cancelling a deal.
pub fn cancel_penalty(deal: &Deal) -> i32 {
    (i64::from(deal.yearly_income()) * CANCEL_PENALTY_PCT / 100) as i32
}

/// Hook body of `ext_monthly_balance`: pays the deals and breaks those the city cannot supply.
/// Returns the net cost as the other modules do (a negative number is income). 0 with the rule off.
pub(crate) fn monthly_balance(sim: &mut Simulation) -> i32 {
    if !sim.extensions().deals || sim.extensions().deal_list.is_empty() {
        return 0;
    }
    let list = sim.extensions().deal_list;
    let (net, kept) = settle(&list, sim.raw_surplus());
    let mut survivors = DealList::default();
    for (i, d) in list.as_slice().iter().enumerate() {
        if kept[i] {
            survivors.push(*d);
        } else {
            let no = NOWHERE as i16;
            sim.send_message(MESSAGE_DEAL_BROKEN, no, no, false, true);
        }
    }
    sim.extensions_mut().deal_list = survivors;
    (-net).clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

impl Extensions {
    /// Whether any deal is signed (they are saved even with the rule off).
    pub fn has_deals(&self) -> bool {
        !self.deal_list.is_empty()
    }
}

impl Simulation {
    /// Whether the deals with the neighbours are on (off by default: the engine is the original).
    pub fn deals_rules(&self) -> bool {
        self.extensions().deals
    }

    /// Turns the deals on or off. Off drops every signed deal, free of charge.
    pub fn set_deals_rules(&mut self, on: bool) {
        let ext = self.extensions_mut();
        ext.deals = on;
        if !on {
            ext.deal_list = DealList::default();
        }
    }

    /// The signed deals, oldest first.
    pub fn deals(&self) -> &[Deal] {
        self.extensions().deal_list.as_slice()
    }

    /// Generating capacity in power tiles: [`COAL_POWER_UNITS`] per coal plant and
    /// [`NUCLEAR_POWER_UNITS`] per nuclear plant on the map. Scans the plant centre tiles.
    pub fn power_capacity(&self) -> i64 {
        let mut coal = 0i64;
        let mut nuclear = 0i64;
        for &t in self.tiles.iter() {
            if t & ZONEBIT != 0 {
                match t & LOMASK {
                    POWERPLANT => coal += 1,
                    NUCLEAR => nuclear += 1,
                    _ => {}
                }
            }
        }
        coal * COAL_POWER_UNITS + nuclear * NUCLEAR_POWER_UNITS
    }

    /// Power tiles the last power scan energised.
    pub fn power_used(&self) -> i64 {
        self.power_grid_map
            .as_slice()
            .iter()
            .filter(|&&v| v != 0)
            .count() as i64
    }

    /// `[electricity, water]` surplus before any deal: capacity - used. The water figures are 0
    /// (no capacity, no use) with the water rules off.
    pub fn raw_surplus(&self) -> [i64; RESOURCE_COUNT] {
        let water = self.water_stats();
        [
            self.power_capacity() - self.power_used(),
            i64::from(water.pumps) * WATER_PER_PUMP - i64::from(water.watered_zones),
        ]
    }

    /// `[electricity, water]` free surplus: [`raw_surplus`](Self::raw_surplus) less the amounts
    /// of the signed deals. Negative when a deal is no longer covered. 0 with the rule off.
    pub fn deal_surplus(&self) -> [i64; RESOURCE_COUNT] {
        if !self.deals_rules() {
            return [0; RESOURCE_COUNT];
        }
        let mut out = self.raw_surplus();
        for d in self.deals() {
            out[usize::from(d.resource)] -= i64::from(d.amount);
        }
        out
    }

    /// The terms of offer `index` today; `None` for an invalid index.
    pub fn deal_offer(&self, index: usize) -> Option<Deal> {
        offer_for(index, self.get_population(), self.city_time / YEAR_STEPS)
    }

    /// What [`accept_deal`](Self::accept_deal) would answer for offer `index`, without signing.
    pub fn deal_offer_status(&self, index: usize) -> DealResult {
        let Some(offer) = self.deal_offer(index) else {
            return DealResult::Invalid;
        };
        if !self.deals_rules() {
            return DealResult::RulesOff;
        }
        let list = &self.extensions().deal_list;
        if list.has(offer.neighbour, offer.resource) {
            DealResult::Already
        } else if list.len() >= MAX_DEALS {
            DealResult::Full
        } else if self.deal_surplus()[usize::from(offer.resource)] < i64::from(offer.amount) {
            DealResult::NoSurplus
        } else {
            DealResult::Done
        }
    }

    /// Signs offer `index` at today's terms.
    pub fn accept_deal(&mut self, index: usize) -> DealResult {
        let status = self.deal_offer_status(index);
        if status == DealResult::Done {
            if let Some(offer) = self.deal_offer(index) {
                self.extensions_mut().deal_list.push(offer);
            }
        }
        status
    }

    /// Cancels signed deal `index` and charges [`cancel_penalty`].
    pub fn cancel_deal(&mut self, index: usize) -> DealResult {
        if !self.deals_rules() {
            return DealResult::RulesOff;
        }
        match self.extensions_mut().deal_list.remove(index) {
            Some(gone) => {
                self.spend(cancel_penalty(&gone));
                DealResult::Done
            }
            None => DealResult::Invalid,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::Event;

    fn sim() -> Simulation {
        let mut s = Simulation::new(80, 67);
        s.set_deals_rules(true);
        s
    }

    /// A coal plant centre at (x, y) and `used` energised tiles in the power map.
    fn give_power(s: &mut Simulation, plants: usize, used: usize) {
        let w = s.world_size().0;
        for i in 0..plants {
            let at = (i * 5) as i32;
            s.set_tile(at % w, 3, POWERPLANT | ZONEBIT);
        }
        for i in 0..used {
            s.power_grid_map
                .world_set((i % 80) as i32, 10 + (i / 80) as i32, 1);
        }
    }

    #[test]
    fn offers_are_a_pure_deterministic_table() {
        for i in 0..OFFER_COUNT {
            assert_eq!(offer_for(i, 5000, 3), offer_for(i, 5000, 3));
        }
        assert_eq!(offer_for(OFFER_COUNT, 0, 0), None);
        // electricity from the north: 100 units at 5 $, tier 0, no drift
        let d = offer_for(0, 0, 0).unwrap();
        assert_eq!((d.neighbour, d.resource, d.amount, d.price), (0, 0, 100, 5));
        // tier 2 triples the amount; 20 years of drift: +20 % on the price
        let d = offer_for(0, 10_000, 20).unwrap();
        assert_eq!((d.amount, d.price), (300, 6));
        // the drift stops at 50 years; the tier at 3
        let d = offer_for(7, 1_000_000, 500).unwrap();
        assert_eq!((d.neighbour, d.resource, d.amount, d.price), (3, 1, 32, 82));
        assert_eq!(tier_of(1999), 0);
        assert_eq!(tier_of(2000), 1);
        assert_eq!(tier_of(49_999), 2);
        assert_eq!(tier_of(50_000), 3);
        assert_eq!(offer_for(0, -5, -5), offer_for(0, 0, 0));
    }

    #[test]
    fn surplus_maths_with_hand_set_numbers() {
        let mut s = sim();
        assert_eq!(s.raw_surplus(), [0, 0]);
        give_power(&mut s, 2, 300);
        assert_eq!(s.power_capacity(), 1400);
        assert_eq!(s.power_used(), 300);
        assert_eq!(s.raw_surplus()[0], 1100);
        s.set_tile(40, 40, NUCLEAR | ZONEBIT);
        assert_eq!(s.power_capacity(), 1400 + 2000);
        // a plant tile without the zone bit is not a centre
        s.set_tile(41, 41, POWERPLANT);
        assert_eq!(s.power_capacity(), 3400);
        assert_eq!(free_surplus(3400, 300, 100), 3000);
    }

    #[test]
    fn water_surplus_needs_the_water_rules() {
        let mut s = sim();
        s.water_mut().pipes.set(5, 5, crate::water::PUMP);
        s.water_mut().refresh();
        assert_eq!(s.raw_surplus()[1], 0, "water rules off: no capacity");
        s.set_water_rules(true);
        assert_eq!(s.raw_surplus()[1], WATER_PER_PUMP);
        assert_eq!(s.deal_surplus()[1], WATER_PER_PUMP);
    }

    #[test]
    fn accept_checks_every_condition() {
        let mut s = Simulation::new(80, 67);
        assert_eq!(s.accept_deal(0), DealResult::RulesOff);
        assert_eq!(s.deal_offer_status(99), DealResult::Invalid);
        s.set_deals_rules(true);
        assert_eq!(s.accept_deal(0), DealResult::NoSurplus);
        assert_eq!(s.accept_deal(99), DealResult::Invalid);
        give_power(&mut s, 1, 0); // 700 free
        assert_eq!(s.deal_offer_status(0), DealResult::Done);
        assert_eq!(s.accept_deal(0), DealResult::Done); // 100
        assert_eq!(s.accept_deal(0), DealResult::Already);
        assert_eq!(s.deal_surplus()[0], 600);
        assert_eq!(s.accept_deal(4), DealResult::Done); // south, 200
        assert_eq!(s.accept_deal(6), DealResult::Done); // west, 250
        assert_eq!(s.deal_surplus()[0], 150);
        assert_eq!(s.accept_deal(2), DealResult::Done); // east, 150: nothing left
        assert_eq!(s.deal_surplus()[0], 0);
        assert_eq!(s.accept_deal(0), DealResult::Already);
        s.extensions_mut().deal_list.remove(0); // north gone: 100 free, east wants 150 again
        assert_eq!(s.deal_offer_status(0), DealResult::Done);
        assert_eq!(s.deals().len(), 3);
        // water: no pump, so no surplus
        assert_eq!(s.accept_deal(1), DealResult::NoSurplus);
    }

    #[test]
    fn the_list_is_bounded_and_full_is_reported() {
        let mut s = sim();
        s.extensions_mut().deal_list = {
            let mut l = DealList::default();
            for i in 0..MAX_DEALS {
                assert!(l.push(offer_for(i, 0, 0).unwrap()));
            }
            assert!(!l.push(Deal::default()));
            l
        };
        assert_eq!(s.deals().len(), MAX_DEALS);
        s.extensions_mut().deal_list.remove(0);
        assert_eq!(s.deals().len(), MAX_DEALS - 1);
        assert_eq!(s.extensions_mut().deal_list.remove(99), None);
    }

    #[test]
    fn cancel_charges_half_a_year() {
        let mut s = sim();
        give_power(&mut s, 1, 0);
        assert_eq!(s.accept_deal(0), DealResult::Done); // 100 x 5 = 500 a year
        let funds = s.total_funds;
        assert_eq!(s.cancel_deal(3), DealResult::Invalid);
        assert_eq!(s.total_funds, funds);
        assert_eq!(s.cancel_deal(0), DealResult::Done);
        assert_eq!(s.total_funds, funds - 250);
        assert!(s.deals().is_empty());
        s.set_deals_rules(false);
        assert_eq!(s.cancel_deal(0), DealResult::RulesOff);
    }

    #[test]
    fn the_collection_pays_then_breaks_with_a_penalty() {
        let mut s = sim();
        give_power(&mut s, 1, 0);
        assert_eq!(s.accept_deal(0), DealResult::Done); // 500
        assert_eq!(s.accept_deal(4), DealResult::Done); // 200 x 6 = 1200
        s.drain_events();
        let funds = s.total_funds;
        s.ext_monthly_balance();
        assert_eq!(s.total_funds, funds + 1700);
        assert_eq!(s.deals().len(), 2);
        assert!(s.drain_events().is_empty());
        // the plant is lost: nothing covers the deals, 100 % of 1700 is charged
        s.set_tile(0, 3, 0);
        let funds = s.total_funds;
        s.ext_monthly_balance();
        assert_eq!(s.total_funds, funds - 1700);
        assert!(s.deals().is_empty());
        let broken = s
            .drain_events()
            .into_iter()
            .filter(
                |e| matches!(e, Event::Message { number, .. } if *number == MESSAGE_DEAL_BROKEN),
            )
            .count();
        assert_eq!(broken, 2);
    }

    #[test]
    fn a_shortfall_breaks_the_later_deals_first() {
        let mut s = sim();
        give_power(&mut s, 1, 0);
        s.accept_deal(0); // 100
        s.accept_deal(4); // 200
                          // power used rises: only 250 left, the first (100) is paid, the second (200) breaks
        for i in 0..450 {
            s.power_grid_map.world_set(i % 80, 20 + i / 80, 1);
        }
        assert_eq!(s.raw_surplus()[0], 250);
        let (net, kept) = settle(&s.extensions().deal_list, s.raw_surplus());
        assert_eq!(net, 500 - 1200);
        assert_eq!(&kept[..2], &[true, false]);
        let funds = s.total_funds;
        s.ext_monthly_balance();
        assert_eq!(s.total_funds, funds - 700);
        assert_eq!(s.deals().len(), 1);
    }

    #[test]
    fn rule_off_pays_and_changes_nothing() {
        let mut s = sim();
        give_power(&mut s, 1, 0);
        s.accept_deal(0);
        s.extensions_mut().deals = false; // switched off behind the API's back
        let funds = s.total_funds;
        s.ext_monthly_balance();
        assert_eq!(s.total_funds, funds);
        assert_eq!(s.deals().len(), 1, "kept, not paid");
        s.set_deals_rules(true);
        s.set_deals_rules(false);
        assert!(s.deals().is_empty());
    }

    #[test]
    fn it_draws_no_random_number() {
        let mut s = sim();
        give_power(&mut s, 1, 0);
        let before = s.rng.clone();
        s.accept_deal(0);
        s.ext_monthly_balance();
        s.cancel_deal(0);
        assert_eq!(s.rng.random16(), before.clone().random16());
    }

    #[test]
    fn the_list_round_trips_and_bad_bytes_are_refused() {
        let mut l = DealList::default();
        l.push(offer_for(0, 0, 0).unwrap());
        l.push(offer_for(5, 20_000, 9).unwrap());
        let bytes = l.encode();
        assert_eq!(bytes.len(), 2 * DEAL_BYTES);
        assert_eq!(DealList::decode(&bytes), Ok(l));
        assert_eq!(DealList::default().encode(), Vec::<u8>::new());
        assert_eq!(DealList::decode(&[]), Ok(DealList::default()));
        let good = bytes[..DEAL_BYTES].to_vec();
        let mut bad_neighbour = good.clone();
        bad_neighbour[0] = 4;
        let mut bad_resource = good.clone();
        bad_resource[1] = 2;
        let mut zero_amount = good.clone();
        zero_amount[2..6].copy_from_slice(&0i32.to_be_bytes());
        let mut huge_price = good.clone();
        huge_price[6..10].copy_from_slice(&(MAX_TERM + 1).to_be_bytes());
        let repeated = [good.clone(), good.clone()].concat();
        let too_many = good.repeat(MAX_DEALS + 1);
        for (i, bad) in [
            good[..9].to_vec(),
            bad_neighbour,
            bad_resource,
            zero_amount,
            huge_price,
            repeated,
            too_many,
        ]
        .iter()
        .enumerate()
        {
            assert!(DealList::decode(bad).is_err(), "case {i}");
        }
    }
}
