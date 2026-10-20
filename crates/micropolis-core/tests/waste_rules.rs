//! The waste rules (docs/game-design-v08.md): rule off = the original engine; zones make garbage
//! from their population; the monthly treatment order (recycling, incinerators, waste-to-energy,
//! landfills, exports, the pile); the conservation of the garbage; the caps; the effects on
//! pollution and land value; the power of the waste-to-energy plant.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::deals::{DealResult, WASTE_OFFER_BASE};
use micropolis_core::position::Position;
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::{LOMASK, PWRBIT};
use micropolis_core::tile_chars::{DIRT, RIVER};
use micropolis_core::tool::ToolResult;
use micropolis_core::waste::{
    BACKLOG_DECAY, GENRE_INCINERATOR, GENRE_LANDFILL, GENRE_RECYCLING, GENRE_WASTE_TO_ENERGY,
    INCINERATOR_CAPACITY, LANDFILL_CAPACITY, POLLUTION_DIV, STATS_SIZE, WTE_CAPACITY,
    WTE_POWER_STRENGTH,
};
use support::{run, state};

const W: i32 = 90;
const H: i32 = 70;
/// Garbage a residential zone of density 3, a commercial one of density 4 and an industrial one of
/// density 3 make a month (40, 40 and 32 inhabitants at 25, 40 and 60 %, rounded down).
const RES: i64 = 10;
const COM: i64 = 16;
const IND: i64 = 19;

fn bare() -> Simulation {
    let mut s = Simulation::new(W, H);
    s.tiles.fill(DIRT);
    for y in 0..H {
        s.set_tile(10, y, RIVER);
    }
    s.total_funds = 100_000_000;
    s.set_structure_rules(true);
    s.set_waste_rules(true);
    s
}

fn res(s: &mut Simulation, x: i32, y: i32) {
    s.res_plop(Position::new(x, y), 3, 0);
}

fn com(s: &mut Simulation, x: i32, y: i32) {
    s.com_plop(Position::new(x, y), 4, 0);
}

/// `n` industrial zones in rows of ten, 4 tiles apart, from (20, 30).
fn industry(s: &mut Simulation, n: i32) {
    for i in 0..n {
        s.ind_plop(Position::new(20 + 4 * (i % 10), 30 + 4 * (i / 10)), 3, 0);
    }
}

fn build(s: &mut Simulation, genre: u8, x: i32, y: i32) {
    assert_eq!(
        s.place_structure(genre, x, y),
        ToolResult::Ok,
        "{genre} at {x},{y}"
    );
}

fn power_up(s: &mut Simulation, x: i32, y: i32, size: i32) {
    for dx in 0..size {
        for dy in 0..size {
            let t = s.tile(x + dx, y + dy).unwrap();
            s.set_tile(x + dx, y + dy, t | PWRBIT);
        }
    }
}

fn stats(s: &Simulation) -> [i32; STATS_SIZE] {
    s.waste_stats()
}

fn pile(s: &Simulation) -> i64 {
    s.extensions().waste_state.pile_total()
}

fn month(s: &mut Simulation) {
    s.ext_monthly_balance();
}

#[test]
fn off_by_default_nothing_is_stored_and_the_file_is_untouched() {
    let mut s = Simulation::new(W, H);
    assert!(!s.waste_rules() && !s.waste_active() && !s.extensions_active());
    assert_eq!(s.waste_stats(), [0; STATS_SIZE]);
    assert!(s.waste_layer().iter().all(|&v| v == 0));
    assert_eq!(s.waste_layer().len(), (W * H) as usize);
    let file = s.save_city();
    s.set_waste_rules(true);
    assert!(s.extensions_active());
    s.set_waste_rules(false);
    assert_eq!(s.save_city(), file, "byte for byte");
    // on without the buildings rule, or without anything stored: no acting, no chunk 8
    s.set_waste_rules(true);
    res(&mut s, 30, 30);
    month(&mut s);
    assert_eq!(
        (pile(&s), s.waste_stats()),
        (0, [0; STATS_SIZE]),
        "needs structures"
    );
    s.set_structure_rules(true);
    assert!(s.waste_active());
    let with_waste = s.save_city();
    s.set_waste_rules(false);
    assert_eq!(
        with_waste.len(),
        s.save_city().len(),
        "nothing stored: only the rules flag differs"
    );
}

#[test]
fn the_waste_rule_alone_is_the_original_engine() {
    let make = |on: bool| {
        let mut s = Simulation::new(120, 100);
        s.new_random_city(7);
        support::starter(&mut s);
        s.set_waste_rules(on);
        run(&mut s, 600);
        s
    };
    assert_eq!(state(&make(false)), state(&make(true)));
}

#[test]
fn a_zone_makes_garbage_from_its_population_and_it_piles_around_it() {
    let mut s = bare();
    res(&mut s, 30, 30);
    com(&mut s, 50, 30);
    s.ind_plop(Position::new(30, 50), 3, 0);
    month(&mut s);
    assert_eq!(
        stats(&s),
        [
            (RES + COM + IND) as i32,
            0,
            0,
            0,
            (RES + COM + IND) as i32,
            0,
            0
        ]
    );
    let layer = s.waste_layer();
    let h = H;
    let on = |x: i32, y: i32| layer[(x * h + y) as usize];
    assert!(layer.iter().map(|&v| i64::from(v)).sum::<i64>() == RES + COM + IND);
    // the residential garbage is within the 3 tile square of its centre
    let near: i64 = (27..=33)
        .flat_map(|x| (27..=33).map(move |y| (x, y)))
        .map(|(x, y)| i64::from(on(x, y)))
        .sum();
    assert_eq!(near, RES);
    // an empty zone makes none, and a month later the pile has doubled
    month(&mut s);
    assert_eq!(pile(&s), 2 * (RES + COM + IND));
}

#[test]
fn the_buildings_treat_in_order_and_the_unpowered_incinerator_burns_nothing() {
    let mut s = bare();
    res(&mut s, 30, 30);
    com(&mut s, 50, 30);
    s.ind_plop(Position::new(30, 50), 3, 0);
    let all = (RES + COM + IND) as i32;
    build(&mut s, GENRE_INCINERATOR, 60, 10);
    month(&mut s);
    assert_eq!(stats(&s)[1], 0, "no power, no burning");
    assert_eq!(i64::from(stats(&s)[4]), pile(&s));
    power_up(&mut s, 60, 10, 2);
    let before = pile(&s);
    month(&mut s);
    let st = stats(&s);
    // the new production is burned and the old pile is eaten at BACKLOG_DECAY per tile
    assert_eq!((st[0], st[3]), (all, 0));
    assert!(i64::from(st[1]) > i64::from(all) && i64::from(st[1]) <= INCINERATOR_CAPACITY);
    assert_eq!(pile(&s), before - (i64::from(st[1]) - i64::from(all)));
    // a landfill only gets what the incinerator could not burn
    build(&mut s, GENRE_LANDFILL, 70, 10);
    let fill = |s: &Simulation| s.extensions().waste_state.fill_at(70, 10);
    for _ in 0..30 {
        month(&mut s);
    }
    assert_eq!(pile(&s), 0);
    assert_eq!(fill(&s), 0, "the incinerator was enough");
    industry(&mut s, 20);
    month(&mut s);
    let produced = i64::from(stats(&s)[0]);
    assert_eq!(fill(&s), produced - INCINERATOR_CAPACITY);
    assert_eq!(pile(&s), 0);
}

#[test]
fn a_full_landfill_takes_nothing_more() {
    let mut s = bare();
    res(&mut s, 30, 30);
    com(&mut s, 50, 30);
    build(&mut s, GENRE_LANDFILL, 70, 10);
    s.extensions_mut()
        .waste_state
        .set_fill(70, 10, LANDFILL_CAPACITY - 5);
    assert_eq!(s.landfill_room(), 5);
    month(&mut s);
    assert_eq!(
        s.extensions().waste_state.fill_at(70, 10),
        LANDFILL_CAPACITY
    );
    assert_eq!(stats(&s)[1], 5);
    assert_eq!(pile(&s), RES + COM - 5);
    assert_eq!((s.landfill_room(), stats(&s)[5]), (0, 0));
    month(&mut s);
    assert_eq!(
        s.extensions().waste_state.fill_at(70, 10),
        LANDFILL_CAPACITY
    );
    assert_eq!(stats(&s)[1], 0);
    assert_eq!(pile(&s), 2 * (RES + COM) - 5);
}

#[test]
fn recycling_cuts_the_production_in_its_radius_up_to_a_cap() {
    let mut s = bare();
    res(&mut s, 30, 30);
    com(&mut s, 80, 60);
    build(&mut s, GENRE_RECYCLING, 33, 30);
    month(&mut s);
    // the residential zone recycles 30 % (3 of 10); the far commercial zone nothing
    let st = stats(&s);
    assert_eq!((st[0], st[2]), ((RES + COM) as i32, 3));
    assert_eq!(pile(&s), RES + COM - 3);
    build(&mut s, GENRE_RECYCLING, 33, 33);
    build(&mut s, GENRE_RECYCLING, 36, 30);
    month(&mut s);
    // three centres: 90 % wanted, 60 % allowed
    assert_eq!(stats(&s)[2], 6);
}

#[test]
fn exports_cost_money_and_take_what_is_left_after_the_buildings() {
    let mut s = bare();
    s.set_deals_rules(true);
    industry(&mut s, 20);
    assert_eq!(s.accept_deal(WASTE_OFFER_BASE), DealResult::Done);
    let (amount, price) = {
        let d = s.deals()[0];
        (i64::from(d.amount), i64::from(d.price))
    };
    let funds = s.total_funds;
    month(&mut s);
    let st = stats(&s);
    assert_eq!(i64::from(st[3]), amount, "capped by the deal");
    assert_eq!(s.total_funds, funds - amount * price, "the city pays");
    assert_eq!(pile(&s), 20 * IND - amount);
    // with a powered incinerator the buildings come first and the deal only gets the rest
    build(&mut s, GENRE_INCINERATOR, 60, 10);
    power_up(&mut s, 60, 10, 2);
    s.extensions_mut().waste_state = Default::default();
    month(&mut s);
    assert_eq!(i64::from(stats(&s)[1]), INCINERATOR_CAPACITY);
    assert_eq!(i64::from(stats(&s)[3]), amount, "the deal is still capped");
    assert_eq!(pile(&s), 20 * IND - INCINERATOR_CAPACITY - amount);
}

#[test]
fn turning_the_rule_off_forgets_the_pile_and_the_deals() {
    let mut s = bare();
    s.set_deals_rules(true);
    res(&mut s, 30, 30);
    build(&mut s, GENRE_LANDFILL, 70, 10);
    s.extensions_mut().waste_state.set_fill(70, 10, 9);
    assert_eq!(s.accept_deal(WASTE_OFFER_BASE + 1), DealResult::Done);
    month(&mut s);
    s.set_waste_rules(false);
    assert!(s.extensions().waste_state.is_empty());
    assert!(s.deals().is_empty());
    assert_eq!(s.waste_stats(), [0; STATS_SIZE]);
    assert!(s.waste_layer().iter().all(|&v| v == 0));
    assert_eq!(s.structures().len(), 1, "the buildings stay");
}

#[test]
fn the_garbage_is_conserved_every_month() {
    let mut s = bare();
    s.set_deals_rules(true);
    industry(&mut s, 12);
    res(&mut s, 30, 8);
    com(&mut s, 50, 8);
    build(&mut s, GENRE_RECYCLING, 33, 8);
    build(&mut s, GENRE_INCINERATOR, 60, 10);
    power_up(&mut s, 60, 10, 2);
    build(&mut s, GENRE_LANDFILL, 70, 10);
    s.extensions_mut()
        .waste_state
        .set_fill(70, 10, LANDFILL_CAPACITY - 400);
    assert_eq!(s.accept_deal(WASTE_OFFER_BASE + 2), DealResult::Done);
    for m in 0..40 {
        if m == 20 {
            // the zones disappear: spare capacity eats the pile
            for i in 0..12 {
                s.set_tile(20 + 4 * (i % 10), 30 + 4 * (i / 10), DIRT);
            }
        }
        let before = pile(&s);
        month(&mut s);
        let r = s.waste_report();
        assert_eq!(r.lost, 0);
        assert_eq!(
            r.produced,
            r.treated + r.recycled + r.exported + (pile(&s) - before) + r.lost,
            "month {m}"
        );
        assert_eq!(r.energised, 0);
    }
    assert!(s.waste_report().treated > 0);
}

#[test]
fn spare_capacity_eats_the_pile_slowly() {
    let mut s = bare();
    res(&mut s, 30, 30);
    for _ in 0..3 {
        month(&mut s);
    }
    assert_eq!(pile(&s), 3 * RES);
    s.set_tile(30, 30, DIRT); // the zone is gone: nothing more is made
    let tiles_before = s.waste_layer().iter().filter(|&&v| v > 0).count() as i64;
    build(&mut s, GENRE_LANDFILL, 70, 10);
    let before = pile(&s);
    month(&mut s);
    let eaten = before - pile(&s);
    assert!(eaten > 0 && eaten <= tiles_before * BACKLOG_DECAY);
    assert_eq!(i64::from(stats(&s)[1]), eaten);
    assert_eq!(s.extensions().waste_state.fill_at(70, 10), eaten);
    for _ in 0..10 {
        month(&mut s);
    }
    assert_eq!(pile(&s), 0);
}

#[test]
fn the_pile_pollutes_and_lowers_the_land_value_and_the_buildings_pollute() {
    let mut s = bare();
    // a hand-made pile of 200 units on one tile
    let index = (40 * H + 40) as u32;
    s.extensions_mut().waste_state.set_pile(index, 200);
    assert_eq!(s.ext_pollution(40, 40, 10), 10 + 200 / POLLUTION_DIV);
    assert!(s.ext_land_value(40, 40, 100) < 100);
    assert_eq!(s.ext_pollution(60, 60, 10), 10);
    assert_eq!(s.ext_land_value(60, 60, 100), 100);
    // rule off or buildings rule off: the hooks answer their input
    s.set_waste_rules(false);
    assert_eq!(s.ext_pollution(40, 40, 10), 10);
    s.set_waste_rules(true);
    s.extensions_mut().waste_state.set_pile(index, 200);
    s.set_structure_rules(false);
    assert_eq!(
        (s.ext_pollution(40, 40, 10), s.ext_land_value(40, 40, 100)),
        (10, 100)
    );
    s.set_structure_rules(true);
    s.extensions_mut().waste_state.set_pile(index, 0);
    // a working landfill pollutes around it, a broken (unpowered) incinerator does not
    build(&mut s, GENRE_LANDFILL, 20, 20);
    build(&mut s, GENRE_INCINERATOR, 50, 50);
    assert!(s.ext_pollution(21, 21, 0) > 0);
    assert_eq!(s.ext_pollution(50, 50, 0), 0);
    power_up(&mut s, 50, 50, 2);
    assert!(s.ext_pollution(50, 50, 0) > 0);
    assert_eq!(s.ext_pollution(70, 5, 0), 0, "far away");
}

#[test]
fn the_waste_to_energy_plant_powers_the_grid_like_a_plant() {
    let mut s = bare();
    res(&mut s, 24, 21);
    build(&mut s, GENRE_WASTE_TO_ENERGY, 20, 20);
    assert_eq!(s.power_capacity(), WTE_POWER_STRENGTH);
    assert_eq!(s.waste_stats()[6] as i64, WTE_POWER_STRENGTH);
    run(&mut s, 120);
    let zone = s.tile(24, 21).unwrap();
    assert!(zone & PWRBIT != 0, "the zone next to the plant is powered");
    assert_eq!(zone & LOMASK, s.tile(24, 21).unwrap() & LOMASK);
    // rule off: the plant gives nothing
    s.set_waste_rules(false);
    assert_eq!(s.power_capacity(), 0);
    run(&mut s, 120);
    assert_eq!(s.tile(24, 21).unwrap() & PWRBIT, 0);
}

#[test]
fn the_waste_to_energy_plant_burns_up_to_its_capacity() {
    let mut s = bare();
    industry(&mut s, 30);
    build(&mut s, GENRE_WASTE_TO_ENERGY, 20, 10);
    month(&mut s);
    let r = s.waste_report();
    assert_eq!(r.produced, 30 * IND);
    assert_eq!((r.treated, r.energised), (WTE_CAPACITY, WTE_CAPACITY));
    assert_eq!(pile(&s), 30 * IND - WTE_CAPACITY);
}

#[test]
fn a_landfill_that_is_bulldozed_forgets_its_fill() {
    let mut s = bare();
    build(&mut s, GENRE_LANDFILL, 70, 10);
    s.extensions_mut().waste_state.set_fill(70, 10, 77);
    assert_eq!(s.remove_structure(70, 10), ToolResult::Ok);
    month(&mut s);
    assert!(s.extensions().waste_state.fills().is_empty());
}
