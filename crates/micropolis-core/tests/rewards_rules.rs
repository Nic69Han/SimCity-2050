//! The rewards and special deals (docs/game-design-v12.md): rule off = the original engine; the
//! unlock thresholds (population, satisfaction, for good); the offers (proposed at their
//! population, accepted or refused for good); the placement gates; the yearly income (building
//! standing and powered); the drawbacks; the caps.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::rewards::{
    AnswerResult, ANSWER_ACCEPTED, ANSWER_NONE, ANSWER_PROPOSED, ANSWER_REFUSED, DEALS, REWARDS,
    STATS_SIZE,
};
use micropolis_core::simulation::Simulation;
use micropolis_core::structures::{kind_of, MAX_STRUCTURES};
use micropolis_core::tile::{LOMASK, PWRBIT};
use micropolis_core::tile_chars::DIRT;
use micropolis_core::tool::{EditingTool, ToolResult};
use support::{run, starter, state};

const W: i32 = 120;
const H: i32 = 100;
/// Genres, by name.
const MAYOR_HOUSE: u8 = 50;
const STATUE: u8 = 52;
const CASINO: u8 = 60;
const STATE_PRISON: u8 = 61;
const TOXIC_DUMP: u8 = 62;
const MISSILE_BASE: u8 = 63;

/// Bare land, funds, the extended buildings and the rewards on.
fn bare() -> Simulation {
    let mut s = Simulation::new(W, H);
    s.tiles.fill(DIRT);
    s.total_funds = 1_000_000;
    s.set_structure_rules(true);
    s.set_reward_rules(true);
    s
}

/// The city counts `people` inhabitants (residential units are 20 inhabitants each).
fn people(s: &mut Simulation, people: i64) {
    s.res_pop = (people / 20) as i16;
}

fn year(s: &mut Simulation) {
    s.ext_monthly_balance();
}

fn answer(s: &Simulation, genre: u8) -> u8 {
    s.extensions().reward_state.answer_of(genre)
}

fn unlocked(s: &Simulation, genre: u8) -> bool {
    s.extensions().reward_state.is_unlocked(genre)
}

/// The deal `genre` proposed, accepted and built at `(x, y)`, powered.
fn deal_built(s: &mut Simulation, genre: u8, x: i32, y: i32) {
    s.extensions_mut()
        .reward_state
        .set_answer(genre, ANSWER_ACCEPTED);
    assert_eq!(s.place_structure(genre, x, y), ToolResult::Ok, "{genre}");
    power(s, x, y);
}

fn power(s: &mut Simulation, x: i32, y: i32) {
    let t = s.tile(x, y).unwrap();
    s.set_tile(x, y, t | PWRBIT);
}

#[test]
fn off_by_default_nothing_acts_and_everything_is_refused_for_free() {
    let mut s = Simulation::new(W, H);
    s.tiles.fill(DIRT);
    s.total_funds = 1_000_000;
    s.set_structure_rules(true);
    people(&mut s, 60_000);
    s.city_yes = 100;
    assert!(!s.reward_rules() && !s.reward_active());
    assert!(s.reward_list().is_empty() && s.offer_list().is_empty());
    assert_eq!(s.reward_stats(), [0; STATS_SIZE]);
    assert_eq!(s.answer_offer(CASINO, true), AnswerResult::RulesOff);
    for g in REWARDS
        .iter()
        .map(|r| r.genre)
        .chain(DEALS.iter().map(|d| d.genre))
    {
        assert_eq!(s.place_structure(g, 20, 20), ToolResult::Failed, "{g}");
    }
    let funds = s.total_funds;
    year(&mut s);
    assert_eq!(s.total_funds, funds);
    assert!(s.extensions().reward_state.is_empty());
}

#[test]
fn the_rule_needs_the_extended_buildings() {
    let mut s = bare();
    people(&mut s, 60_000);
    s.city_yes = 100;
    s.set_structure_rules(false);
    assert!(s.reward_rules() && !s.reward_active());
    year(&mut s);
    assert!(s.extensions().reward_state.is_empty());
    assert_eq!(s.place_structure(MAYOR_HOUSE, 20, 20), ToolResult::Failed);
    s.set_structure_rules(true);
    year(&mut s);
    assert!(unlocked(&s, MAYOR_HOUSE));
}

#[test]
fn every_reward_unlocks_at_its_population_and_satisfaction() {
    for r in REWARDS {
        // one inhabitant short (the unit is 20): no
        let mut s = bare();
        people(&mut s, r.population - 20);
        s.city_yes = 100;
        year(&mut s);
        assert!(!unlocked(&s, r.genre), "{} under the population", r.genre);
        // the population but not the satisfaction
        if r.satisfaction > 0 {
            people(&mut s, r.population);
            s.city_yes = (r.satisfaction - 1) as i16;
            year(&mut s);
            assert!(!unlocked(&s, r.genre), "{} under the satisfaction", r.genre);
        }
        // both exactly
        people(&mut s, r.population);
        s.city_yes = r.satisfaction as i16;
        year(&mut s);
        assert!(unlocked(&s, r.genre), "{} at both thresholds", r.genre);
    }
}

#[test]
fn the_unlocks_are_checked_at_the_yearly_pass_and_when_the_rule_turns_on() {
    let mut s = bare();
    people(&mut s, 2_000);
    assert!(!unlocked(&s, MAYOR_HOUSE), "not between two passes");
    year(&mut s);
    assert!(unlocked(&s, MAYOR_HOUSE));
    // a city that already qualifies sees it as soon as the rule is on
    let mut t = Simulation::new(W, H);
    t.tiles.fill(DIRT);
    t.set_structure_rules(true);
    people(&mut t, 2_000);
    t.set_reward_rules(true);
    assert!(unlocked(&t, MAYOR_HOUSE));
    t.set_reward_rules(true); // the same value twice changes nothing
    assert!(unlocked(&t, MAYOR_HOUSE));
}

#[test]
fn an_unlocked_reward_stays_unlocked_when_the_city_shrinks() {
    let mut s = bare();
    people(&mut s, 5_000);
    s.city_yes = 75;
    year(&mut s);
    assert!(unlocked(&s, STATUE));
    people(&mut s, 100);
    s.city_yes = 0;
    year(&mut s);
    assert!(unlocked(&s, STATUE));
    assert_eq!(s.place_structure(STATUE, 30, 30), ToolResult::Ok);
}

#[test]
fn a_reward_is_free_needs_no_power_and_stands_once() {
    let mut s = bare();
    people(&mut s, 60_000);
    s.city_yes = 100;
    for r in REWARDS {
        assert_eq!(
            s.place_structure(r.genre, 20, 20),
            ToolResult::Failed,
            "locked"
        );
    }
    year(&mut s);
    let funds = s.total_funds;
    for (i, r) in REWARDS.iter().enumerate() {
        let x = 10 + 12 * i as i32;
        assert_eq!(s.structure_preview(r.genre, x, 20).cost, 0);
        assert_eq!(
            s.place_structure(r.genre, x, 20),
            ToolResult::Ok,
            "{}",
            r.genre
        );
        // a second one elsewhere is refused while the first stands
        assert_eq!(
            s.place_structure(r.genre, x, 50),
            ToolResult::Failed,
            "{}",
            r.genre
        );
        assert_eq!(
            s.structure_preview(r.genre, x, 50).result,
            ToolResult::Failed
        );
    }
    assert_eq!(s.total_funds, funds, "free");
    assert_eq!(s.structures_upkeep(), 0);
    assert!(s.reward_list().iter().all(|r| r.unlocked && r.placed));
    // pulled down, it can be built again
    assert_eq!(s.remove_structure(10, 20), ToolResult::Ok);
    assert!(!s.reward_list()[0].placed);
    assert_eq!(s.place_structure(MAYOR_HOUSE, 10, 60), ToolResult::Ok);
}

#[test]
fn a_reward_raises_the_land_value_like_a_park() {
    let mut earned = bare();
    people(&mut earned, 60_000);
    earned.city_yes = 100;
    year(&mut earned);
    for (genre, radius, bonus) in [
        (50u8, 6, 20),
        (51, 8, 25),
        (52, 5, 15),
        (53, 8, 20),
        (54, 10, 30),
    ] {
        let mut t = bare();
        t.extensions_mut().reward_state = earned.extensions().reward_state;
        assert_eq!(t.place_structure(genre, 40, 40), ToolResult::Ok);
        let side = kind_of(genre).unwrap().width;
        let value = |d: i32| t.ext_land_value(40 + side - 1 + d, 40, 50) - 50;
        assert_eq!(value(0), bonus, "{genre} at the footprint");
        assert_eq!(value(radius), bonus / (radius + 1), "{genre} at the radius");
        assert_eq!(value(radius + 1), 0, "{genre} past the radius");
        assert_eq!(
            value(radius / 2),
            bonus * (radius + 1 - radius / 2) / (radius + 1)
        );
    }
}

#[test]
fn an_offer_is_proposed_when_the_population_reaches_its_threshold() {
    for d in DEALS {
        let mut s = bare();
        people(&mut s, d.population - 20);
        year(&mut s);
        assert_eq!(answer(&s, d.genre), ANSWER_NONE, "{} under", d.genre);
        people(&mut s, d.population);
        year(&mut s);
        assert_eq!(answer(&s, d.genre), ANSWER_PROPOSED, "{} at", d.genre);
        people(&mut s, 0);
        year(&mut s);
        assert_eq!(answer(&s, d.genre), ANSWER_PROPOSED, "a proposal stays");
    }
    // satisfaction plays no part
    let mut s = bare();
    people(&mut s, 8_000);
    s.city_yes = 0;
    year(&mut s);
    assert_eq!(answer(&s, CASINO), ANSWER_PROPOSED);
}

#[test]
fn answering_accepts_or_refuses_a_proposed_offer_only() {
    let mut s = bare();
    people(&mut s, 30_000);
    assert_eq!(
        s.answer_offer(CASINO, true),
        AnswerResult::Unknown,
        "not proposed yet"
    );
    year(&mut s);
    // 60, 61, 62 proposed; 63 (40 000) not yet
    assert_eq!(s.answer_offer(MISSILE_BASE, true), AnswerResult::Unknown);
    for g in [50, 0, 64, 255] {
        assert_eq!(s.answer_offer(g, true), AnswerResult::Unknown, "{g}");
    }
    assert_eq!(s.answer_offer(CASINO, true), AnswerResult::Done);
    assert_eq!(answer(&s, CASINO), ANSWER_ACCEPTED);
    assert_eq!(
        s.answer_offer(CASINO, false),
        AnswerResult::Unknown,
        "already answered"
    );
    assert_eq!(s.answer_offer(STATE_PRISON, false), AnswerResult::Done);
    assert_eq!(answer(&s, STATE_PRISON), ANSWER_REFUSED);
    // a refusal is for good, whatever the population and the passes
    people(&mut s, 60_000);
    year(&mut s);
    year(&mut s);
    assert_eq!(answer(&s, STATE_PRISON), ANSWER_REFUSED);
    assert_eq!(s.answer_offer(STATE_PRISON, true), AnswerResult::Unknown);
    assert_eq!(s.place_structure(STATE_PRISON, 20, 20), ToolResult::Failed);
    assert_eq!(s.reward_stats()[3], 1);
    let views = s.offer_list();
    assert_eq!(views.len(), 4);
    assert_eq!(
        views.iter().map(|v| v.state).collect::<Vec<_>>(),
        [
            ANSWER_ACCEPTED,
            ANSWER_REFUSED,
            ANSWER_PROPOSED,
            ANSWER_PROPOSED
        ]
    );
}

#[test]
fn a_deal_is_built_once_after_its_acceptance() {
    let mut s = bare();
    people(&mut s, 60_000);
    year(&mut s);
    assert_eq!(
        s.place_structure(CASINO, 20, 20),
        ToolResult::Failed,
        "only proposed"
    );
    assert_eq!(s.answer_offer(CASINO, true), AnswerResult::Done);
    let funds = s.total_funds;
    assert_eq!(s.structure_preview(CASINO, 20, 20).cost, 0);
    assert_eq!(s.place_structure(CASINO, 20, 20), ToolResult::Ok);
    assert_eq!(s.total_funds, funds, "free");
    assert_eq!(
        s.place_structure(CASINO, 50, 50),
        ToolResult::Failed,
        "already standing"
    );
    assert_eq!(
        s.place_structure(TOXIC_DUMP, 50, 50),
        ToolResult::Failed,
        "not accepted"
    );
    assert_eq!(s.remove_structure(20, 20), ToolResult::Ok);
    assert_eq!(
        s.place_structure(CASINO, 50, 50),
        ToolResult::Ok,
        "again once pulled down"
    );
}

#[test]
fn the_yearly_income_needs_the_building_standing_and_powered() {
    let mut s = bare();
    deal_built(&mut s, CASINO, 20, 20);
    deal_built(&mut s, MISSILE_BASE, 60, 60);
    people(&mut s, 0);
    let funds = s.total_funds;
    year(&mut s);
    assert_eq!(s.total_funds, funds + 3_000 + 10_000);
    assert_eq!(s.reward_stats()[1], 13_000);
    year(&mut s);
    assert_eq!(s.total_funds, funds + 2 * 13_000, "every year");
    // the missile base loses its power: only the casino pays
    let t = s.tile(60, 60).unwrap();
    s.set_tile(60, 60, t & !PWRBIT);
    let funds = s.total_funds;
    year(&mut s);
    assert_eq!(s.total_funds, funds + 3_000);
    assert_eq!(s.reward_stats()[1], 3_000);
    // pulled down: nothing
    assert_eq!(s.remove_structure(20, 20), ToolResult::Ok);
    let funds = s.total_funds;
    year(&mut s);
    assert_eq!(s.total_funds, funds);
    assert_eq!(s.reward_stats()[1], 0);
}

#[test]
fn an_accepted_deal_without_a_building_pays_nothing() {
    let mut s = bare();
    s.extensions_mut()
        .reward_state
        .set_answer(TOXIC_DUMP, ANSWER_ACCEPTED);
    let funds = s.total_funds;
    year(&mut s);
    assert_eq!(s.total_funds, funds);
}

#[test]
fn the_casino_adds_crime_with_a_linear_fall_off() {
    let mut s = bare();
    deal_built(&mut s, CASINO, 40, 40); // 3 x 3: footprint 40..=42
    assert_eq!(s.ext_crime(41, 41, 10), 40, "inside: +30");
    assert_eq!(
        s.ext_crime(42 + 6, 41, 10),
        10 + 30 * 7 / 13,
        "6 tiles away"
    );
    assert_eq!(s.ext_crime(42 + 12, 41, 10), 10 + 30 / 13, "at the radius");
    assert_eq!(s.ext_crime(42 + 13, 41, 10), 10, "past it");
    assert_eq!(s.ext_pollution(41, 41, 10), 10);
    assert_eq!(s.ext_land_value(41, 41, 100), 100);
    // a bad neighbour even without power
    let t = s.tile(40, 40).unwrap();
    s.set_tile(40, 40, t & !PWRBIT);
    assert_eq!(s.ext_crime(41, 41, 10), 40);
}

#[test]
fn the_state_prison_adds_crime_and_lowers_the_land_value() {
    let mut s = bare();
    deal_built(&mut s, STATE_PRISON, 40, 40); // 4 x 4: 40..=43
    assert_eq!(s.ext_crime(40, 40, 0), 20);
    assert_eq!(s.ext_land_value(40, 40, 100), 70);
    assert_eq!(s.ext_crime(43 + 5, 40, 0), 20 * 6 / 11);
    assert_eq!(s.ext_land_value(43 + 5, 40, 100), 100 - 30 * 6 / 11);
    assert_eq!(s.ext_crime(43 + 11, 40, 0), 0);
    assert_eq!(s.ext_land_value(43 + 11, 40, 100), 100);
    assert_eq!(s.ext_pollution(40, 40, 7), 7);
}

#[test]
fn the_toxic_dump_pollutes_and_the_missile_base_lowers_the_land_value() {
    let mut s = bare();
    deal_built(&mut s, TOXIC_DUMP, 20, 20);
    deal_built(&mut s, MISSILE_BASE, 70, 70);
    assert_eq!(s.ext_pollution(20, 20, 5), 85);
    assert_eq!(s.ext_pollution(23 + 6, 20, 0), 80 * 7 / 13);
    assert_eq!(s.ext_pollution(23 + 13, 20, 0), 0);
    assert_eq!(s.ext_crime(20, 20, 3), 3);
    assert_eq!(s.ext_land_value(20, 20, 90), 90);
    assert_eq!(s.ext_land_value(70, 70, 100), 60);
    assert_eq!(s.ext_land_value(73 + 14, 70, 100), 100 - 40 / 15);
    assert_eq!(s.ext_land_value(73 + 15, 70, 100), 100);
    assert_eq!(s.ext_pollution(70, 70, 0), 0);
}

#[test]
fn the_drawbacks_add_up() {
    let mut s = bare();
    deal_built(&mut s, CASINO, 40, 40);
    deal_built(&mut s, STATE_PRISON, 50, 40);
    // the tile between them: 4 tiles from the casino (40..=42) and 4 from the prison (50..=53)
    assert_eq!(
        s.ext_crime(46, 41, 0),
        30 * (13 - 4) / 13 + 20 * (11 - 4) / 11
    );
}

/// The scans store the hooks' answers: the drawbacks reach the maps, only near their building.
#[test]
fn the_drawbacks_reach_the_scanned_maps_and_only_near_the_building() {
    let road = |s: &mut Simulation| {
        s.tool_drag(EditingTool::Road, 2, 45, 117, 45);
        assert_ne!(s.tile(60, 45).unwrap() & LOMASK, DIRT);
    };
    let mut plain = bare();
    let mut with_deals = bare();
    road(&mut plain);
    road(&mut with_deals);
    deal_built(&mut with_deals, CASINO, 40, 46);
    deal_built(&mut with_deals, TOXIC_DUMP, 80, 46);
    deal_built(&mut with_deals, MISSILE_BASE, 100, 46);
    for s in [&mut plain, &mut with_deals] {
        s.pollution_terrain_land_value_scan();
        s.crime_scan();
    }
    let crime = |s: &Simulation, x| s.crime_rate_map.world_get(x, 45);
    let air = |s: &Simulation, x| s.pollution_density_map.world_get(x, 45);
    let land = |s: &Simulation, x| s.land_value_map.world_get(x, 45);
    assert!(crime(&with_deals, 41) > crime(&plain, 41));
    assert!(air(&with_deals, 81) > air(&plain, 81));
    assert!(land(&with_deals, 101) < land(&plain, 101));
    for x in [4, 20, 60] {
        assert_eq!(crime(&with_deals, x), crime(&plain, x), "crime {x}");
        assert_eq!(air(&with_deals, x), air(&plain, x), "air {x}");
        assert_eq!(land(&with_deals, x), land(&plain, x), "land {x}");
    }
}

#[test]
fn turning_the_rule_off_pulls_the_buildings_down_and_forgets_everything() {
    let mut s = bare();
    people(&mut s, 60_000);
    s.city_yes = 100;
    year(&mut s);
    assert_eq!(s.place_structure(51, 10, 10), ToolResult::Ok);
    s.answer_offer(CASINO, true);
    assert_eq!(s.place_structure(CASINO, 30, 30), ToolResult::Ok);
    let funds = s.total_funds;
    s.set_reward_rules(false);
    assert_eq!(s.total_funds, funds, "no refund");
    assert!(s.structures().is_empty());
    assert!(s.extensions().reward_state.is_empty());
    assert!(!s.reward_rules());
    assert_eq!(s.ext_crime(31, 31, 4), 4);
    // on again: nothing is remembered, but the thresholds are checked at once
    people(&mut s, 0);
    s.set_reward_rules(true);
    assert!(!unlocked(&s, 51) && answer(&s, CASINO) == ANSWER_NONE);
}

#[test]
fn the_structure_list_cap_also_stops_the_rewards() {
    let mut s = bare();
    people(&mut s, 5_000);
    year(&mut s);
    for i in 0..MAX_STRUCTURES {
        let (x, y) = ((i % 100) as i32, (i / 100) as i32 * 2);
        assert_eq!(s.place_structure(2, x, y), ToolResult::Ok);
    }
    assert_eq!(s.place_structure(MAYOR_HOUSE, 5, 40), ToolResult::Failed);
}

#[test]
fn a_broken_building_is_dropped_and_stops_paying() {
    let mut s = bare();
    deal_built(&mut s, CASINO, 20, 20);
    s.set_tile(21, 21, DIRT); // bulldozed under the list's feet
    let funds = s.total_funds;
    year(&mut s);
    assert_eq!(s.total_funds, funds);
    assert!(s.structures().is_empty());
}

#[test]
fn the_rule_on_changes_nothing_of_the_classic_simulation() {
    for seed in [1, 2] {
        let build = |rewards: bool| {
            let mut s = Simulation::with_default_size();
            s.new_random_city(seed);
            starter(&mut s);
            s.set_structure_rules(true);
            s.set_reward_rules(rewards);
            s
        };
        let (mut off, mut on) = (build(false), build(true));
        run(&mut off, 2400);
        run(&mut on, 2400);
        // unlocks and proposals alone move no money and no tile
        assert_eq!(state(&off), state(&on), "seed {seed}");
        assert_eq!(off.crime_rate_map, on.crime_rate_map);
        assert_eq!(off.land_value_map, on.land_value_map);
        assert_eq!(off.pollution_density_map, on.pollution_density_map);
        assert_eq!(off.rng.random16(), on.rng.random16());
    }
}
