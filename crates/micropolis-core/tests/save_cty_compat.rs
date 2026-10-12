//! The 120x100 `.cty` output is unchanged by the extended format: `save_city` gives the bytes
//! that `save_cty` gave before wave 6. The goldens were taken from that code (a starter-like
//! city of seed 7 after 200 ticks, and the Haight sample loaded and saved again).

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::simulation::Simulation;
use support::{fnv, HAIGHT};

const BUILT_HASH: u64 = 0x1c3e_e286_00f3_a201;
const HAIGHT_HASH: u64 = 0x75ba_4395_45d0_c7da;

fn built_city() -> Simulation {
    let mut s = Simulation::with_default_size();
    s.new_random_city(7);
    support::starter(&mut s);
    support::run(&mut s, 200);
    s
}

#[test]
fn cty_bytes_are_those_of_the_previous_release() {
    let built = built_city().save_cty();
    assert_eq!(built.len(), 27_120);
    assert_eq!(fnv(&built), BUILT_HASH);

    let mut h = Simulation::with_default_size();
    h.load_cty(HAIGHT).unwrap();
    let haight = h.save_cty();
    assert_eq!(fnv(&haight), HAIGHT_HASH);
}
