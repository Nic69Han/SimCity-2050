//! Full `sim_tick()` against the original engine's fingerprints.
//!
//! The expected lines are the first 20 lines of
//! `reference/gold/simulate_oracle_haight_seed1.txt`, which is the output of
//! `reference/build/oracle assets/cities/haight.cty 1 25` (the original C++
//! engine, `MICROPOLIS_SEED=1`, disasters off, speed 3, one pass per tick).
//!
//! This test is `#[ignore]`d: a city tick runs the power, scan, zone, traffic,
//! sprite, budget and evaluation modules, which are shims until integration.
//! Run it with `cargo test -p micropolis-core --test simulate_tick -- --ignored`
//! once they are merged.

use micropolis_core::simulation::Simulation;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");

const ORACLE: &str = r#"
tick 0 time=4839 funds=1000000 pop=1 res=5977 com=324 ind=268 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=0 maphash=fe0db2d7821668ed
tick 1 time=4840 funds=1000000 pop=1 res=0 com=0 ind=0 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fe0db2d7821668ed
tick 2 time=4840 funds=1000000 pop=1 res=564 com=21 ind=44 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=72c48d59aa0a4edd
tick 3 time=4840 funds=1000000 pop=1 res=1113 com=79 ind=76 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=dc3bcbad01109e3c
tick 4 time=4840 funds=1000000 pop=1 res=2412 com=135 ind=96 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=a3438679af292e72
tick 5 time=4840 funds=1000000 pop=1 res=3790 com=210 ind=100 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=002ac87b6cc39f43
tick 6 time=4840 funds=1000000 pop=1 res=4952 com=263 ind=116 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=9c4681b7efbbef42
tick 7 time=4840 funds=1000000 pop=1 res=5495 com=280 ind=176 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=cb5097ad6c6708fd
tick 8 time=4840 funds=1000000 pop=1 res=5709 com=300 ind=208 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=6c0ed1f63f094d30
tick 9 time=4840 funds=1000000 pop=1 res=5941 com=324 ind=268 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fde7a6101e1816c0
tick 10 time=4840 funds=1000000 pop=1 res=5941 com=324 ind=268 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fde7a6101e1816c0
tick 11 time=4840 funds=1000000 pop=1 res=5941 com=324 ind=268 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fde7a6101e1816c0
tick 12 time=4840 funds=1000000 pop=1 res=5941 com=324 ind=268 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fde7a6101e1816c0
tick 13 time=4840 funds=1000000 pop=1 res=5941 com=324 ind=268 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fde7a6101e1816c0
tick 14 time=4840 funds=1000000 pop=1 res=5941 com=324 ind=268 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fde7a6101e1816c0
tick 15 time=4840 funds=1000000 pop=1 res=5941 com=324 ind=268 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fde7a6101e1816c0
tick 16 time=4840 funds=1000000 pop=1 res=5941 com=324 ind=268 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fde7a6101e1816c0
tick 17 time=4841 funds=1000000 pop=1334 res=0 com=0 ind=0 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=fde7a6101e1816c0
tick 18 time=4841 funds=1000000 pop=1334 res=564 com=21 ind=44 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=97aee61abc2237bc
tick 19 time=4841 funds=1000000 pop=1334 res=1112 com=79 ind=76 resV=2000 comV=1500 indV=1500 crime=12 poll=49 lv=14 traf=24 maphash=4a9e5132d5014a59
"#;

/// Same format as the `printf` in `reference/oracle.cpp`.
fn fingerprint(s: &Simulation, tick: usize) -> String {
    // FNV over the tile words, identical to `fnv()` in reference/oracle.cpp.
    let mut h: u64 = 1_469_598_103_934_665_603;
    for &w in &s.tiles {
        h ^= (w & 0xff) as u64;
        h = h.wrapping_mul(1_099_511_628_211);
        h ^= (w >> 8) as u64;
        h = h.wrapping_mul(1_099_511_628_211);
    }
    format!(
        "tick {tick} time={} funds={} pop={} res={} com={} ind={} resV={} comV={} indV={} \
         crime={} poll={} lv={} traf={} maphash={h:016x}",
        s.city_time,
        s.total_funds,
        s.total_pop,
        s.res_pop,
        s.com_pop,
        s.ind_pop,
        s.res_valve,
        s.com_valve,
        s.ind_valve,
        s.crime_average,
        s.pollution_average,
        s.land_value_average,
        s.traffic_average,
    )
}

#[test]
fn sim_tick_matches_original_haight_seed_1() {
    let mut s = Simulation::with_default_size();
    s.rng.seed(1); // MICROPOLIS_SEED=1 of the oracle
    s.load_cty(HAIGHT).expect("haight.cty loads");
    s.enable_disasters = false;
    s.sim_speed = 3;
    s.sim_passes = 1;

    for (tick, want) in ORACLE
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .enumerate()
    {
        if tick > 0 {
            s.sim_tick();
        }
        assert_eq!(fingerprint(&s, tick), want, "tick {tick}");
    }
}
