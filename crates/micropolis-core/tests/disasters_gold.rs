//! Golden tests for `disasters.cpp`.
//!
//! The expected values come from the ORIGINAL C++ engine, produced by
//! `reference/gold/disasters_gold.cpp` on `assets/cities/haight.cty` (see the
//! comments there). The data below is the harness output; regenerate it
//! with the harness rather than editing it by hand.
//!
//! Each step checks the full tile-map hash plus `floodCount`, `disasterWait`
//! and `disasterEvent` (as its integer value).

use micropolis_core::position::Position;
use micropolis_core::simulation::Simulation;
use micropolis_core::tile::ZONEBIT;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");

/// FNV-style hash of the tile map, column-major, as in the C++ harness.
fn map_hash(sim: &Simulation) -> u64 {
    let mut h: u64 = 1469598103934665603;
    let (w, hh) = sim.world_size();
    for x in 0..w {
        for y in 0..hh {
            let v = sim.tile(x, y).unwrap();
            h ^= u64::from(v & 0xff);
            h = h.wrapping_mul(1099511628211);
            h ^= u64::from(v >> 8);
            h = h.wrapping_mul(1099511628211);
        }
    }
    h
}

/// Starts from the tile section of the .cty file, as `loadFile` reads it.
/// `doSimInit` is not run: it changes power and status bits, which belong to
/// other modules. The disaster functions only use the file's tile bits.
fn load_raw_tiles(sim: &mut Simulation) {
    assert_eq!(HAIGHT.len(), 27_120);
    let t = &HAIGHT[3120..];
    for i in 0..12_000 {
        sim.tiles[i] = u16::from_be_bytes([t[2 * i], t[2 * i + 1]]);
    }
}

/// Same setup as the C++ harness: raw city, disasters off, seed the RNG.
fn load(seed: i32) -> Simulation {
    let mut sim = Simulation::with_default_size();
    load_raw_tiles(&mut sim);
    sim.enable_disasters = false;
    sim.rng.seed(seed);
    sim
}

fn check(sim: &Simulation, step: usize, expected: (u64, i32, i32, i32)) {
    let (h, flood, wait, event) = expected;
    assert_eq!(map_hash(sim), h, "step {step}: map hash");
    assert_eq!(
        i32::from(sim.flood_count),
        flood,
        "step {step}: flood_count"
    );
    assert_eq!(
        i32::from(sim.disaster_wait),
        wait,
        "step {step}: disaster_wait"
    );
    assert_eq!(
        sim.disaster_event as i32, event,
        "step {step}: disaster_event"
    );
}

#[test]
fn set_fire_matches_original_engine() {
    let mut sim = load(777);
    for (i, &e) in SET_FIRE.iter().enumerate() {
        sim.set_fire();
        check(&sim, i, e);
    }
}

#[test]
fn make_fire_matches_original_engine() {
    let mut sim = load(778);
    for (i, &e) in MAKE_FIRE.iter().enumerate() {
        sim.make_fire();
        check(&sim, i, e);
    }
}

#[test]
fn make_flood_matches_original_engine() {
    let mut sim = load(779);
    for (i, &e) in MAKE_FLOOD.iter().enumerate() {
        sim.make_flood();
        check(&sim, i, e);
    }
}

#[test]
fn make_flood_with_river_matches_original_engine() {
    let mut sim = load(785);
    // Same river row as the harness: river-edge tiles (value 10) across y = 50.
    for x in 0..120 {
        sim.set_tile(x, 50, 10);
    }
    for (i, &e) in MAKE_FLOOD_RIVER.iter().enumerate() {
        sim.make_flood();
        check(&sim, i, e);
    }
}

#[test]
fn make_earthquake_matches_original_engine() {
    let mut sim = load(780);
    for (i, &e) in MAKE_EARTHQUAKE.iter().enumerate() {
        sim.make_earthquake();
        check(&sim, i, e);
    }
}

/// Needs `Simulation::do_meltdown` (simulate.cpp), which is not ported yet.
#[test]
#[ignore = "needs do_meltdown from the simulate module (haight has nuclear tiles)"]
fn make_meltdown_matches_original_engine() {
    let mut sim = load(781);
    sim.make_meltdown();
    check(&sim, 0, MAKE_MELTDOWN[0]);
}

#[test]
fn do_flood_matches_original_engine() {
    let mut sim = load(782);
    // No zone centres, so fire_zone is never called (see the harness).
    for x in 0..120 {
        for y in 0..100 {
            let t = sim.tile(x, y).unwrap();
            sim.set_tile(x, y, t & !ZONEBIT);
        }
    }
    sim.flood_count = 0;
    for (i, &e) in DO_FLOOD.iter().enumerate() {
        if i % 70 == 0 {
            sim.flood_count = 30;
        }
        let p = Position::new(((i * 37) % 120) as i32, ((i * 53) % 100) as i32);
        sim.do_flood(p);
        check(&sim, i, e);
    }
}

#[test]
fn scenario_rio_flooding_matches_original_engine() {
    let mut sim = load(783);
    sim.disaster_event = micropolis_core::simulation::Scenario::Rio;
    sim.disaster_wait = 50;
    sim.flood_count = 3;
    for (i, &e) in DO_DISASTERS_RIO.iter().enumerate() {
        sim.do_disasters();
        check(&sim, i, e);
    }
}

#[test]
fn scenario_san_francisco_earthquake_matches_original_engine() {
    let mut sim = load(784);
    sim.disaster_event = micropolis_core::simulation::Scenario::SanFrancisco;
    sim.disaster_wait = 1;
    for (i, &e) in DO_DISASTERS_SF.iter().enumerate() {
        sim.do_disasters();
        check(&sim, i, e);
    }
}

/// Every tile value 0..65536: `vulnerable` and `road_test` (traffic.cpp).
#[test]
fn tables_match_original_engine() {
    let sim = Simulation::with_default_size();
    let (mut hv, mut hr): (u64, u64) = (1469598103934665603, 1469598103934665603);
    let (mut nv, mut nr) = (0, 0);
    for v in 0..65536i32 {
        let a = sim.vulnerable(v);
        let b = sim.road_test(v as u16);
        nv += i32::from(a);
        nr += i32::from(b);
        hv ^= u64::from(a);
        hv = hv.wrapping_mul(1099511628211);
        hr ^= u64::from(b);
        hr = hr.wrapping_mul(1099511628211);
    }
    assert_eq!((hv, nv), VULNERABLE_HASH);
    assert_eq!((hr, nr), ROAD_TEST_HASH);
}

// map hash after load = 0x127c3c57b6ba3a57ULL
pub const SET_FIRE: &[(u64, i32, i32, i32)] = &[
    (0x029d9c1f7ea450bcu64, 0, 0, 0),
    (0x029d9c1f7ea450bcu64, 0, 0, 0),
    (0x029d9c1f7ea450bcu64, 0, 0, 0),
    (0x029d9c1f7ea450bcu64, 0, 0, 0),
    (0xbbc7c61569872819u64, 0, 0, 0),
    (0xbbc7c61569872819u64, 0, 0, 0),
    (0x95aaf4415e1fea90u64, 0, 0, 0),
    (0x95aaf4415e1fea90u64, 0, 0, 0),
    (0x95aaf4415e1fea90u64, 0, 0, 0),
    (0x95aaf4415e1fea90u64, 0, 0, 0),
    (0x95aaf4415e1fea90u64, 0, 0, 0),
    (0x95aaf4415e1fea90u64, 0, 0, 0),
    (0x47414e3650c32aecu64, 0, 0, 0),
    (0x47414e3650c32aecu64, 0, 0, 0),
    (0x796abf7b5d039e66u64, 0, 0, 0),
    (0x796abf7b5d039e66u64, 0, 0, 0),
    (0x796abf7b5d039e66u64, 0, 0, 0),
    (0x5ee803d6b742e3d2u64, 0, 0, 0),
    (0x5ee803d6b742e3d2u64, 0, 0, 0),
    (0x5ee803d6b742e3d2u64, 0, 0, 0),
    (0x5ee803d6b742e3d2u64, 0, 0, 0),
    (0x5ee803d6b742e3d2u64, 0, 0, 0),
    (0x5ee803d6b742e3d2u64, 0, 0, 0),
    (0x5ee803d6b742e3d2u64, 0, 0, 0),
    (0x1857aed93819723cu64, 0, 0, 0),
    (0x1857aed93819723cu64, 0, 0, 0),
    (0x1857aed93819723cu64, 0, 0, 0),
    (0x1857aed93819723cu64, 0, 0, 0),
    (0x1857aed93819723cu64, 0, 0, 0),
    (0x1857aed93819723cu64, 0, 0, 0),
    (0x1857aed93819723cu64, 0, 0, 0),
    (0x1857aed93819723cu64, 0, 0, 0),
    (0x1857aed93819723cu64, 0, 0, 0),
    (0xc206b2da1daef606u64, 0, 0, 0),
    (0xc206b2da1daef606u64, 0, 0, 0),
    (0x8c45de2b7b017ea0u64, 0, 0, 0),
    (0x8c45de2b7b017ea0u64, 0, 0, 0),
    (0x8c45de2b7b017ea0u64, 0, 0, 0),
    (0x8c45de2b7b017ea0u64, 0, 0, 0),
    (0x8c45de2b7b017ea0u64, 0, 0, 0),
    (0xcb6dd0db1aa99975u64, 0, 0, 0),
    (0xcb6dd0db1aa99975u64, 0, 0, 0),
    (0x1030448b1a73182bu64, 0, 0, 0),
    (0x6c9f41ba091bf6d3u64, 0, 0, 0),
    (0x6c9f41ba091bf6d3u64, 0, 0, 0),
    (0x6c9f41ba091bf6d3u64, 0, 0, 0),
    (0x6c9f41ba091bf6d3u64, 0, 0, 0),
    (0x6c9f41ba091bf6d3u64, 0, 0, 0),
    (0x6c9f41ba091bf6d3u64, 0, 0, 0),
    (0x6c9f41ba091bf6d3u64, 0, 0, 0),
    (0x6c9f41ba091bf6d3u64, 0, 0, 0),
    (0x747e2d06a392fe5au64, 0, 0, 0),
    (0x747e2d06a392fe5au64, 0, 0, 0),
    (0x747e2d06a392fe5au64, 0, 0, 0),
    (0x91e3036c2a2c8ac7u64, 0, 0, 0),
    (0x91e3036c2a2c8ac7u64, 0, 0, 0),
    (0x91e3036c2a2c8ac7u64, 0, 0, 0),
    (0x91e3036c2a2c8ac7u64, 0, 0, 0),
    (0x0066883cbec7eea4u64, 0, 0, 0),
    (0xad0aa014a20469ceu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xee23fb4927e454efu64, 0, 0, 0),
    (0xf6f5ac672b56c5a9u64, 0, 0, 0),
    (0xf6f5ac672b56c5a9u64, 0, 0, 0),
    (0xf6f5ac672b56c5a9u64, 0, 0, 0),
    (0xba9b2c8bca4c3205u64, 0, 0, 0),
    (0x7ad9fc30945bbe3eu64, 0, 0, 0),
    (0x7ad9fc30945bbe3eu64, 0, 0, 0),
    (0x525281f10bb92c92u64, 0, 0, 0),
    (0x525281f10bb92c92u64, 0, 0, 0),
    (0x525281f10bb92c92u64, 0, 0, 0),
    (0x1f9a6993d5f7173bu64, 0, 0, 0),
];
pub const MAKE_FIRE: &[(u64, i32, i32, i32)] = &[
    (0x5037a06aee61a6e0u64, 0, 0, 0),
    (0x164011eca0862913u64, 0, 0, 0),
    (0xdf520b10f8188522u64, 0, 0, 0),
    (0x7a4e4203c4e49327u64, 0, 0, 0),
    (0x9907563076c3e912u64, 0, 0, 0),
    (0x7fa7975de55b37c3u64, 0, 0, 0),
    (0xc0700ebc43f281e9u64, 0, 0, 0),
    (0x47a5ca52bb12964du64, 0, 0, 0),
    (0x20f3c7c07f340b57u64, 0, 0, 0),
    (0xd46c98dd0d190102u64, 0, 0, 0),
    (0x23f5df70b5e1d2c1u64, 0, 0, 0),
    (0x29cee32187cb68cau64, 0, 0, 0),
    (0xe245a7e8004077a9u64, 0, 0, 0),
    (0xf9c4bbcdc404282au64, 0, 0, 0),
    (0xb923691d5c007ba9u64, 0, 0, 0),
    (0xd0645201fb440270u64, 0, 0, 0),
    (0x90a0955410ce9df6u64, 0, 0, 0),
    (0xb4e762c1592df5d3u64, 0, 0, 0),
    (0x83c3723e1986d65cu64, 0, 0, 0),
    (0xe33730a2beeb80abu64, 0, 0, 0),
    (0x560bea5d28df3702u64, 0, 0, 0),
    (0xf8916c2a99d8ca9au64, 0, 0, 0),
    (0xb3ea44403b4e3a6au64, 0, 0, 0),
    (0x5cb5a8cb1f2be266u64, 0, 0, 0),
    (0x8f2526eb3923b05fu64, 0, 0, 0),
    (0xd304e56a9157651eu64, 0, 0, 0),
    (0x1ee73507655b9bfdu64, 0, 0, 0),
    (0x75854b362f9e5eedu64, 0, 0, 0),
    (0x5894e398b5a67af3u64, 0, 0, 0),
    (0xfc1d5beca284ef5du64, 0, 0, 0),
    (0x638cb3042c7ee57fu64, 0, 0, 0),
    (0xf603dcbae9d4f0feu64, 0, 0, 0),
    (0x254a1ddd5813d96du64, 0, 0, 0),
    (0xa2891fd654dc024bu64, 0, 0, 0),
    (0x65627eb59c2c1fceu64, 0, 0, 0),
    (0xe2928cd6b39617e6u64, 0, 0, 0),
    (0x2c93afa9e5142669u64, 0, 0, 0),
    (0x5284ad27615415ddu64, 0, 0, 0),
    (0xb9193cc35b5c4a15u64, 0, 0, 0),
    (0xe31509ab4d4b99bcu64, 0, 0, 0),
    (0xf2c5537668890995u64, 0, 0, 0),
    (0xbb493b4417f8a0bbu64, 0, 0, 0),
    (0x13d6a30b7eb117eeu64, 0, 0, 0),
    (0xd8cc23b666e8b4deu64, 0, 0, 0),
    (0x160c804780113f00u64, 0, 0, 0),
    (0x955d4b383ce027b1u64, 0, 0, 0),
    (0xb097f571fd84baaeu64, 0, 0, 0),
    (0xead50885fafe4166u64, 0, 0, 0),
    (0x99a75afdcb8b673au64, 0, 0, 0),
    (0x3221def10340f92eu64, 0, 0, 0),
    (0xc25203e304bbcc6cu64, 0, 0, 0),
    (0x691fb866e9bd4c61u64, 0, 0, 0),
    (0x3c697822b2aa7480u64, 0, 0, 0),
    (0x1c2957a27d01a7a0u64, 0, 0, 0),
    (0xb087393fc3dc56afu64, 0, 0, 0),
    (0xa08ba9297897ecbcu64, 0, 0, 0),
    (0xa30b68c33b1fd40au64, 0, 0, 0),
    (0xc52ba32130fd7df9u64, 0, 0, 0),
    (0x91598c351146f017u64, 0, 0, 0),
    (0xc2148f336a628b2du64, 0, 0, 0),
];
pub const MAKE_FLOOD: &[(u64, i32, i32, i32)] = &[
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
];
pub const MAKE_FLOOD_RIVER: &[(u64, i32, i32, i32)] = &[
    (0x455d3e81df5e4e9fu64, 30, 0, 0),
    (0xb01efb728f6f596bu64, 30, 0, 0),
    (0xa7aaaa0c1254a792u64, 30, 0, 0),
    (0x0b6aae45cfd48da0u64, 30, 0, 0),
    (0x4801f361573da0eeu64, 30, 0, 0),
    (0x19e1292fa53af94cu64, 30, 0, 0),
    (0xc2233fc07084a709u64, 30, 0, 0),
    (0x5d8a7000f8e61c63u64, 30, 0, 0),
    (0xfda85ef7e78afffdu64, 30, 0, 0),
    (0x010e42924ffff48bu64, 30, 0, 0),
    (0x37b3b01c73c86989u64, 30, 0, 0),
    (0xe27f0b63f60b4a3bu64, 30, 0, 0),
    (0xaba48728f6ca6ef1u64, 30, 0, 0),
    (0x259259c097d40b5bu64, 30, 0, 0),
    (0xef045ade834f6715u64, 30, 0, 0),
    (0x5bf7b66616c5141bu64, 30, 0, 0),
    (0x43bde833ac034e05u64, 30, 0, 0),
    (0xc0f03f8b42fff907u64, 30, 0, 0),
    (0x5536960e7ecb1fc2u64, 30, 0, 0),
    (0xb6d70bcb00c8e7d0u64, 30, 0, 0),
    (0xb6d70bcb00c8e7d0u64, 30, 0, 0),
    (0x074cbd7688689101u64, 30, 0, 0),
    (0x5e1bcec73361ed67u64, 30, 0, 0),
    (0x2ab3103b40f5a949u64, 30, 0, 0),
    (0x2ab3103b40f5a949u64, 30, 0, 0),
    (0xe7aefcfd5113611fu64, 30, 0, 0),
    (0xb22d75e699a2db1eu64, 30, 0, 0),
    (0x61526a4ab4fef0ecu64, 30, 0, 0),
    (0x1f7dfc1f66f017cdu64, 30, 0, 0),
    (0x97ea5e5065616c60u64, 30, 0, 0),
    (0xf52f30a622961831u64, 30, 0, 0),
    (0x42cbbb9a0735d24fu64, 30, 0, 0),
    (0x640a2b7bf6b29f89u64, 30, 0, 0),
    (0x799f55447185f7e7u64, 30, 0, 0),
    (0xfadb651c0c3bbfddu64, 30, 0, 0),
    (0x77de12a1da24da9fu64, 30, 0, 0),
    (0x57e1788e06d1efb9u64, 30, 0, 0),
    (0xdddb9f3940f292f2u64, 30, 0, 0),
    (0x5dd5fa42363a2342u64, 30, 0, 0),
    (0x1e8eb4259b052b9cu64, 30, 0, 0),
];
pub const MAKE_EARTHQUAKE: &[(u64, i32, i32, i32)] = &[
    (0xc61c5563aa94288eu64, 0, 0, 0),
    (0xf7154a25a2475ca4u64, 0, 0, 0),
    (0x732433604c9d52f8u64, 0, 0, 0),
    (0xa7806a8e4ad9db0du64, 0, 0, 0),
    (0xcb23eab422a6cc5fu64, 0, 0, 0),
    (0x97a95b34e7d259edu64, 0, 0, 0),
];
// nuclear tiles in haight = 6 (makeMeltdown is a no-op only if 0)
pub const MAKE_MELTDOWN: &[(u64, i32, i32, i32)] = &[(0x080e2e08e79d9352u64, 0, 0, 0)];
pub const DO_FLOOD: &[(u64, i32, i32, i32)] = &[
    (0xbcf275ebc10ded2au64, 30, 0, 0),
    (0xbcf275ebc10ded2au64, 30, 0, 0),
    (0xbcf275ebc10ded2au64, 30, 0, 0),
    (0xbcf275ebc10ded2au64, 30, 0, 0),
    (0xbcf275ebc10ded2au64, 30, 0, 0),
    (0x54629d4082f79998u64, 30, 0, 0),
    (0x54629d4082f79998u64, 30, 0, 0),
    (0x393c0481422a3ccfu64, 30, 0, 0),
    (0x393c0481422a3ccfu64, 30, 0, 0),
    (0x393c0481422a3ccfu64, 30, 0, 0),
    (0x393c0481422a3ccfu64, 30, 0, 0),
    (0x393c0481422a3ccfu64, 30, 0, 0),
    (0x393c0481422a3ccfu64, 30, 0, 0),
    (0x393c0481422a3ccfu64, 30, 0, 0),
    (0x393c0481422a3ccfu64, 30, 0, 0),
    (0x393c0481422a3ccfu64, 30, 0, 0),
    (0xe5e13f73bf0b31d9u64, 30, 0, 0),
    (0xe5e13f73bf0b31d9u64, 30, 0, 0),
    (0x50e280dec71b2c55u64, 30, 0, 0),
    (0x50e280dec71b2c55u64, 30, 0, 0),
    (0x50e280dec71b2c55u64, 30, 0, 0),
    (0x50e280dec71b2c55u64, 30, 0, 0),
    (0xbe86a17e690116e2u64, 30, 0, 0),
    (0x257408badc28bef3u64, 30, 0, 0),
    (0xa14d8d961032cce5u64, 30, 0, 0),
    (0xb3afd80112eea4adu64, 30, 0, 0),
    (0xfa48377d319cfa85u64, 30, 0, 0),
    (0x79c2995fca16ec8au64, 30, 0, 0),
    (0x17194d55e42a4a16u64, 30, 0, 0),
    (0x7fc102b588206cc1u64, 30, 0, 0),
    (0x7fc102b588206cc1u64, 30, 0, 0),
    (0x7fc102b588206cc1u64, 30, 0, 0),
    (0x4e0b178117c5d022u64, 30, 0, 0),
    (0x4e0b178117c5d022u64, 30, 0, 0),
    (0x4e0b178117c5d022u64, 30, 0, 0),
    (0x4e0b178117c5d022u64, 30, 0, 0),
    (0xba8b30465294aa75u64, 30, 0, 0),
    (0xba8b30465294aa75u64, 30, 0, 0),
    (0xba8b30465294aa75u64, 30, 0, 0),
    (0xba8b30465294aa75u64, 30, 0, 0),
    (0xba8b30465294aa75u64, 30, 0, 0),
    (0xba8b30465294aa75u64, 30, 0, 0),
    (0xba8b30465294aa75u64, 30, 0, 0),
    (0xba8b30465294aa75u64, 30, 0, 0),
    (0x4738e49db6295f9au64, 30, 0, 0),
    (0x88b2acf5f7789e28u64, 30, 0, 0),
    (0x88b2acf5f7789e28u64, 30, 0, 0),
    (0x88b2acf5f7789e28u64, 30, 0, 0),
    (0x6a68eab60d084e24u64, 30, 0, 0),
    (0x645110de77a8f2b8u64, 30, 0, 0),
    (0x7a948bc3dae1f6aeu64, 30, 0, 0),
    (0x8cea0207999621e9u64, 30, 0, 0),
    (0x8cea0207999621e9u64, 30, 0, 0),
    (0x8cea0207999621e9u64, 30, 0, 0),
    (0x8cea0207999621e9u64, 30, 0, 0),
    (0x8cea0207999621e9u64, 30, 0, 0),
    (0x8cea0207999621e9u64, 30, 0, 0),
    (0x747f67eb5e5a9167u64, 30, 0, 0),
    (0xb4b7c88a4347b072u64, 30, 0, 0),
    (0x155fc2c2eaf22ce1u64, 30, 0, 0),
    (0x155fc2c2eaf22ce1u64, 30, 0, 0),
    (0xc9aaf5462f8f85d9u64, 30, 0, 0),
    (0xc9aaf5462f8f85d9u64, 30, 0, 0),
    (0xc9aaf5462f8f85d9u64, 30, 0, 0),
    (0xc9aaf5462f8f85d9u64, 30, 0, 0),
    (0xeedc5c19318ae9beu64, 30, 0, 0),
    (0xeedc5c19318ae9beu64, 30, 0, 0),
    (0xd087950876049a8bu64, 30, 0, 0),
    (0xd087950876049a8bu64, 30, 0, 0),
    (0xe9d8ddab1cece57du64, 30, 0, 0),
    (0xe9d8ddab1cece57du64, 30, 0, 0),
    (0xb29ba57f2bde220eu64, 30, 0, 0),
    (0x7d472adc65c36dd2u64, 30, 0, 0),
    (0x7d472adc65c36dd2u64, 30, 0, 0),
    (0x7d472adc65c36dd2u64, 30, 0, 0),
    (0x7d472adc65c36dd2u64, 30, 0, 0),
    (0x7d472adc65c36dd2u64, 30, 0, 0),
    (0x7d472adc65c36dd2u64, 30, 0, 0),
    (0xd47b477ba53bfe80u64, 30, 0, 0),
    (0xd47b477ba53bfe80u64, 30, 0, 0),
    (0xd47b477ba53bfe80u64, 30, 0, 0),
    (0xd47b477ba53bfe80u64, 30, 0, 0),
    (0x09f772cc19a3b294u64, 30, 0, 0),
    (0x09f772cc19a3b294u64, 30, 0, 0),
    (0x5e2d59e70e315fa0u64, 30, 0, 0),
    (0x5e2d59e70e315fa0u64, 30, 0, 0),
    (0x5e2d59e70e315fa0u64, 30, 0, 0),
    (0x5e2d59e70e315fa0u64, 30, 0, 0),
    (0x5e2d59e70e315fa0u64, 30, 0, 0),
    (0x5e2d59e70e315fa0u64, 30, 0, 0),
    (0x5e2d59e70e315fa0u64, 30, 0, 0),
    (0x5e2d59e70e315fa0u64, 30, 0, 0),
    (0x587e832952c1d1f6u64, 30, 0, 0),
    (0x858e5aa27dad3ce0u64, 30, 0, 0),
    (0x0cdbd3aa957c4097u64, 30, 0, 0),
    (0x0cdbd3aa957c4097u64, 30, 0, 0),
    (0x0cdbd3aa957c4097u64, 30, 0, 0),
    (0x0cdbd3aa957c4097u64, 30, 0, 0),
    (0x0cdbd3aa957c4097u64, 30, 0, 0),
    (0xe11a6a9171f9628du64, 30, 0, 0),
    (0xe11a6a9171f9628du64, 30, 0, 0),
    (0x2a7cec7a032769c9u64, 30, 0, 0),
    (0xf8f0729e33fb1358u64, 30, 0, 0),
    (0xf8f0729e33fb1358u64, 30, 0, 0),
    (0x6055fa43c7d3bddbu64, 30, 0, 0),
    (0x6055fa43c7d3bddbu64, 30, 0, 0),
    (0x6055fa43c7d3bddbu64, 30, 0, 0),
    (0x6055fa43c7d3bddbu64, 30, 0, 0),
    (0x6055fa43c7d3bddbu64, 30, 0, 0),
    (0x6055fa43c7d3bddbu64, 30, 0, 0),
    (0xe1021ef90163b013u64, 30, 0, 0),
    (0x21e39f0631adeecdu64, 30, 0, 0),
    (0x21b5d8cada7870f8u64, 30, 0, 0),
    (0x78dd7bc01a8e5202u64, 30, 0, 0),
    (0x2409a8759e62acf4u64, 30, 0, 0),
    (0x87afc9e56e906bd5u64, 30, 0, 0),
    (0x87afc9e56e906bd5u64, 30, 0, 0),
    (0xd035e62b33dc8d20u64, 30, 0, 0),
    (0xd035e62b33dc8d20u64, 30, 0, 0),
    (0xd51e50a8a5100aa0u64, 30, 0, 0),
    (0xd51e50a8a5100aa0u64, 30, 0, 0),
    (0xd51e50a8a5100aa0u64, 30, 0, 0),
    (0xd51e50a8a5100aa0u64, 30, 0, 0),
    (0xd51e50a8a5100aa0u64, 30, 0, 0),
    (0x0b31077a292ad3c6u64, 30, 0, 0),
    (0x0b31077a292ad3c6u64, 30, 0, 0),
    (0x57b93f4faf409c64u64, 30, 0, 0),
    (0x57b93f4faf409c64u64, 30, 0, 0),
    (0xc766bd33a57c6c70u64, 30, 0, 0),
    (0x3e970fbd2a36af15u64, 30, 0, 0),
    (0x3d2438e5852324e9u64, 30, 0, 0),
    (0x3d2438e5852324e9u64, 30, 0, 0),
    (0x848d18f3601c9ef2u64, 30, 0, 0),
    (0x848d18f3601c9ef2u64, 30, 0, 0),
    (0x1a0e414af4408abcu64, 30, 0, 0),
    (0x1a0e414af4408abcu64, 30, 0, 0),
    (0x1a0e414af4408abcu64, 30, 0, 0),
    (0xc14ffdccfab0cfedu64, 30, 0, 0),
    (0xe480e7630e59a7cbu64, 30, 0, 0),
    (0x2dfe35fd281e3378u64, 30, 0, 0),
    (0x2dfe35fd281e3378u64, 30, 0, 0),
    (0x8e87bf5a2eb767d3u64, 30, 0, 0),
    (0x8e87bf5a2eb767d3u64, 30, 0, 0),
    (0x8e87bf5a2eb767d3u64, 30, 0, 0),
    (0x8e87bf5a2eb767d3u64, 30, 0, 0),
    (0x8e87bf5a2eb767d3u64, 30, 0, 0),
    (0x8e87bf5a2eb767d3u64, 30, 0, 0),
    (0xad8a30cb68cce8ffu64, 30, 0, 0),
    (0xad8a30cb68cce8ffu64, 30, 0, 0),
    (0xcefde66340cac8b5u64, 30, 0, 0),
    (0xc7c10a3bed300d30u64, 30, 0, 0),
    (0xc7c10a3bed300d30u64, 30, 0, 0),
    (0x4eca61f5d06be028u64, 30, 0, 0),
    (0x8a46cfba04d068abu64, 30, 0, 0),
    (0x8a46cfba04d068abu64, 30, 0, 0),
    (0xa65af97ec55b1341u64, 30, 0, 0),
    (0xa65af97ec55b1341u64, 30, 0, 0),
    (0xa65af97ec55b1341u64, 30, 0, 0),
    (0x3bdde9986e66a25bu64, 30, 0, 0),
    (0x3bdde9986e66a25bu64, 30, 0, 0),
    (0xb1d837c59f7ac351u64, 30, 0, 0),
    (0xb1d837c59f7ac351u64, 30, 0, 0),
    (0x1823f135de1dc632u64, 30, 0, 0),
    (0xa10f8fade804b785u64, 30, 0, 0),
    (0xa10f8fade804b785u64, 30, 0, 0),
    (0xa10f8fade804b785u64, 30, 0, 0),
    (0xa9e76cbe5bae246au64, 30, 0, 0),
    (0x997486bbf8c5e4f5u64, 30, 0, 0),
    (0x997486bbf8c5e4f5u64, 30, 0, 0),
    (0x997486bbf8c5e4f5u64, 30, 0, 0),
    (0x997486bbf8c5e4f5u64, 30, 0, 0),
    (0x112d0c25139f2dd6u64, 30, 0, 0),
    (0x13386e9d2bc0226fu64, 30, 0, 0),
    (0x13386e9d2bc0226fu64, 30, 0, 0),
    (0x84367a0b4464218fu64, 30, 0, 0),
    (0x84367a0b4464218fu64, 30, 0, 0),
    (0x0ddc0165fe6e37b6u64, 30, 0, 0),
    (0x470b754618535fbbu64, 30, 0, 0),
    (0xd99838e1720ffc7fu64, 30, 0, 0),
    (0xd99838e1720ffc7fu64, 30, 0, 0),
    (0xb6cd9236e3db36eeu64, 30, 0, 0),
    (0xa6ffb15c7dc2a084u64, 30, 0, 0),
    (0xa6ffb15c7dc2a084u64, 30, 0, 0),
    (0xa6ffb15c7dc2a084u64, 30, 0, 0),
    (0xa6ffb15c7dc2a084u64, 30, 0, 0),
    (0xa6ffb15c7dc2a084u64, 30, 0, 0),
    (0xa6ffb15c7dc2a084u64, 30, 0, 0),
    (0xa6ffb15c7dc2a084u64, 30, 0, 0),
    (0xa6ffb15c7dc2a084u64, 30, 0, 0),
    (0x33f5922dc66ed283u64, 30, 0, 0),
    (0x33f5922dc66ed283u64, 30, 0, 0),
    (0x33f5922dc66ed283u64, 30, 0, 0),
    (0x33f5922dc66ed283u64, 30, 0, 0),
    (0x33f5922dc66ed283u64, 30, 0, 0),
    (0x33f5922dc66ed283u64, 30, 0, 0),
    (0x33f5922dc66ed283u64, 30, 0, 0),
    (0xe27efaec4094eb60u64, 30, 0, 0),
    (0xe27efaec4094eb60u64, 30, 0, 0),
    (0x02038723cfafdd1bu64, 30, 0, 0),
    (0x0cf1ff4e6f9d5d5du64, 30, 0, 0),
    (0x0cf1ff4e6f9d5d5du64, 30, 0, 0),
    (0xf0ee00af2a31625fu64, 30, 0, 0),
    (0xdb7dd09b6f0a601cu64, 30, 0, 0),
    (0x339c78553ca6f6f9u64, 30, 0, 0),
    (0x339c78553ca6f6f9u64, 30, 0, 0),
    (0x339c78553ca6f6f9u64, 30, 0, 0),
    (0x339c78553ca6f6f9u64, 30, 0, 0),
    (0x339c78553ca6f6f9u64, 30, 0, 0),
    (0xd0d4683859dac949u64, 30, 0, 0),
    (0xd0d4683859dac949u64, 30, 0, 0),
    (0xd0d4683859dac949u64, 30, 0, 0),
    (0xd0d4683859dac949u64, 30, 0, 0),
    (0xd0d4683859dac949u64, 30, 0, 0),
    (0xd0d4683859dac949u64, 30, 0, 0),
    (0xd0d4683859dac949u64, 30, 0, 0),
    (0xd0d4683859dac949u64, 30, 0, 0),
    (0xd6a23c9ca7c68e86u64, 30, 0, 0),
    (0xd6a23c9ca7c68e86u64, 30, 0, 0),
    (0xd6a23c9ca7c68e86u64, 30, 0, 0),
    (0xcef5cf6a0841d89du64, 30, 0, 0),
    (0xcef5cf6a0841d89du64, 30, 0, 0),
    (0x625b4ef9c4af150fu64, 30, 0, 0),
    (0x16aa9d6b232a295cu64, 30, 0, 0),
    (0x0c7a22019a28882fu64, 30, 0, 0),
    (0x0c7a22019a28882fu64, 30, 0, 0),
    (0x61aad38949f33712u64, 30, 0, 0),
    (0x050121d8b6052c6au64, 30, 0, 0),
    (0x050121d8b6052c6au64, 30, 0, 0),
    (0x474cb4883a2b47c2u64, 30, 0, 0),
    (0x474cb4883a2b47c2u64, 30, 0, 0),
    (0x474cb4883a2b47c2u64, 30, 0, 0),
    (0x13cf8b19d29c9cd4u64, 30, 0, 0),
    (0xe62df51bdac319b7u64, 30, 0, 0),
    (0x45db0db78d019b6au64, 30, 0, 0),
    (0x45db0db78d019b6au64, 30, 0, 0),
    (0x45db0db78d019b6au64, 30, 0, 0),
    (0x2a06ee8808fe1c50u64, 30, 0, 0),
    (0x2a06ee8808fe1c50u64, 30, 0, 0),
    (0xd86b4e94fe7ea6a1u64, 30, 0, 0),
    (0x993c5bf57c4f2173u64, 30, 0, 0),
    (0x993c5bf57c4f2173u64, 30, 0, 0),
    (0xb9fdc70af8d0c4aeu64, 30, 0, 0),
    (0xb9fdc70af8d0c4aeu64, 30, 0, 0),
    (0xb9fdc70af8d0c4aeu64, 30, 0, 0),
    (0xb9fdc70af8d0c4aeu64, 30, 0, 0),
    (0x4ca62476711f9a94u64, 30, 0, 0),
    (0x1e6bec64b147963fu64, 30, 0, 0),
    (0x1e6bec64b147963fu64, 30, 0, 0),
    (0x239990a85753b035u64, 30, 0, 0),
    (0x42476e7647115a31u64, 30, 0, 0),
    (0x42476e7647115a31u64, 30, 0, 0),
    (0x42476e7647115a31u64, 30, 0, 0),
    (0x42476e7647115a31u64, 30, 0, 0),
    (0x42476e7647115a31u64, 30, 0, 0),
    (0x42476e7647115a31u64, 30, 0, 0),
    (0x3eec8ea0582e52e3u64, 30, 0, 0),
    (0x3eec8ea0582e52e3u64, 30, 0, 0),
    (0x3eec8ea0582e52e3u64, 30, 0, 0),
    (0x0bd385544ac01411u64, 30, 0, 0),
    (0x106068862357c007u64, 30, 0, 0),
    (0x106068862357c007u64, 30, 0, 0),
    (0x106068862357c007u64, 30, 0, 0),
    (0x106068862357c007u64, 30, 0, 0),
    (0x106068862357c007u64, 30, 0, 0),
    (0x306440ef86628f44u64, 30, 0, 0),
    (0x306440ef86628f44u64, 30, 0, 0),
    (0x372b2eb8fa1725dau64, 30, 0, 0),
    (0x372b2eb8fa1725dau64, 30, 0, 0),
    (0x372b2eb8fa1725dau64, 30, 0, 0),
    (0xb9c4aee3b34a91ddu64, 30, 0, 0),
    (0x49091fa77a847639u64, 30, 0, 0),
    (0x49091fa77a847639u64, 30, 0, 0),
    (0x49091fa77a847639u64, 30, 0, 0),
    (0x49091fa77a847639u64, 30, 0, 0),
    (0x49091fa77a847639u64, 30, 0, 0),
    (0xc7014c3aa3abb878u64, 30, 0, 0),
    (0xc7014c3aa3abb878u64, 30, 0, 0),
    (0xc7014c3aa3abb878u64, 30, 0, 0),
    (0xc7014c3aa3abb878u64, 30, 0, 0),
    (0xc7014c3aa3abb878u64, 30, 0, 0),
    (0xc7014c3aa3abb878u64, 30, 0, 0),
    (0xc7014c3aa3abb878u64, 30, 0, 0),
    (0xc7014c3aa3abb878u64, 30, 0, 0),
    (0xc7014c3aa3abb878u64, 30, 0, 0),
    (0x76c1737ff3c1a83bu64, 30, 0, 0),
    (0x76c1737ff3c1a83bu64, 30, 0, 0),
    (0x76c1737ff3c1a83bu64, 30, 0, 0),
    (0x76c1737ff3c1a83bu64, 30, 0, 0),
    (0x76c1737ff3c1a83bu64, 30, 0, 0),
    (0x791380d474711564u64, 30, 0, 0),
    (0x791380d474711564u64, 30, 0, 0),
    (0x8a6934f908e13f4au64, 30, 0, 0),
    (0x8a6934f908e13f4au64, 30, 0, 0),
    (0xd40f9f6f68013663u64, 30, 0, 0),
    (0x09467c494b055979u64, 30, 0, 0),
    (0x68be9567dba1c294u64, 30, 0, 0),
    (0xc090547dae7de9e4u64, 30, 0, 0),
    (0xc090547dae7de9e4u64, 30, 0, 0),
    (0xc090547dae7de9e4u64, 30, 0, 0),
    (0xc090547dae7de9e4u64, 30, 0, 0),
];
pub const DO_DISASTERS_RIO: &[(u64, i32, i32, i32)] = &[
    (0x127c3c57b6ba3a57u64, 2, 49, 8),
    (0x127c3c57b6ba3a57u64, 1, 48, 8),
    (0x127c3c57b6ba3a57u64, 0, 47, 8),
    (0x127c3c57b6ba3a57u64, 0, 46, 8),
    (0x127c3c57b6ba3a57u64, 0, 45, 8),
    (0x127c3c57b6ba3a57u64, 0, 44, 8),
    (0x127c3c57b6ba3a57u64, 0, 43, 8),
    (0x127c3c57b6ba3a57u64, 0, 42, 8),
    (0x127c3c57b6ba3a57u64, 0, 41, 8),
    (0x127c3c57b6ba3a57u64, 0, 40, 8),
    (0x127c3c57b6ba3a57u64, 0, 39, 8),
    (0x127c3c57b6ba3a57u64, 0, 38, 8),
    (0x127c3c57b6ba3a57u64, 0, 37, 8),
    (0x127c3c57b6ba3a57u64, 0, 36, 8),
    (0x127c3c57b6ba3a57u64, 0, 35, 8),
    (0x127c3c57b6ba3a57u64, 0, 34, 8),
    (0x127c3c57b6ba3a57u64, 0, 33, 8),
    (0x127c3c57b6ba3a57u64, 0, 32, 8),
    (0x127c3c57b6ba3a57u64, 0, 31, 8),
    (0x127c3c57b6ba3a57u64, 0, 30, 8),
    (0x127c3c57b6ba3a57u64, 0, 29, 8),
    (0x127c3c57b6ba3a57u64, 0, 28, 8),
    (0x127c3c57b6ba3a57u64, 0, 27, 8),
    (0x127c3c57b6ba3a57u64, 0, 26, 8),
    (0x127c3c57b6ba3a57u64, 0, 25, 8),
    (0x127c3c57b6ba3a57u64, 0, 24, 8),
    (0x127c3c57b6ba3a57u64, 0, 23, 8),
    (0x127c3c57b6ba3a57u64, 0, 22, 8),
    (0x127c3c57b6ba3a57u64, 0, 21, 8),
    (0x127c3c57b6ba3a57u64, 0, 20, 8),
    (0x127c3c57b6ba3a57u64, 0, 19, 8),
    (0x127c3c57b6ba3a57u64, 0, 18, 8),
    (0x127c3c57b6ba3a57u64, 0, 17, 8),
    (0x127c3c57b6ba3a57u64, 0, 16, 8),
    (0x127c3c57b6ba3a57u64, 0, 15, 8),
    (0x127c3c57b6ba3a57u64, 0, 14, 8),
    (0x127c3c57b6ba3a57u64, 0, 13, 8),
    (0x127c3c57b6ba3a57u64, 0, 12, 8),
    (0x127c3c57b6ba3a57u64, 0, 11, 8),
    (0x127c3c57b6ba3a57u64, 0, 10, 8),
    (0x127c3c57b6ba3a57u64, 0, 9, 8),
    (0x127c3c57b6ba3a57u64, 0, 8, 8),
    (0x127c3c57b6ba3a57u64, 0, 7, 8),
    (0x127c3c57b6ba3a57u64, 0, 6, 8),
    (0x127c3c57b6ba3a57u64, 0, 5, 8),
    (0x127c3c57b6ba3a57u64, 0, 4, 8),
    (0x127c3c57b6ba3a57u64, 0, 3, 8),
    (0x127c3c57b6ba3a57u64, 0, 2, 8),
    (0x127c3c57b6ba3a57u64, 0, 1, 8),
    (0x127c3c57b6ba3a57u64, 0, 0, 8),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
    (0x127c3c57b6ba3a57u64, 0, 0, 0),
];
pub const DO_DISASTERS_SF: &[(u64, i32, i32, i32)] = &[
    (0xdf1acbf3ec6e9d99u64, 0, 0, 2),
    (0xdf1acbf3ec6e9d99u64, 0, 0, 0),
    (0xdf1acbf3ec6e9d99u64, 0, 0, 0),
    (0xdf1acbf3ec6e9d99u64, 0, 0, 0),
];
pub const VULNERABLE_HASH: (u64, i32) = (0xfbc976f15dbb0383u64, 18784);
pub const ROAD_TEST_HASH: (u64, i32) = (0x28bd38c39b970383u64, 10304);
