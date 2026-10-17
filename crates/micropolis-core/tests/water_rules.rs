//! The water rules at city scale (docs/game-design-v02.md): rule off = the original engine;
//! rule on = a town without water stalls, the same town with pumps and pipes does not; the
//! network survives a save.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::simulation::Simulation;
use micropolis_core::tile::{LOMASK, ZONEBIT};
use micropolis_core::tile_chars::{COMBASE, FREEZ, HOSPITAL, INDBASE, PORTBASE, RESBASE};
use micropolis_core::tool::{EditingTool, ToolResult};
use micropolis_core::water::{MAX_PUMPS, PIPE, PUMP, WATER_FREE_DENSITY};
use support::{file_of, run, state};

/// Density level of the zone whose centre tile is `t`, as the water rule counts it (0 = empty or
/// houses, n = n-th tier of building); 0 for anything that is not a plain zone.
fn density(s: &Simulation, t: u16) -> i32 {
    let c = t & LOMASK;
    let level = if (RESBASE..HOSPITAL).contains(&c) {
        if c == FREEZ {
            0
        } else {
            i32::from(s.get_res_zone_pop(c)) / 8 - 1
        }
    } else if (COMBASE..INDBASE).contains(&c) {
        i32::from(s.get_com_zone_pop(c))
    } else if (INDBASE..=PORTBASE).contains(&c) {
        i32::from(s.get_ind_zone_pop(c))
    } else {
        0
    };
    level.max(0)
}

/// A growing town on a random map: three rows of zones either side of a trunk road, joined to a
/// coal plant by a wire. Residential on the left, commercial and industrial on the right.
fn town(seed: i32) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.new_random_city(seed);
    s.total_funds = 100_000_000;
    s.set_speed(3);
    s.set_passes(1);
    let (w, h) = s.world_size();
    let (cx, cy) = (w / 2, h / 2);
    for k in -3..=3 {
        let y = cy + 4 * k;
        s.tool_drag(EditingTool::Road, cx - 20, y, cx + 20, y);
    }
    s.tool_drag(EditingTool::Road, cx, cy - 12, cx, cy + 12);
    for k in -3..3 {
        let y = cy + 4 * k + 2;
        for j in 0..5 {
            s.tool_down(EditingTool::Residential, cx - 3 - 3 * j, y);
            s.tool_down(
                if k % 2 == 0 {
                    EditingTool::Commercial
                } else {
                    EditingTool::Industrial
                },
                cx + 3 + 3 * j,
                y,
            );
        }
    }
    s.tool_down(EditingTool::CoalPower, cx - 26, cy);
    s.tool_drag(EditingTool::Wire, cx - 23, cy, cx - 17, cy);
    s.tool_drag(EditingTool::Wire, cx - 17, cy - 13, cx - 17, cy + 12);
    s.tool_drag(EditingTool::Wire, cx + 17, cy - 13, cx + 17, cy + 12);
    s.tool_drag(EditingTool::Wire, cx - 17, cy - 13, cx + 17, cy - 13);
    s
}

/// Pipes under every tile, written into the layer (it works with the rules off) and rebuilt
/// once; 12 000 `place_pipe` calls would rebuild the coverage 12 000 times.
fn pipe_everything(s: &mut Simulation) {
    let (w, h) = s.world_size();
    for x in 0..w {
        for y in 0..h {
            if s.water().pipes.get(x, y) == 0 {
                s.water_mut().pipes.set(x, y, PIPE);
            }
        }
    }
    s.water_mut().refresh();
}

/// Up to `MAX_PUMPS` pumps spread along the coast, placed (and paid) by the tool, then pipes
/// under every tile.
fn water_everything(s: &mut Simulation) {
    let (w, h) = s.world_size();
    let coast: Vec<(i32, i32)> = (0..w)
        .flat_map(|x| (0..h).map(move |y| (x, y)))
        .filter(|&(x, y)| s.pump_preview(x, y).result == ToolResult::Ok)
        .collect();
    let step = (coast.len() / MAX_PUMPS).max(1);
    for &(x, y) in coast.iter().step_by(step).take(MAX_PUMPS) {
        assert_eq!(s.place_pump(x, y), ToolResult::Ok);
    }
    pipe_everything(s);
}

/// Zones above the free density, with their centres.
fn dense(s: &Simulation) -> Vec<(i32, i32)> {
    let (w, h) = s.world_size();
    let mut out = Vec::new();
    for x in 0..w {
        for y in 0..h {
            let t = s.tile(x, y).unwrap();
            if t & ZONEBIT != 0 && density(s, t) > WATER_FREE_DENSITY {
                out.push((x, y));
            }
        }
    }
    out
}

const SEEDS: [i32; 3] = [2, 3, 5];

#[test]
fn the_rule_off_is_the_original_engine_whatever_the_network() {
    for seed in SEEDS {
        let mut plain = town(seed);
        let mut piped = town(seed);
        piped.water_mut().pipes.set(5, 5, PUMP);
        pipe_everything(&mut piped);
        assert!(!piped.water().is_empty() && !piped.water_rules());
        assert_eq!(piped.place_pipe(3, 3), ToolResult::Failed);
        assert_eq!(piped.place_pump(3, 3), ToolResult::Failed);
        run(&mut plain, 1500);
        run(&mut piped, 1500);
        assert_eq!(state(&plain), state(&piped), "seed {seed}");
        assert_eq!(
            plain.rng.random16(),
            piped.rng.random16(),
            "seed {seed}: rng"
        );
    }
}

#[test]
fn a_town_without_water_stalls_at_the_free_density() {
    let mut grew_elsewhere = 0;
    for seed in SEEDS {
        let mut dry = town(seed);
        dry.set_water_rules(true);
        let mut off = town(seed);
        for _ in 0..6 {
            run(&mut dry, 1000);
            run(&mut off, 1000);
            assert!(
                dense(&dry).is_empty(),
                "seed {seed}: a dry zone grew past the ceiling"
            );
            grew_elsewhere = grew_elsewhere.max(dense(&off).len());
        }
        assert_eq!(dry.water_stats().watered_zones, 0);
    }
    assert!(
        grew_elsewhere > 10,
        "the town must be able to grow denser with the rule off"
    );
}

#[test]
fn the_same_town_with_water_grows_exactly_as_with_the_rule_off() {
    for seed in SEEDS {
        let mut wet = town(seed);
        wet.set_water_rules(true);
        water_everything(&mut wet);
        assert_eq!(wet.water_stats().unwatered_zones, 0, "seed {seed}");
        let mut off = town(seed);
        let mut dense_seen = 0;
        for _ in 0..6 {
            run(&mut wet, 1000);
            run(&mut off, 1000);
            dense_seen = dense_seen.max(dense(&wet).len());
        }
        assert!(dense_seen > 0, "seed {seed}: water must let zones grow");
        // everything is watered, so the rule changes nothing but the money spent on the network
        assert_eq!(wet.tiles, off.tiles, "seed {seed}");
        assert_eq!(wet.total_pop, off.total_pop, "seed {seed}");
    }
}

#[test]
fn only_the_watered_part_of_a_town_gets_dense() {
    let mut s = town(3);
    s.set_water_rules(true);
    let (w, h) = s.world_size();
    let (cx, cy) = (w / 2, h / 2);
    // pipes under the western half only, a pump on the coast of that half
    let pump = (0..cx)
        .flat_map(|x| (0..h).map(move |y| (x, y)))
        .find(|&(x, y)| s.pump_preview(x, y).result == ToolResult::Ok)
        .expect("a coast tile in the west");
    assert_eq!(s.place_pump(pump.0, pump.1), ToolResult::Ok);
    for x in 0..cx {
        for y in 0..h {
            s.water_mut()
                .pipes
                .set(x, y, if (x, y) == pump { PUMP } else { PIPE });
        }
    }
    s.water_mut().refresh();
    let st = s.water_stats();
    assert!(
        st.watered_zones > 0 && st.unwatered_zones > 0,
        "{st:?} cy {cy}"
    );
    for _ in 0..6 {
        run(&mut s, 1000);
        for (x, y) in dense(&s) {
            assert!(s.watered(x, y), "dense zone at ({x}, {y}) has no water");
        }
    }
}

#[test]
fn the_result_is_deterministic() {
    let outcome = || {
        let mut s = town(3);
        s.set_water_rules(true);
        water_everything(&mut s);
        run(&mut s, 2000);
        (state(&s), s.water_stats())
    };
    assert_eq!(outcome(), outcome());
}

#[test]
fn the_network_and_the_rule_survive_a_save() {
    let mut s = town(3);
    s.set_water_rules(true);
    water_everything(&mut s);
    run(&mut s, 200);
    let file = file_of(&s);
    let mut back = Simulation::with_default_size();
    back.load_city(&file, 1).expect("a file this crate wrote");
    assert!(back.water_rules());
    assert_eq!(back.water(), s.water());
    assert_eq!(back.water().pumps(), s.water().pumps());
    assert_eq!(back.water_stats(), s.water_stats());
    // a load keeps playing the same game
    let mut a = back;
    let mut b = Simulation::with_default_size();
    b.load_city(&file, 1).unwrap();
    run(&mut a, 300);
    run(&mut b, 300);
    assert_eq!(state(&a), state(&b));
}

#[test]
fn a_new_city_starts_without_a_network() {
    let mut s = town(3);
    s.set_water_rules(true);
    water_everything(&mut s);
    s.new_random_city(9);
    assert!(s.water().is_empty());
    assert_eq!(s.water_stats().pumps, 0);
}
