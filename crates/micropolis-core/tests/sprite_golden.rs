//! Golden tests for `sprite.rs` (port of `sprite.cpp`).
//!
//! The expected output in `tests/golden/` was produced by the ORIGINAL C++
//! engine through `reference/gold/sprite_trace.cpp`:
//!
//! ```text
//! reference/build-harness.sh reference/gold/sprite_trace.cpp reference/build/sprite_trace
//! reference/build/sprite_trace <scenario> 100 > crates/micropolis-core/tests/golden/sprite_<scenario>.txt
//! reference/build/sprite_trace none 0   > .../golden/sprite_baseline.txt
//! reference/build/sprite_trace pure 0   > .../golden/sprite_pure.txt
//! ```
//!
//! The harness seeds the RNG with 1234 after loading `assets/cities/haight.cty`,
//! unlinks every sprite, and prints after every `moveObjects()` the tile-map
//! FNV hash and every active sprite in list order. This file reproduces that
//! trace exactly.

use std::fmt::Write;

use micropolis_core::position::Position;
use micropolis_core::simulation::{Scenario, Simulation};
use micropolis_core::sprite::{
    SPRITE_BUS, SPRITE_EXPLOSION, SPRITE_HELICOPTER, SPRITE_MONSTER, SPRITE_SHIP, SPRITE_TORNADO,
    SPRITE_TRAIN,
};
use micropolis_core::tile::LOMASK;
use micropolis_core::tile_chars as tc;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");
const SEED: i32 = 1234;

fn fnv(tiles: &[u16]) -> u64 {
    let mut h: u64 = 1469598103934665603;
    for &p in tiles {
        h ^= u64::from(p & 0xff);
        h = h.wrapping_mul(1099511628211);
        h ^= u64::from(p >> 8);
        h = h.wrapping_mul(1099511628211);
    }
    h
}

/// The state that the C++ harness starts from after `loadFile()`.
///
/// `loadFile()` runs `doSimInit()`, which rewrites tile bits and fills the
/// traffic and rate-of-growth maps, so the raw `.cty` content is not the
/// starting point. The golden file `golden/haight_post_load.txt` holds that
/// state as dumped by `sprite_trace startmap`: 12000 tile lines (x-major), then
/// `traffic x y v` and `rate x y v` for the nonzero cells.
fn post_load() -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_cty(HAIGHT).expect("haight.cty loads");
    let mut tile = 0usize;
    for line in include_str!("golden/haight_post_load.txt").lines() {
        let mut parts = line.split(' ');
        match parts.next() {
            Some("traffic") => {
                let (x, y, v) = parse3(&mut parts);
                s.traffic_density_map.world_set(x, y, v as u8);
            }
            Some("rate") => {
                let (x, y, v) = parse3(&mut parts);
                s.rate_of_growth_map.world_set(x, y, v as i16);
            }
            Some(v) => {
                s.tiles[tile] = v.parse().expect("tile value");
                tile += 1;
            }
            None => {}
        }
    }
    assert_eq!(tile, s.tiles.len(), "all tiles present");
    s
}

fn parse3<'a>(parts: &mut impl Iterator<Item = &'a str>) -> (i32, i32, i32) {
    let mut next = || -> i32 { parts.next().expect("field").parse().expect("number") };
    (next(), next(), next())
}

/// Same setup as `sprite_trace.cpp` before the scenario-specific part.
fn setup(scenario: &str) -> Simulation {
    let mut s = post_load();
    s.rng.seed(SEED);
    while let Some(i) = s.sprite_list {
        s.destroy_sprite(i);
    }
    s.sprite_cycle = 0;
    s.sim_speed = 3;
    s.do_animation = true;
    s.pollution_max_x = 60;
    s.pollution_max_y = 50;
    s.enable_disasters = false;
    s.scenario = Scenario::None;

    match scenario {
        "train" => {
            // haight.cty has no rail: lay a straight track at y = 30.
            for x in 10..=100 {
                s.set_tile(x, 30, tc::HRAIL);
            }
            s.make_sprite(SPRITE_TRAIN, (12 << 4) + 8, (30 << 4) + 8);
        }
        "copter" => {
            s.make_sprite(SPRITE_HELICOPTER, 60 << 4, 50 << 4);
        }
        "airplane" => {
            s.generate_plane(Position::new(20, 20));
        }
        "tornado" => {
            s.make_sprite(SPRITE_TORNADO, 40 << 4, 40 << 4);
        }
        "monster" => {
            s.make_sprite(SPRITE_MONSTER, (60 << 4) + 48, 50 << 4);
        }
        "explosion" => {
            s.make_explosion(40, 40);
        }
        "bus" => {
            let (fx, fy) = first_tile(&s, tc::ROADBASE, tc::LASTROAD);
            s.make_sprite(SPRITE_BUS, fx << 4, fy << 4);
        }
        "ship" | "ship_sf" => {
            if scenario == "ship_sf" {
                s.scenario = Scenario::SanFrancisco;
            }
            // haight.cty has no channel: lay a straight channel at y = 40.
            for x in 10..=60 {
                s.set_tile(x, 40, tc::CHANNEL);
            }
            s.make_sprite(SPRITE_SHIP, 10 << 4, 40 << 4);
        }
        "lists" => {
            s.make_explosion(10, 10);
            s.make_explosion(30, 10);
            s.make_explosion(50, 10);
            // Destroy the middle one of the active list (index 1 in list order).
            let first = s.sprite_list.expect("three sprites");
            let mid = s.sprites[first].next.expect("three sprites");
            s.destroy_sprite(mid);
            s.make_explosion(70, 10);
            s.make_explosion(90, 10);
        }
        "none" => {}
        other => panic!("unknown scenario {other}"),
    }
    s
}

/// First tile (x-major, then y) whose low bits lie in `lo..=hi`.
fn first_tile(s: &Simulation, lo: u16, hi: u16) -> (i32, i32) {
    let (w, h) = s.world_size();
    for x in 0..w {
        for y in 0..h {
            let t = s.tile(x, y).expect("in world") & LOMASK;
            if (lo..=hi).contains(&t) {
                return (x, y);
            }
        }
    }
    panic!("no tile in {lo}..={hi}");
}

fn dump(s: &Simulation, step: usize, out: &mut String) {
    writeln!(
        out,
        "step {} cycle {} map {:016x}",
        step,
        s.sprite_cycle,
        fnv(&s.tiles)
    )
    .unwrap();
    let mut cur = s.sprite_list;
    while let Some(i) = cur {
        let p = &s.sprites[i];
        writeln!(
            out,
            "  t{} f{} x{} y{} dx{} dy{} ox{} oy{} c{} s{} d{} nd{} st{} fl{} ct{} tu{} ac{} sp{} xh{} yh{}",
            p.kind,
            p.frame,
            p.x,
            p.y,
            p.dest_x,
            p.dest_y,
            p.orig_x,
            p.orig_y,
            p.count,
            p.sound_count,
            p.dir,
            p.new_dir,
            p.step,
            p.flag,
            p.control,
            p.turn,
            p.accel,
            p.speed,
            p.x_hot,
            p.y_hot
        )
        .unwrap();
        cur = p.next;
    }
}

fn trace(s: &mut Simulation, steps: usize) -> String {
    let mut out = String::new();
    dump(s, 0, &mut out);
    for t in 1..=steps {
        s.move_objects();
        dump(s, t, &mut out);
    }
    out
}

/// Panics with the first differing line, to make a mismatch readable.
fn assert_same(got: &str, expected: &str) {
    if got == expected {
        return;
    }
    for (n, (g, e)) in got.lines().zip(expected.lines()).enumerate() {
        if g != e {
            panic!("trace differs at line {}:\n  rust: {g}\n  cpp:  {e}", n + 1);
        }
    }
    panic!(
        "trace length differs: rust {} lines, cpp {} lines",
        got.lines().count(),
        expected.lines().count()
    );
}

fn check_scenario(scenario: &str, expected: &str) {
    let mut s = setup(scenario);
    let got = trace(&mut s, 100);
    assert_same(&got, expected);
}

#[test]
fn baseline_load_matches_cpp() {
    // The injected start state hashes the same as the C++ harness's baseline.
    let s = setup("none");
    let mut got = String::new();
    dump(&s, 0, &mut got);
    assert_same(&got, include_str!("golden/sprite_baseline.txt"));
}

#[test]
fn train_matches_cpp() {
    check_scenario("train", include_str!("golden/sprite_train.txt"));
}

#[test]
fn helicopter_matches_cpp() {
    check_scenario("copter", include_str!("golden/sprite_copter.txt"));
}

#[test]
fn airplane_matches_cpp() {
    check_scenario("airplane", include_str!("golden/sprite_airplane.txt"));
}

#[test]
#[ignore = "needs the message module: explosions call send_message (shim todo!)"]
fn tornado_matches_cpp() {
    check_scenario("tornado", include_str!("golden/sprite_tornado.txt"));
}

#[test]
#[ignore = "needs the message module: explosions call send_message (shim todo!)"]
fn monster_matches_cpp() {
    check_scenario("monster", include_str!("golden/sprite_monster.txt"));
}

#[test]
#[ignore = "needs the message module: explosions call send_message (shim todo!)"]
fn explosion_matches_cpp() {
    check_scenario("explosion", include_str!("golden/sprite_explosion.txt"));
}

#[test]
fn bus_matches_cpp() {
    check_scenario("bus", include_str!("golden/sprite_bus.txt"));
}

#[test]
#[ignore = "needs the message module: a ship that leaves the channel explodes (send_message shim)"]
fn ship_matches_cpp() {
    check_scenario("ship", include_str!("golden/sprite_ship.txt"));
}

#[test]
#[ignore = "needs the message module: a ship that leaves the channel explodes (send_message shim)"]
fn ship_san_francisco_matches_cpp() {
    check_scenario("ship_sf", include_str!("golden/sprite_ship_sf.txt"));
}

#[test]
#[ignore = "needs the message module: explosions call send_message (shim todo!)"]
fn list_order_and_reuse_match_cpp() {
    check_scenario("lists", include_str!("golden/sprite_lists.txt"));
}

#[test]
fn pure_helpers_match_cpp() {
    let mut s = post_load();
    let mut out = String::new();

    let c = [-50, 0, 40, 700, 1900];
    for p in 0..=9 {
        for d in 0..=9 {
            writeln!(out, "turn {p} {d} -> {}", s.turn_to(p, d)).unwrap();
        }
    }
    for &a in &c {
        for &b in &c {
            for &e in &c {
                for &f in &c {
                    let z = s.get_dir(a, b, e, f);
                    writeln!(out, "dir {a} {b} {e} {f} -> {z} abs {}", s.abs_dist).unwrap();
                    writeln!(
                        out,
                        "dist {a} {b} {e} {f} -> {}",
                        s.get_distance(a, b, e, f)
                    )
                    .unwrap();
                }
            }
        }
    }
    let tp = [
        0,
        5,
        i32::from(tc::POWERBASE),
        i32::from(tc::POWERBASE) + 1,
        i32::from(tc::RAILBASE),
        i32::from(tc::RAILBASE) + 1,
    ];
    for &t in &tp {
        for o in 0..=9 {
            for n in 0..=9 {
                writeln!(
                    out,
                    "other {t} {o} {n} -> {}",
                    i32::from(s.try_other(t, o, n))
                )
                .unwrap();
            }
        }
    }
    for &a in &c {
        for &b in &c {
            writeln!(out, "char {a} {b} -> {}", s.get_char(a, b)).unwrap();
        }
    }

    assert_same(&out, include_str!("golden/sprite_pure.txt"));
}

#[test]
fn sprite_list_and_pool_semantics() {
    // New sprites go to the head of the list; freed ones are reused LIFO.
    let mut s = Simulation::with_default_size();
    let a = s.new_sprite(SPRITE_EXPLOSION, 100, 100);
    let b = s.new_sprite(SPRITE_EXPLOSION, 200, 100);
    let c = s.new_sprite(SPRITE_EXPLOSION, 300, 100);
    assert_eq!(s.sprite_list, Some(c));
    assert_eq!(s.sprites[c].next, Some(b));
    assert_eq!(s.sprites[b].next, Some(a));

    s.destroy_sprite(b);
    assert_eq!(s.sprites[c].next, Some(a));
    s.destroy_sprite(c);
    assert_eq!(s.sprite_list, Some(a));
    assert_eq!(s.free_sprites, Some(c));

    // The most recently freed slot is reused first.
    let d = s.new_sprite(SPRITE_EXPLOSION, 400, 100);
    assert_eq!(d, c);
    assert_eq!(s.sprite_list, Some(d));
    assert_eq!(s.free_sprites, Some(b));
}

#[test]
fn explosion_sprite_has_cpp_initial_fields() {
    let mut s = Simulation::with_default_size();
    let i = s.make_sprite(SPRITE_EXPLOSION, 500, 600);
    let p = &s.sprites[i];
    assert_eq!(
        (p.x, p.y, p.frame, p.speed, p.control),
        (500, 600, 1, 100, -1)
    );
    assert_eq!((p.width, p.height, p.x_hot, p.y_hot), (48, 48, 40, 16));
}

#[test]
fn get_sprite_ignores_inactive_global() {
    let mut s = Simulation::with_default_size();
    let i = s.make_sprite(SPRITE_TORNADO, 500, 600);
    assert_eq!(s.get_sprite(SPRITE_TORNADO), Some(i));
    s.sprites[i].frame = 0;
    assert_eq!(s.get_sprite(SPRITE_TORNADO), None);
    // make_sprite re-uses the global sprite rather than allocating another.
    assert_eq!(s.make_sprite(SPRITE_TORNADO, 10, 10), i);
    assert_eq!(s.sprites.len(), 1);
}
