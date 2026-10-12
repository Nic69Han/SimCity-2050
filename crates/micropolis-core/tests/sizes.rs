//! The engine at sizes other than the original 120x100: new cities of any accepted size build
//! and run, the sized buffers follow the world, and a .cty file always gives the 120x100 world.
//! The fingerprints against the recompiled original are in scripts/compare-bigmap.sh.

use micropolis_core::fileio::CTY_SIZE;
use micropolis_core::simulation::Simulation;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");

#[test]
fn new_random_cities_of_several_sizes_run() {
    for (w, h) in [
        (80, 67),
        (97, 83),
        (100, 80),
        (160, 120),
        (300, 250),
        (90, 300),
    ] {
        let mut s = Simulation::new(w, h);
        s.new_random_city(3);
        assert_eq!(s.world_size(), (w, h));
        assert_eq!(s.tiles.len(), (w * h) as usize, "{w}x{h} tiles");
        // POWER_STACK_SIZE = WORLD_W * WORLD_H / 4
        assert_eq!(
            s.power_stack.len(),
            (w * h / 4) as usize,
            "{w}x{h} power stack"
        );
        s.set_speed(3);
        for _ in 0..60 {
            s.sim_tick();
        }
        assert_eq!(s.tiles.len(), (w * h) as usize);
    }
}

#[test]
fn a_sized_city_is_deterministic() {
    let run = |w, h| {
        let mut s = Simulation::new(w, h);
        s.new_random_city(11);
        s.set_speed(3);
        for _ in 0..80 {
            s.sim_tick();
        }
        (s.tiles.clone(), s.total_funds, s.total_pop)
    };
    assert_eq!(run(97, 83), run(97, 83));
    assert_ne!(run(97, 83).0, run(98, 83).0);
}

#[test]
fn a_cty_file_always_gives_the_original_world() {
    let mut s = Simulation::new(240, 200);
    s.load_cty(HAIGHT).expect("haight loads into any engine");
    assert_eq!(s.world_size(), (120, 100));
    assert_eq!(s.tiles.len(), 120 * 100);
    assert_eq!(s.save_cty().len(), CTY_SIZE);
    assert!(
        s.load_cty(&HAIGHT[..10]).is_err(),
        "a short file is still refused"
    );
}
