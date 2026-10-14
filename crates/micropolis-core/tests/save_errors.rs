//! Corrupt and truncated city files: each gives its stable code, and a refused file leaves the
//! engine exactly as it was.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::fileio::{CityFileError, CTY_SIZE};
use micropolis_core::simulation::Simulation;
use support::{file_of, run, starter, state, HAIGHT};

fn extended(w: i32, h: i32) -> Vec<u8> {
    let mut s = Simulation::new(w, h);
    s.new_random_city(4);
    starter(&mut s);
    run(&mut s, 10);
    file_of(&s)
}

fn code_of(bytes: &[u8]) -> &'static str {
    let mut s = Simulation::with_default_size();
    let err = s.load_city(bytes, 1).expect_err("the file must be refused");
    err.code()
}

#[test]
fn truncated_extended_files_are_cty_truncated() {
    let full = extended(97, 83);
    for len in [0, 1, 3, 4, 9, 10, 11, full.len() / 2, full.len() - 1] {
        assert_eq!(code_of(&full[..len]), "cty_truncated", "length {len}");
    }
}

#[test]
fn truncated_plain_cty_files_are_cty_truncated() {
    assert_eq!(code_of(&HAIGHT[..CTY_SIZE - 1]), "cty_truncated");
    assert_eq!(code_of(&HAIGHT[..100]), "cty_truncated");
}

#[test]
fn extra_bytes_are_cty_bad_size() {
    let mut longer = extended(97, 83);
    longer.push(0);
    assert_eq!(code_of(&longer), "cty_bad_size");
}

#[test]
fn a_file_that_is_neither_a_cty_nor_an_extended_file_is_cty_bad_magic() {
    let mut big = HAIGHT.to_vec();
    big.push(0);
    assert_eq!(code_of(&big), "cty_bad_magic");
    let junk = vec![0x42u8; 30_000];
    assert_eq!(code_of(&junk), "cty_bad_magic");
    // Shorter than a .cty and without the header: taken for a cut-short .cty.
    assert_eq!(code_of(&vec![0x42u8; 20_000]), "cty_truncated");
}

#[test]
fn an_unknown_version_is_cty_bad_version() {
    let mut bytes = extended(97, 83);
    bytes[4..6].copy_from_slice(&3u16.to_be_bytes());
    assert_eq!(code_of(&bytes), "cty_bad_version");
}

#[test]
fn sizes_outside_the_range_are_cty_size_out_of_range() {
    for (w, h) in [(79u16, 83u16), (97, 66), (513, 83), (97, 513), (0, 0)] {
        let mut bytes = extended(97, 83);
        bytes[6..8].copy_from_slice(&w.to_be_bytes());
        bytes[8..10].copy_from_slice(&h.to_be_bytes());
        assert_eq!(code_of(&bytes), "cty_size_out_of_range", "{w}x{h}");
    }
}

#[test]
fn the_smallest_and_largest_sizes_are_accepted() {
    for (w, h) in [(80, 67), (512, 512)] {
        let bytes = extended(w, h);
        assert_eq!(
            &bytes[6..10],
            &[(w >> 8) as u8, w as u8, (h >> 8) as u8, h as u8]
        );
        let mut s = Simulation::with_default_size();
        s.load_city(&bytes, 1)
            .unwrap_or_else(|e| panic!("{w}x{h}: {e}"));
        assert_eq!(s.world_size(), (w, h));
    }
}

#[test]
fn the_error_text_starts_with_the_code() {
    let mut s = Simulation::with_default_size();
    let err = s.load_city(&[0u8; 30], 1).unwrap_err();
    assert!(matches!(err, CityFileError::Truncated { .. }));
    assert!(err.to_string().starts_with("cty_truncated: "), "{err}");
}

#[test]
fn a_refused_file_leaves_the_engine_untouched() {
    let good = extended(160, 120);
    let mut a = Simulation::with_default_size();
    a.load_city(&good, 2).unwrap();
    run(&mut a, 10);
    let mut b = Simulation::with_default_size();
    b.load_city(&good, 2).unwrap();
    run(&mut b, 10);

    let mut bad = good.clone();
    bad[4..6].copy_from_slice(&9u16.to_be_bytes());
    let bad_size = extended(97, 83);
    for refused in [
        &good[..good.len() - 5],
        &bad[..],
        &bad_size[..bad_size.len() - 1],
        &HAIGHT[..100],
    ] {
        assert!(a.load_city(refused, 7).is_err());
        assert_eq!(state(&a), state(&b));
        assert_eq!(file_of(&a), file_of(&b));
    }
    // The generator was not touched either: the futures still agree.
    run(&mut a, 40);
    run(&mut b, 40);
    assert_eq!(state(&a), state(&b));
}
