//! Loading is a deterministic function of (bytes, seed): the same file gives the same city, and
//! the same future. And what a save and load loses is only what the original game also loses.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::simulation::Simulation;
use micropolis_core::tool::EditingTool;
use support::{derived_changes, file_of, run, split_tiles, starter, state, HAIGHT};

fn city_file(w: i32, h: i32, seed: i32, ticks: usize) -> Vec<u8> {
    let mut s = Simulation::new(w, h);
    s.new_random_city(seed);
    starter(&mut s);
    run(&mut s, ticks);
    file_of(&s)
}

#[test]
fn two_loads_of_the_same_bytes_give_the_same_future() {
    for (w, h) in [(97, 83), (200, 150), (120, 100)] {
        let bytes = if (w, h) == (120, 100) {
            HAIGHT.to_vec()
        } else {
            city_file(w, h, 4, 40)
        };
        let mut a = Simulation::with_default_size();
        a.load_city(&bytes, 3).unwrap();
        let mut b = Simulation::with_default_size();
        b.load_city(&bytes, 3).unwrap();
        assert_eq!(state(&a), state(&b), "{w}x{h}: right after loading");
        for step in 0..4 {
            run(&mut a, 50);
            run(&mut b, 50);
            assert_eq!(
                state(&a),
                state(&b),
                "{w}x{h}: after {} ticks",
                (step + 1) * 50
            );
        }
        assert_eq!(file_of(&a), file_of(&b), "{w}x{h}: saved files");
    }
}

#[test]
fn loading_over_another_city_equals_loading_into_a_fresh_engine() {
    let bytes = city_file(97, 83, 6, 30);
    let mut fresh = Simulation::with_default_size();
    fresh.load_city(&bytes, 2).unwrap();
    run(&mut fresh, 150);

    // A busy engine: another size, player actions, disasters, many ticks.
    let mut used = Simulation::new(300, 250);
    used.new_random_city(9);
    used.enable_disasters = true;
    used.tool_down(EditingTool::CoalPower, 150, 120);
    used.tool_drag(EditingTool::Road, 100, 100, 180, 100);
    run(&mut used, 300);
    used.load_city(&bytes, 2).unwrap();
    run(&mut used, 150);

    assert_eq!(state(&used), state(&fresh));
    assert_eq!(file_of(&used), file_of(&fresh));
}

#[test]
fn the_seed_is_part_of_the_input() {
    // The seed is an input of the load: the generator is seeded with it, and the load draws from
    // the generator (the original's loadFile does too), so the same bytes with another seed can
    // give another city, and the same seed always gives the same one.
    let bytes = city_file(97, 83, 6, 30);
    let mut a = Simulation::with_default_size();
    a.load_city(&bytes, 1).unwrap();
    let mut b = Simulation::with_default_size();
    b.load_city(&bytes, 1).unwrap();
    assert_eq!(state(&a), state(&b));
    assert_eq!(file_of(&a), file_of(&b));
}

#[test]
fn a_loaded_city_loses_only_what_the_original_loses() {
    // The original game's save and load keep the histories, the misc history (funds, time,
    // tax, speed, flags) and the tiles, and recompute the derived state (the power bits and
    // other derived tile data, the maps, the census). It loses the sprites, the generator state
    // and the funding levels (loadFile resets them to full). Checked here: what the file
    // describes is kept, only a few derived tiles change, and there are no sprites.
    for (w, h) in [(97, 83), (120, 100)] {
        let mut original = Simulation::new(w, h);
        original.new_random_city(8);
        starter(&mut original);
        run(&mut original, 120);
        let file = file_of(&original);
        let mut loaded = Simulation::with_default_size();
        loaded.load_city(&file, 1).unwrap();
        let again = file_of(&loaded);

        assert_eq!(loaded.world_size(), (w, h));
        assert_eq!(loaded.total_funds, original.total_funds, "{w}x{h} funds");
        assert_eq!(loaded.city_time, original.city_time, "{w}x{h} time");
        assert_eq!(loaded.city_tax, original.city_tax, "{w}x{h} tax");
        assert_eq!(loaded.sim_speed, original.sim_speed, "{w}x{h} speed");
        assert_eq!(loaded.auto_bulldoze, original.auto_bulldoze);
        assert_eq!(loaded.auto_budget, original.auto_budget);
        assert!(loaded.sprites.is_empty(), "a loaded city has no sprites");

        let (head_a, tiles_a) = split_tiles(&file, w, h);
        let (head_b, tiles_b) = split_tiles(&again, w, h);
        assert_eq!(
            head_a, head_b,
            "{w}x{h}: the histories and the misc history are kept"
        );
        derived_changes(&tiles_a, &tiles_b, &format!("{w}x{h}"));
    }
}
