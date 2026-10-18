//! Deals with the neighbours (docs/game-design-v02b.md): off, the engine is the one without
//! extensions; on, a city with a power plant signs an electricity deal and is paid the documented
//! income at the tax collection; losing the plant breaks the deal with the documented penalty;
//! the signed deals survive a save and a load.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::deals::{DealResult, MESSAGE_DEAL_BROKEN};
use micropolis_core::events::Event;
use micropolis_core::simulation::Simulation;
use micropolis_core::tool::EditingTool;
use support::{file_of, run, starter, state, HAIGHT};

fn haight() -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(HAIGHT, 1).expect("the sample city loads");
    s
}

fn generated(seed: i32) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.new_random_city(seed);
    starter(&mut s);
    s
}

/// Ticks until just after the next tax collection (`city_time` a multiple of 48 and past phase 9).
fn run_past_collection(s: &mut Simulation) {
    s.set_speed(3);
    s.set_passes(1);
    let start = s.city_time / 48;
    for _ in 0..2000 {
        s.sim_tick();
        if s.city_time / 48 > start && s.phase_cycle > 9 {
            return;
        }
    }
    panic!("no tax collection within 2000 ticks");
}

/// Haight settled for a while, so the power map is scanned.
fn settled() -> Simulation {
    let mut s = haight();
    s.set_enable_disasters(false);
    run(&mut s, 100);
    s
}

#[test]
fn rule_off_plays_out_like_before() {
    for seed in [1, 2] {
        let mut plain = generated(seed);
        let mut toggled = generated(seed);
        toggled.set_deals_rules(true);
        assert!(toggled.extensions_active());
        toggled.set_deals_rules(false);
        assert!(!toggled.extensions_active());
        run(&mut plain, 2000);
        run(&mut toggled, 2000);
        assert_eq!(state(&plain), state(&toggled), "seed {seed}");
        assert_eq!(plain.rng.random16(), toggled.rng.random16());
        assert_eq!(file_of(&plain), file_of(&toggled), "same bytes");
        assert_eq!(plain.save_cty(), toggled.save_cty());
    }
}

#[test]
fn rule_on_without_a_deal_changes_nothing_but_the_flag() {
    let mut plain = settled();
    let mut on = settled();
    on.set_deals_rules(true);
    run(&mut plain, 1600);
    run(&mut on, 1600);
    assert_eq!(state(&plain), state(&on));
    assert_eq!(plain.rng.random16(), on.rng.random16());
    assert_eq!(plain.save_cty(), on.save_cty());
    assert!(on
        .drain_events()
        .iter()
        .all(|e| !matches!(e, Event::Message { number, .. } if *number == MESSAGE_DEAL_BROKEN)));
}

#[test]
fn a_deal_pays_its_yearly_income_at_the_collection() {
    let mut twin = settled();
    let mut s = settled();
    s.set_deals_rules(true);
    let surplus = s.deal_surplus()[0];
    assert!(surplus >= 100, "haight has power to spare: {surplus}");
    let offer = s.deal_offer(0).expect("offer 0");
    assert_eq!(s.accept_deal(0), DealResult::Done);
    let income = i64::from(offer.yearly_income());
    assert!(income > 0);
    run_past_collection(&mut twin);
    run_past_collection(&mut s);
    assert_eq!(s.city_time, twin.city_time);
    assert_eq!(s.total_funds - twin.total_funds, income, "paid once");
    assert_eq!(s.deals().len(), 1, "still signed");
    // Everything else is the same city.
    assert_eq!(s.tiles, twin.tiles);
    assert_eq!(s.rng.random16(), twin.rng.random16());
    // A second year pays again.
    let f = s.total_funds - twin.total_funds;
    run_past_collection(&mut twin);
    run_past_collection(&mut s);
    assert_eq!(s.total_funds - twin.total_funds, f + income);
}

#[test]
fn losing_the_plants_breaks_the_deal_with_the_penalty() {
    let mut twin = settled();
    let mut s = settled();
    s.set_deals_rules(true);
    let offer = s.deal_offer(0).unwrap();
    assert_eq!(s.accept_deal(0), DealResult::Done);
    // Every power plant is bulldozed in both cities (the twin has no deal).
    let (w, h) = s.world_size();
    for city in [&mut s, &mut twin] {
        city.total_funds = 10_000_000;
        for x in 0..w {
            for y in 0..h {
                let t = city.tile(x, y).unwrap();
                if t & micropolis_core::tile::ZONEBIT != 0
                    && matches!(
                        t & micropolis_core::tile::LOMASK,
                        micropolis_core::tile_chars::POWERPLANT
                            | micropolis_core::tile_chars::NUCLEAR
                    )
                {
                    city.tool_down(EditingTool::Bulldozer, x, y);
                }
            }
        }
    }
    assert_eq!(s.power_capacity(), 0, "no plant left");
    assert!(s.deal_surplus()[0] < 0);
    s.drain_events();
    run_past_collection(&mut twin);
    run_past_collection(&mut s);
    assert_eq!(
        twin.total_funds - s.total_funds,
        i64::from(offer.yearly_income()),
        "100 % of one year"
    );
    assert!(s.deals().is_empty(), "the deal is gone");
    let broken = s
        .drain_events()
        .into_iter()
        .filter(|e| matches!(e, Event::Message { number, .. } if *number == MESSAGE_DEAL_BROKEN))
        .count();
    assert_eq!(broken, 1);
}

#[test]
fn deals_survive_a_save_and_files_without_deals_are_unchanged() {
    let plain = settled();
    let mut s = settled();
    assert_eq!(file_of(&plain), file_of(&s));
    s.set_deals_rules(true);
    s.accept_deal(0);
    s.accept_deal(2);
    let file = file_of(&s);
    assert_ne!(file, file_of(&plain));
    let mut back = Simulation::with_default_size();
    back.load_city(&file, 1).expect("loads");
    assert!(back.deals_rules());
    assert_eq!(back.deals(), s.deals());
    // Loading a city without deals drops them.
    back.load_city(&file_of(&plain), 1).unwrap();
    assert!(back.deals().is_empty());
    // Rule on, no deal: only the flag is added; the same city saved with the rule off is the old file.
    let mut flag = settled();
    flag.set_deals_rules(true);
    assert_ne!(file_of(&flag), file_of(&plain));
    flag.set_deals_rules(false);
    assert_eq!(file_of(&flag), file_of(&plain));
}

#[test]
fn a_new_city_starts_without_deals() {
    let mut s = settled();
    s.set_deals_rules(true);
    s.accept_deal(0);
    s.new_random_city(5);
    assert!(s.deals().is_empty());
    assert!(
        !s.deals_rules(),
        "a new city is a fresh engine: every rule off"
    );
}
