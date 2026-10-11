//! Golden test for `budget.rs`, against the ORIGINAL `doBudgetNow` run by
//! `reference/gold/budget_cases.cpp` (expected output in
//! `tests/data/budget_gold.txt`).
//!
//! The allocation is compared through the pure helper `allocate_funding`, and
//! the auto-budget decision through `budget_path`: the C++ run reports whether
//! auto budget survived (`A 1`) or was switched off (`A 0`). `doBudgetNow`
//! itself is not run here because it calls the integration shims.

use micropolis_core::budget::{allocate_funding, budget_path, BudgetPath, MESSAGE_NO_MONEY};
use micropolis_core::simulation::Simulation;

const GOLD: &str = include_str!("data/budget_gold.txt");

struct Gen(u64);

impl Gen {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }

    fn pick(&mut self, lo: i64, hi: i64) -> i64 {
        lo + (self.next() % ((hi - lo + 1) as u64)) as i64
    }
}

/// Expected lines in order: a `B` line then an `A` line per case, then `I`
/// and `M` (the message number, checked against `text.h`).
#[test]
fn budget_matches_original_cpp() {
    let mut g = Gen(777_001);
    let mut lines = GOLD.lines();
    let cases = 300;
    for i in 0..cases {
        let fire = g.pick(0, if i % 8 == 7 { 3_000_000 } else { 3000 });
        let police = g.pick(0, if i % 8 == 7 { 3_000_000 } else { 3000 });
        let road = g.pick(0, if i % 8 == 7 { 3_000_000 } else { 3000 });
        let tax = g.pick(0, if i % 5 == 4 { 300_000 } else { 5000 });
        let total = if i % 6 == 5 {
            g.pick(0, 300_000)
        } else {
            g.pick(-3000, 5000)
        };
        let mut fp = g.pick(0, 1000) as f32 / 1000.0;
        let mut pp = g.pick(0, 1000) as f32 / 1000.0;
        let mut rp = g.pick(0, 1000) as f32 / 1000.0;
        if i % 9 == 8 {
            fp = 1.0;
            pp = 1.0;
            rp = 1.0;
        }
        if i % 11 == 10 {
            fp = 0.0;
        }

        let a = allocate_funding(fire, fp, police, pp, road, rp, tax, total);

        // (a) allocation from the menu
        let want = lines.next().expect("missing B line");
        let got = format!(
            "B {} {} {} {} {} {}",
            a.fire_value,
            a.police_value,
            a.road_value,
            a.fire_percent.to_bits(),
            a.police_percent.to_bits(),
            a.road_percent.to_bits()
        );
        assert_eq!(got, want, "case {i}: allocation (fire {fire} police {police} road {road} tax {tax} total {total} pct {fp} {pp} {rp})");

        // (b) does auto budget survive?
        let want = lines.next().expect("missing A line");
        let path = budget_path(true, false, a.yum_ducks, a.total);
        let survived = path != BudgetPath::AutoBroke;
        assert_eq!(
            format!("A {}", survived as i32),
            want,
            "case {i}: auto budget decision"
        );
    }

    let want = lines.next().expect("missing I line");
    let mut s = Simulation::new(120, 100);
    s.fire_percent = 0.3;
    s.police_percent = 0.2;
    s.road_percent = 0.1;
    s.fire_value = 5;
    s.police_value = 6;
    s.road_value = 7;
    s.must_draw_budget = false;
    s.init_funding_level();
    let got = format!(
        "I {} {} {} {} {} {} {}",
        s.fire_percent.to_bits(),
        s.police_percent.to_bits(),
        s.road_percent.to_bits(),
        s.fire_value,
        s.police_value,
        s.road_value,
        s.must_draw_budget as i32
    );
    assert_eq!(got, want);

    let want = lines.next().expect("missing M line");
    assert_eq!(format!("M {}", MESSAGE_NO_MONEY), want, "MESSAGE_NO_MONEY");
    assert!(lines.next().is_none(), "unexpected extra golden lines");
}
