//! ARCHITECTURE.md rule 2: same input + same seed = same city. Loading a city must not depend on
//! what the engine held before (the page switches cities in one long-lived engine).

use micropolis_core::simulation::Simulation;
use micropolis_core::tool::EditingTool;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");
const KYOTO: &[u8] = include_bytes!("../../../assets/cities/kyoto.cty");

fn run(sim: &mut Simulation, ticks: usize) -> Vec<u8> {
    sim.sim_speed = 3;
    sim.sim_passes = 1;
    for _ in 0..ticks {
        sim.sim_tick();
    }
    sim.save_cty()
}

fn fresh_kyoto(ticks: usize) -> (Vec<u16>, Vec<u8>) {
    let mut s = Simulation::with_default_size();
    s.rng.seed(1);
    s.load_cty(KYOTO).unwrap();
    let saved = run(&mut s, ticks);
    (s.tiles.clone(), saved)
}

#[test]
fn load_after_another_city_equals_fresh_load() {
    let (fresh_tiles, fresh_saved) = fresh_kyoto(120);

    let mut used = Simulation::with_default_size();
    used.rng.seed(77);
    used.load_cty(HAIGHT).unwrap();
    // Dirty every kind of state: simulation, player actions, sprites, settings, queued events.
    used.enable_disasters = true;
    used.tool_down(EditingTool::CoalPower, 5, 5);
    used.tool_drag(EditingTool::Road, 10, 10, 30, 10);
    run(&mut used, 300);
    used.rng.seed(1);
    used.load_cty(KYOTO).unwrap();
    let used_saved = run(&mut used, 120);

    assert_eq!(
        used.tiles, fresh_tiles,
        "tile map differs after loading over another city"
    );
    assert_eq!(
        used_saved, fresh_saved,
        "saved city differs after loading over another city"
    );
}

#[test]
fn reloading_the_same_city_is_stable() {
    let (fresh_tiles, fresh_saved) = fresh_kyoto(60);
    let mut s = Simulation::with_default_size();
    for _ in 0..3 {
        s.rng.seed(1);
        s.load_cty(KYOTO).unwrap();
        let saved = run(&mut s, 60);
        assert_eq!(s.tiles, fresh_tiles);
        assert_eq!(saved, fresh_saved);
    }
}

#[test]
fn a_refused_file_leaves_the_engine_untouched() {
    let mut s = Simulation::with_default_size();
    s.rng.seed(1);
    s.load_cty(HAIGHT).unwrap();
    let before = s.save_cty();
    assert!(s.load_cty(&HAIGHT[..100]).is_err());
    assert_eq!(s.save_cty(), before);
}

fn fresh_new_city(seed: i32, ticks: usize) -> (Vec<u16>, Vec<u8>) {
    let mut s = Simulation::with_default_size();
    s.new_random_city(seed);
    let saved = run(&mut s, ticks);
    (s.tiles.clone(), saved)
}

#[test]
fn new_random_city_after_another_city_equals_fresh() {
    let (fresh_tiles, fresh_saved) = fresh_new_city(4242, 150);

    let mut used = Simulation::with_default_size();
    used.rng.seed(5);
    used.load_cty(HAIGHT).unwrap();
    used.enable_disasters = true;
    used.tool_down(EditingTool::CoalPower, 5, 5);
    run(&mut used, 300);
    used.new_random_city(4242);
    let used_saved = run(&mut used, 150);

    assert_eq!(
        used.tiles, fresh_tiles,
        "new city differs depending on the previous city"
    );
    assert_eq!(used_saved, fresh_saved);
}
