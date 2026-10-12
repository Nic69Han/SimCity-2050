//! Save and load of cities at many sizes: a starter-like city, run a while, saved, loaded and
//! saved again.
//!
//! The first load recomputes derived tile data (`loadFile` runs `doSimInit`, and the original
//! does the same: scripts/compare-saveload.sh checks the tile map right after loading). So a
//! city saved before any load can differ from its first re-save in a few derived tiles. From the
//! first load on, the bytes are stable.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::simulation::Simulation;
use support::{derived_changes, file_of, run, split_tiles, starter};

const SIZES: [(i32, i32); 7] = [
    (80, 67),
    (97, 83),
    (120, 100),
    (200, 150),
    (300, 250),
    (512, 512),
    (90, 300),
];

fn built_city(w: i32, h: i32, seed: i32, ticks: usize) -> Simulation {
    let mut s = Simulation::new(w, h);
    s.new_random_city(seed);
    starter(&mut s);
    run(&mut s, ticks);
    s
}

fn loaded(file: &[u8], seed: i32) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(file, seed).expect("a file this crate wrote");
    s
}

#[test]
fn save_load_save_is_stable_at_every_size() {
    for (w, h) in SIZES {
        let original = built_city(w, h, 7, 60);
        let s1 = file_of(&original);
        let l1 = loaded(&s1, 1);
        assert_eq!(l1.world_size(), (w, h), "{w}x{h} world size");
        let s2 = file_of(&l1);
        let (head1, tiles1) = split_tiles(&s1, w, h);
        let (head2, tiles2) = split_tiles(&s2, w, h);
        assert_eq!(head1, head2, "{w}x{h}: everything but the tiles is kept");
        derived_changes(&tiles1, &tiles2, &format!("{w}x{h}"));

        let l2 = loaded(&s2, 1);
        assert_eq!(
            file_of(&l2),
            s2,
            "{w}x{h}: saved again after a load differs"
        );
        assert_eq!(l2.tiles, l1.tiles, "{w}x{h} tiles after the second load");
        assert_eq!(l1.total_funds, original.total_funds, "{w}x{h} funds");
        assert_eq!(l1.city_time, original.city_time, "{w}x{h} time");
    }
}

#[test]
fn a_city_saved_after_a_load_is_the_same_file() {
    // Once loaded, a city saves back to the bytes it was loaded from, for sizes and runs.
    for (w, h, ticks) in [(97, 83, 0), (160, 120, 40), (300, 250, 40)] {
        let s1 = file_of(&built_city(w, h, 3, ticks));
        let l1 = loaded(&s1, 1);
        let s2 = file_of(&l1);
        let mut l2 = loaded(&s2, 1);
        run(&mut l2, 0);
        assert_eq!(file_of(&l2), s2, "{w}x{h}");
    }
}

#[test]
fn extended_file_size_is_exact() {
    for (w, h) in SIZES {
        let s = built_city(w, h, 2, 5);
        let bytes = file_of(&s);
        let expected = if (w, h) == (120, 100) {
            27_120
        } else {
            10 + 2 * (6 * 240 + 120 + (w * h) as usize)
        };
        assert_eq!(bytes.len(), expected, "{w}x{h}");
    }
}

#[test]
fn a_plain_cty_loads_like_load_cty_seeded() {
    // 120x100 stays a .cty: load_city gives what load_cty_seeded gives.
    let saved = file_of(&built_city(120, 100, 9, 30));
    assert_eq!(saved.len(), 27_120);
    let via_city = loaded(&saved, 1);
    let mut via_cty = Simulation::with_default_size();
    via_cty.load_cty_seeded(&saved, 1).unwrap();
    assert_eq!(file_of(&via_city), file_of(&via_cty));
    assert_eq!(via_city.tiles, via_cty.tiles);
    assert_eq!(via_city.total_funds, via_cty.total_funds);
}

#[test]
fn an_extended_file_of_120x100_loads_as_that_size() {
    // A 120x100 city written with the extended header: valid, and the same city.
    let cty = file_of(&built_city(120, 100, 5, 20));
    let mut ext = b"MCTY".to_vec();
    ext.extend_from_slice(&1u16.to_be_bytes());
    ext.extend_from_slice(&120u16.to_be_bytes());
    ext.extend_from_slice(&100u16.to_be_bytes());
    ext.extend_from_slice(&cty);
    let mut back = Simulation::new(97, 83);
    back.load_city(&ext, 1).unwrap();
    assert_eq!(back.world_size(), (120, 100));
    // The same city as the plain file loads to.
    let plain = loaded(&cty, 1);
    assert_eq!(back.tiles, plain.tiles);
    assert_eq!(file_of(&back), file_of(&plain));
}
