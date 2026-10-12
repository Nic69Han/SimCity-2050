//! Native tests of the wasm adapter's budget functions on the real engine.

use micropolis_wasm::City;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");

fn haight() -> City {
    let mut city = City::new(1);
    city.load_cty(HAIGHT).expect("haight.cty must load");
    city
}

#[test]
fn tax_is_range_checked() {
    let mut city = haight();
    assert!(city.set_tax(20));
    assert_eq!(city.tax(), 20);
    assert!(!city.set_tax(21));
    assert!(!city.set_tax(-1));
    assert_eq!(city.tax(), 20);
}

#[test]
fn budget_layout_has_18_fields_and_reflects_the_percents() {
    let mut city = haight();
    city.set_budget(40, 60, 100);
    let b = city.budget();
    assert_eq!(b.len(), 18);
    assert_eq!(b[0], city.tax());
    assert_eq!(&b[12..15], &[40, 60, 100]);
    // Percents above 100 are clamped by the core.
    city.set_budget(250, -3, 50);
    let b = city.budget();
    assert_eq!(&b[12..15], &[100, 0, 50]);
}

#[test]
fn evaluation_layout_has_15_fields() {
    let mut city = haight();
    for _ in 0..5 {
        city.tick();
    }
    let e = city.evaluation();
    assert_eq!(e.len(), 15);
    assert!((0..=1000).contains(&e[0]), "score {}", e[0]);
    assert!((0..=100).contains(&e[6]), "yes {}", e[6]);
    for slot in 0..4 {
        let kind = e[7 + 2 * slot];
        assert!((-1..7).contains(&kind));
        if kind == -1 {
            assert_eq!(e[8 + 2 * slot], 0);
        }
    }
}

#[test]
fn history_has_120_values_and_invalid_arguments_give_nothing() {
    let mut city = haight();
    for _ in 0..3 {
        city.tick();
    }
    assert_eq!(city.history(0, 0).len(), 120);
    assert_eq!(city.history(5, 1).len(), 120);
    assert!(city.history(6, 0).is_empty());
    assert!(city.history(0, 2).is_empty());
}
