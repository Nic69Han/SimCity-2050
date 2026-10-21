//! The energy rules (docs/game-design-v10.md): rule off = the original engine; the plants of the
//! catalog add power to the grid and take it away when pulled down; ageing (full power to 80 % of
//! the life, a fall, a stop) of the new and the classic plants; the pollution of each genre; the
//! electricity bought from the neighbours; the caps.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::deals::{DealResult, POWER_OFFER_BASE};
use micropolis_core::energy::curve::{life_months, power_at, wear_start};
use micropolis_core::energy::{
    spec_of, AGE_STEP_MONTHS, GENRE_COAL, GENRE_FUSION, GENRE_GAS, GENRE_HYDRO, GENRE_MICROWAVE,
    GENRE_NUCLEAR, GENRE_OIL, GENRE_SOLAR, GENRE_WIND, PLANTS, STATS_SIZE,
};
use micropolis_core::position::Position;
use micropolis_core::simulation::Simulation;
use micropolis_core::structures::MAX_STRUCTURES;
use micropolis_core::tile::{LOMASK, PWRBIT, ZONEBIT};
use micropolis_core::tile_chars::{DIRT, NUCLEAR, POWERPLANT, RIVER};
use micropolis_core::tool::{EditingTool, ToolResult};
use support::{run, state};

const W: i32 = 90;
const H: i32 = 70;
/// Every catalog plant with its footprint side.
const CATALOG_PLANTS: [(u8, i32); 7] = [
    (GENRE_GAS, 3),
    (GENRE_OIL, 3),
    (GENRE_WIND, 1),
    (GENRE_SOLAR, 3),
    (GENRE_HYDRO, 2),
    (GENRE_MICROWAVE, 3),
    (GENRE_FUSION, 4),
];

/// Bare land with a river along x = 10, funds, the buildings and the energy rules on.
fn bare() -> Simulation {
    let mut s = Simulation::new(W, H);
    s.tiles.fill(DIRT);
    for y in 0..H {
        s.set_tile(10, y, RIVER);
    }
    s.total_funds = 100_000_000;
    s.set_structure_rules(true);
    s.set_energy_rules(true);
    s
}

fn build(s: &mut Simulation, genre: u8, x: i32, y: i32) {
    assert_eq!(
        s.place_structure(genre, x, y),
        ToolResult::Ok,
        "{genre} at {x},{y}"
    );
}

fn month(s: &mut Simulation) {
    s.ext_monthly_balance();
}

fn months(s: &mut Simulation, n: u32) {
    for _ in 0..n {
        month(s);
    }
}

/// The plant of the list at anchor `(x, y)`.
fn plant_at(s: &Simulation, x: i32, y: i32) -> micropolis_core::energy::Plant {
    *s.energy_plants()
        .iter()
        .find(|p| (p.x, p.y) == (x, y))
        .expect("a plant there")
}

/// A classic coal plant (4 x 4) built with the tool; returns its centre tile.
fn coal_plant(s: &mut Simulation, x: i32, y: i32) -> (i32, i32) {
    assert_eq!(s.tool_down(EditingTool::CoalPower, x, y), ToolResult::Ok);
    centre_of(s, POWERPLANT)
}

fn centre_of(s: &Simulation, character: u16) -> (i32, i32) {
    (0..W)
        .flat_map(|x| (0..H).map(move |y| (x, y)))
        .find(|&(x, y)| {
            let t = s.tile(x, y).unwrap();
            t & ZONEBIT != 0 && t & LOMASK == character
        })
        .expect("a plant centre")
}

#[test]
fn off_by_default_nothing_is_stored_and_nothing_is_built() {
    let mut s = Simulation::new(W, H);
    s.tiles.fill(DIRT);
    s.total_funds = 1_000_000;
    s.set_structure_rules(true);
    assert!(!s.energy_rules() && !s.energy_active());
    assert_eq!(s.energy_stats(), [0; STATS_SIZE]);
    assert!(s.energy_plants().is_empty());
    for (genre, _) in CATALOG_PLANTS {
        assert_eq!(s.place_structure(genre, 30, 30), ToolResult::Failed);
        assert_eq!(
            s.structure_preview(genre, 30, 30).result,
            ToolResult::Failed
        );
    }
    // on without the buildings rule, nothing acts
    let mut t = Simulation::new(W, H);
    t.set_energy_rules(true);
    assert!(t.extensions_active() && !t.energy_active());
    assert_eq!(t.energy_stats(), [0; STATS_SIZE]);
    assert_eq!(t.place_structure(GENRE_WIND, 30, 30), ToolResult::Failed);
}

#[test]
fn the_energy_rule_alone_is_the_original_engine() {
    let make = |energy: bool, structures: bool| {
        let mut s = Simulation::new(120, 100);
        s.new_random_city(7);
        support::starter(&mut s);
        s.set_structure_rules(structures);
        s.set_energy_rules(energy);
        run(&mut s, 600);
        s
    };
    let classic = state(&make(false, false));
    assert_eq!(classic, state(&make(true, false)));
    assert_eq!(
        classic,
        state(&make(true, true)),
        "young plants lose nothing"
    );
}

#[test]
fn every_plant_is_a_conductive_building_of_the_right_size_and_price() {
    let mut s = bare();
    let funds = s.total_funds;
    for (i, (genre, side)) in CATALOG_PLANTS.iter().enumerate() {
        let x = if *genre == GENRE_HYDRO {
            11
        } else {
            20 + 6 * i as i32
        };
        let before = s.total_funds;
        let preview = s.structure_preview(*genre, x, 30);
        build(&mut s, *genre, x, 30);
        assert_eq!(before - s.total_funds, i64::from(preview.cost));
        for (dx, dy) in [(0, 0), (side - 1, side - 1)] {
            let t = s.tile(x + dx, 30 + dy).unwrap();
            assert!(t & micropolis_core::tile::CONDBIT != 0);
        }
        assert_eq!(s.tile(x + side, 30), Some(DIRT));
    }
    assert_eq!(s.energy_plants().len(), 7);
    let costs = [4000, 3000, 250, 6000, 3500, 15_000, 40_000];
    assert_eq!(funds - s.total_funds, costs.iter().sum::<i64>());
    let upkeep = [40, 50, 2, 20, 30, 100, 150];
    assert_eq!(i64::from(s.structures_upkeep()), upkeep.iter().sum::<i64>());
}

#[test]
fn the_hydroelectric_plant_needs_a_water_tile_next_to_its_footprint() {
    let mut s = bare();
    assert_eq!(s.place_structure(GENRE_HYDRO, 30, 30), ToolResult::Failed);
    assert_eq!(s.place_structure(GENRE_HYDRO, 12, 30), ToolResult::Failed);
    assert_eq!(
        s.place_structure(GENRE_HYDRO, 9, 30),
        ToolResult::Failed,
        "on the water"
    );
    build(&mut s, GENRE_HYDRO, 11, 30);
    build(&mut s, GENRE_HYDRO, 8, 40);
    // only the neighbours of the sides count, not the corners
    let mut t = bare();
    t.set_tile(10, 30, DIRT);
    t.set_tile(10, 31, DIRT);
    t.set_tile(13, 29, RIVER);
    assert_eq!(t.place_structure(GENRE_HYDRO, 11, 30), ToolResult::Failed);
    // the other plants do not care
    assert_eq!(t.place_structure(GENRE_WIND, 40, 40), ToolResult::Ok);
}

#[test]
fn a_plant_adds_its_power_and_pulling_it_down_removes_it() {
    let mut s = bare();
    assert_eq!(s.power_capacity(), 0);
    for (i, (genre, _)) in CATALOG_PLANTS.iter().enumerate() {
        let (x, y) = if *genre == GENRE_HYDRO {
            (11, 5)
        } else {
            (30 + 6 * i as i32, 30)
        };
        build(&mut s, *genre, x, y);
        let expect: i64 = CATALOG_PLANTS[..=i]
            .iter()
            .map(|(g, _)| spec_of(*g).unwrap().power)
            .sum();
        assert_eq!(s.power_capacity(), expect, "after the plant {genre}");
        assert_eq!(s.energy_stats()[0] as i64, expect);
    }
    let total = s.power_capacity();
    assert_eq!(s.remove_structure(30, 30), ToolResult::Ok);
    assert_eq!(s.power_capacity(), total - 400, "the gas plant is gone");
}

#[test]
fn the_grid_is_powered_from_a_plant_and_dark_without_it() {
    let mut s = bare();
    s.res_plop(Position::new(24, 31), 3, 0);
    build(&mut s, GENRE_GAS, 20, 30);
    run(&mut s, 120);
    assert!(s.tile(24, 31).unwrap() & PWRBIT != 0, "next to the plant");
    assert_eq!(s.remove_structure(20, 30), ToolResult::Ok);
    run(&mut s, 120);
    assert_eq!(s.tile(24, 31).unwrap() & PWRBIT, 0);
    // a plant stopped by age powers nothing, and a rule turned off pulls the plants down
    build(&mut s, GENRE_WIND, 20, 30);
    assert_eq!(s.power_capacity(), 30);
    s.set_energy_rules(false);
    assert!(s.structures().is_empty() && s.energy_plants().is_empty());
    assert_eq!(s.power_capacity(), 0);
    assert_eq!(s.energy_stats(), [0; STATS_SIZE]);
}

#[test]
fn a_new_plant_is_0_months_old_and_each_pass_adds_a_year() {
    let mut s = bare();
    build(&mut s, GENRE_WIND, 30, 30);
    assert_eq!(plant_at(&s, 30, 30).age, 0);
    months(&mut s, 5);
    let p = plant_at(&s, 30, 30);
    assert_eq!((p.age, p.life, p.power), (5 * AGE_STEP_MONTHS, 240, 30));
    // pulling it down and building it again starts over, even within the month
    assert_eq!(s.remove_structure(30, 30), ToolResult::Ok);
    build(&mut s, GENRE_WIND, 30, 30);
    assert_eq!(plant_at(&s, 30, 30).age, 0);
    assert!(
        s.extensions().energy_state.is_empty() || s.extensions().energy_state.age_of(30, 30) == 0
    );
}

#[test]
fn a_plant_keeps_full_power_to_80_percent_of_its_life_then_loses_power_then_stops() {
    let mut s = bare();
    build(&mut s, GENRE_WIND, 30, 30);
    let spec = spec_of(GENRE_WIND).unwrap();
    let (start, end) = (wear_start(spec), life_months(spec));
    assert_eq!((start, end), (192, 240));
    // one pass of the balance hook is one game year
    months(&mut s, start / AGE_STEP_MONTHS);
    assert_eq!((plant_at(&s, 30, 30).power, s.power_capacity()), (30, 30));
    assert_eq!(s.energy_stats()[4], 0, "not worn yet");
    month(&mut s);
    assert_eq!(s.energy_stats()[4], 1, "worn from the year after");
    assert_eq!(
        plant_at(&s, 30, 30).power,
        power_at(spec, start + AGE_STEP_MONTHS)
    );
    months(&mut s, (end - start) / AGE_STEP_MONTHS - 2);
    let last = plant_at(&s, 30, 30);
    assert_eq!(last.age, end - AGE_STEP_MONTHS);
    assert!(
        last.power >= 15 && last.power < 30,
        "still above half: {}",
        last.power
    );
    month(&mut s);
    let stopped = plant_at(&s, 30, 30);
    assert_eq!((stopped.age, stopped.power), (end, 0));
    assert_eq!((s.power_capacity(), s.energy_stats()[0]), (0, 0));
    assert_eq!(
        s.energy_stats()[3..5],
        [1, 1],
        "counted, worn, producing nothing"
    );
    month(&mut s);
    assert_eq!(plant_at(&s, 30, 30).power, 0);
}

#[test]
fn the_classic_plants_age_while_the_rule_is_on_and_lose_power() {
    let mut s = bare();
    let coal = coal_plant(&mut s, 40, 40);
    assert_eq!(s.power_capacity(), 700);
    assert_eq!(s.energy_stats()[3], 1);
    assert_eq!(s.energy_plants()[0].genre, GENRE_COAL);
    let spec = spec_of(GENRE_COAL).unwrap();
    s.extensions_mut().energy_state.set(coal.0, coal.1, 540);
    assert_eq!(s.power_capacity(), 525, "halfway through the fall: 75 %");
    assert_eq!(plant_at(&s, coal.0, coal.1).power, power_at(spec, 540));
    s.extensions_mut().energy_state.set(coal.0, coal.1, 600);
    assert_eq!(s.power_capacity(), 0);
    // the power scan agrees: nothing is powered
    s.res_plop(Position::new(36, 40), 3, 0);
    run(&mut s, 120);
    assert_eq!(s.tile(36, 40).unwrap() & PWRBIT, 0, "the plant has stopped");
    // a new plant next to the dead one still powers the grid: the total never goes under 0
    build(&mut s, GENRE_WIND, 50, 50);
    assert_eq!(s.power_capacity(), 30);
    // the nuclear plant ages too
    let mut n = bare();
    assert_eq!(
        n.tool_down(EditingTool::NuclearPower, 40, 40),
        ToolResult::Ok
    );
    let c = centre_of(&n, NUCLEAR);
    n.extensions_mut().energy_state.set(c.0, c.1, 600);
    assert_eq!(n.power_capacity(), 0);
    assert_eq!(n.energy_plants()[0].genre, GENRE_NUCLEAR);
}

#[test]
fn the_classic_plants_get_an_age_with_the_first_month_and_none_with_the_rule_off() {
    let mut s = bare();
    let c = coal_plant(&mut s, 40, 40);
    assert!(s.extensions().energy_state.is_empty());
    months(&mut s, 3);
    assert_eq!(
        s.extensions().energy_state.age_of(c.0, c.1),
        3 * AGE_STEP_MONTHS
    );
    // bulldozed and rebuilt elsewhere: the old age is forgotten
    s.tool_down(EditingTool::Bulldozer, c.0, c.1);
    s.ext_valves();
    assert!(s.extensions().energy_state.is_empty());
    let mut off = bare();
    off.set_energy_rules(false);
    coal_plant(&mut off, 40, 40);
    months(&mut off, 3);
    assert!(off.extensions().energy_state.is_empty());
    assert_eq!(off.power_capacity(), 700);
}

#[test]
fn each_genre_pollutes_as_its_table_says_and_a_stopped_plant_does_not() {
    for (genre, side) in CATALOG_PLANTS {
        let mut s = bare();
        let (x, y) = if genre == GENRE_HYDRO {
            (11, 5)
        } else {
            (40, 40)
        };
        build(&mut s, genre, x, y);
        let spec = spec_of(genre).unwrap();
        assert_eq!(
            s.ext_pollution(x, y, 7),
            7 + spec.pollution,
            "genre {genre}"
        );
        assert_eq!(s.energy_stats()[5], spec.pollution, "genre {genre}");
        if spec.pollution == 0 {
            continue;
        }
        // falls off linearly with the distance to the footprint and is 0 past the radius
        let d = |n: i32| s.ext_pollution(x + side - 1 + n, y, 0);
        assert_eq!(d(0), spec.pollution);
        assert_eq!(d(1), spec.pollution * spec.radius / (spec.radius + 1));
        assert_eq!(d(spec.radius), spec.pollution / (spec.radius + 1));
        assert_eq!(d(spec.radius + 1), 0);
        // end of life: no power, no pollution
        s.extensions_mut().energy_state.set(x, y, life_months(spec));
        assert_eq!((s.ext_pollution(x, y, 7), s.energy_stats()[5]), (7, 0));
        // rule off: the hook answers its input
        s.set_energy_rules(false);
        assert_eq!(s.ext_pollution(x, y, 7), 7);
    }
    let sum: i32 = PLANTS.iter().map(|p| p.pollution).sum();
    assert_eq!(sum, 80, "gas 30 and oil 50, nothing else");
    let mut both = bare();
    build(&mut both, GENRE_GAS, 40, 40);
    build(&mut both, GENRE_OIL, 60, 40);
    assert_eq!(both.energy_stats()[5], 80);
}

/// A wind turbine and `n` residential zones in rows of 20 touching each other, from (20, 31).
fn windy_town(n: i32) -> Simulation {
    let mut s = bare();
    build(&mut s, GENRE_WIND, 18, 31);
    for i in 0..n {
        s.res_plop(Position::new(20 + 3 * (i % 20), 31 + 3 * (i / 20)), 3, 0);
    }
    s
}

#[test]
fn bought_electricity_joins_the_grid_and_the_city_pays_for_it() {
    let mut s = windy_town(32);
    s.set_deals_rules(true);
    run(&mut s, 120);
    let demand = i64::from(s.energy_stats()[1]);
    assert!(demand > 230, "a long row of zones: {demand} tiles asked");
    assert_eq!(s.power_used(), 30, "the turbine alone");
    let offered = i64::from(s.deal_offer(POWER_OFFER_BASE).unwrap().amount);
    assert_eq!(s.accept_deal(POWER_OFFER_BASE), DealResult::Done);
    run(&mut s, 120);
    let stats = s.energy_stats();
    let total = 30 + offered;
    assert!(
        demand > total,
        "offer {offered} must not cover demand {demand}"
    );
    assert_eq!((i64::from(stats[0]), i64::from(stats[2])), (total, offered));
    // conservation: never more than there is, and (to the one tile the classic scan loses when
    // it runs dry) all of it
    assert!(
        (total - 1..=total).contains(&s.power_used()),
        "used {}",
        s.power_used()
    );
    assert_eq!(i64::from(stats[1]), demand);
    // when the city asks for less than it has, it uses only what it asks for
    let mut small = windy_town(1);
    small.set_deals_rules(true);
    assert_eq!(small.accept_deal(POWER_OFFER_BASE), DealResult::Done);
    run(&mut small, 120);
    let st = small.energy_stats();
    assert_eq!(small.power_used(), i64::from(st[1]));
    assert!(i64::from(st[1]) < i64::from(st[0]));
    // the sale surplus does not hold the bought power
    assert_eq!(small.deal_surplus()[0], 30 - small.power_used());
}

#[test]
fn buying_costs_amount_times_price_each_month_and_stops_when_cancelled_or_the_rule_goes_off() {
    let funds_after = |deal: bool| {
        let mut s = windy_town(1);
        s.set_deals_rules(true);
        if deal {
            assert_eq!(s.accept_deal(POWER_OFFER_BASE), DealResult::Done);
        }
        s.total_funds = 1_000_000;
        month(&mut s);
        s.total_funds
    };
    assert_eq!(funds_after(false) - funds_after(true), 100 * 2);
    let mut s = windy_town(1);
    s.set_deals_rules(true);
    s.accept_deal(POWER_OFFER_BASE + 3);
    assert_eq!(s.energy_bought(), 250);
    let before = s.total_funds;
    assert_eq!(s.cancel_deal(0), DealResult::Done);
    assert_eq!(before - s.total_funds, 250, "half of 250 * 2");
    assert_eq!(s.energy_bought(), 0);
    s.accept_deal(POWER_OFFER_BASE + 1);
    s.set_energy_rules(false);
    assert_eq!((s.energy_bought(), s.deals().len()), (0, 0));
    assert_eq!(s.deal_offer_status(POWER_OFFER_BASE), DealResult::RulesOff);
}

#[test]
fn the_plants_and_the_ages_are_capped() {
    let mut s = bare();
    for i in 0..MAX_STRUCTURES as i32 {
        build(&mut s, GENRE_WIND, 20 + i % 60, 2 + 2 * (i / 60));
    }
    assert_eq!(s.place_structure(GENRE_WIND, 80, 60), ToolResult::Failed);
    month(&mut s);
    let ages = s.extensions().energy_state.as_slice();
    assert_eq!(ages.len(), MAX_STRUCTURES);
    assert!(ages.iter().all(|a| a.months == AGE_STEP_MONTHS));
    const { assert!(MAX_STRUCTURES <= micropolis_core::energy::MAX_PLANTS) };
    // an age never passes what the file can hold
    s.extensions_mut().energy_state.set(20, 2, u32::MAX);
    month(&mut s);
    assert_eq!(
        s.extensions().energy_state.age_of(20, 2),
        micropolis_core::energy::MAX_AGE_MONTHS
    );
}

/// Bulldozes the whole 4 x 4 footprint of a classic plant centred on `c` (no valve pass).
fn bulldoze_plant(s: &mut Simulation, c: (i32, i32)) {
    for x in c.0 - 2..=c.0 + 1 {
        for y in c.1 - 2..=c.1 + 1 {
            s.tool_down(EditingTool::Bulldozer, x, y);
        }
    }
    assert!(s.energy_plants().is_empty(), "the plant is gone");
}

#[test]
fn a_plant_built_where_a_worn_classic_plant_stood_is_new_without_any_valve_pass() {
    // a coal plant rebuilt at the same place
    let mut s = bare();
    let c = coal_plant(&mut s, 40, 40);
    s.extensions_mut().energy_state.set(c.0, c.1, 590);
    bulldoze_plant(&mut s, c);
    let again = coal_plant(&mut s, 40, 40);
    assert_eq!(again, c);
    assert_eq!(plant_at(&s, c.0, c.1).age, 0);
    assert_eq!(s.power_capacity(), 700);

    // a catalog plant whose top-left is the old centre
    let mut w = bare();
    let c = coal_plant(&mut w, 40, 40);
    w.extensions_mut().energy_state.set(c.0, c.1, 590);
    bulldoze_plant(&mut w, c);
    w.tool_down(EditingTool::Bulldozer, c.0, c.1);
    build(&mut w, GENRE_WIND, c.0, c.1);
    let p = plant_at(&w, c.0, c.1);
    assert_eq!((p.age, p.power), (0, 30));
    assert_eq!(w.power_capacity(), 30);
}
