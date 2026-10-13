//! Terrain relief in city files (docs/roadmap.md, step 1): an edited relief and the relief rules
//! survive save and load; a city with neither keeps the files written before the relief block.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, CTY_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::simulation::Simulation;
use support::{file_of, run, starter, state, HAIGHT};

const FLAG_RULES: u8 = 0b01;
const FLAG_EDITED: u8 = 0b10;

fn city(w: i32, h: i32, seed: i32) -> Simulation {
    let mut s = Simulation::new(w, h);
    s.new_random_city(seed);
    starter(&mut s);
    run(&mut s, 10);
    s
}

fn loaded(file: &[u8]) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(file, 1).expect("a file this crate wrote");
    s
}

fn code_of(file: &[u8]) -> &'static str {
    let mut s = Simulation::with_default_size();
    s.load_city(file, 1)
        .expect_err("the file must be refused")
        .code()
}

/// Changes a few altitudes, the way the terraforming tools will.
fn edit_relief(s: &mut Simulation) {
    let (w, h) = s.world_size();
    let relief = s.relief_mut();
    for i in 0..12 {
        relief.set_height_at(i * 3 % w, (i * 7) % h, (10 + i * 4) as u8);
    }
}

fn heights(s: &Simulation) -> Vec<u8> {
    s.relief().as_slice().to_vec()
}

fn version(file: &[u8]) -> u16 {
    u16::from_be_bytes([file[4], file[5]])
}

/// FNV-1a over bytes, 32 bits (the relief checksum, written out again here on purpose).
fn fnv32(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811c_9dc5;
    for &b in bytes {
        h ^= u32::from(b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// The version-1 extended file `v1` turned into version 2 with the relief block `flags`, `count`
/// and `heights`, and a checksum that matches them.
fn with_block(v1: &[u8], flags: u8, count: u32, heights: &[u8]) -> Vec<u8> {
    let mut out = v1.to_vec();
    out[4..6].copy_from_slice(&2u16.to_be_bytes());
    let start = out.len();
    out.push(flags);
    out.extend_from_slice(&count.to_be_bytes());
    out.extend_from_slice(heights);
    let sum = fnv32(&out[start..]);
    out.extend_from_slice(&sum.to_be_bytes());
    out
}

#[test]
fn an_edited_relief_and_the_rules_survive_save_and_load() {
    for (w, h) in [(120, 100), (97, 83), (300, 250)] {
        let mut s = city(w, h, 3);
        edit_relief(&mut s);
        s.set_relief_rules(true);
        let bytes = file_of(&s);
        assert_eq!(&bytes[..4], b"MCTY", "{w}x{h}");
        assert_eq!(version(&bytes), 2, "{w}x{h}");

        let back = loaded(&bytes);
        assert_eq!(heights(&back), heights(&s), "{w}x{h}: heights");
        assert!(back.relief_rules(), "{w}x{h}: rules");
        assert!(back.relief_edited(), "{w}x{h}: edited");
        assert_eq!(back.world_size(), (w, h));

        // The relief block is the tail: flags, count, altitudes, checksum.
        let n = (w as usize) * (h as usize);
        let at = bytes.len() - RELIEF_BLOCK_OVERHEAD - n;
        assert_eq!(bytes[at], FLAG_RULES | FLAG_EDITED, "{w}x{h}: flags");
        assert_eq!(
            &bytes[at + 5..at + 5 + n],
            &heights(&s)[..],
            "{w}x{h}: altitudes"
        );

        // From the first load on, the file saves to the same bytes again.
        let again = file_of(&back);
        assert_eq!(file_of(&loaded(&again)), again, "{w}x{h}: stable");
        assert_eq!(
            heights(&loaded(&again)),
            heights(&s),
            "{w}x{h}: heights again"
        );
    }
}

#[test]
fn rules_on_without_an_edit_keep_the_flag_and_not_the_edit() {
    let mut s = city(120, 100, 4);
    s.set_relief_rules(true);
    let bytes = file_of(&s);
    assert_eq!(
        bytes.len(),
        CITY_FILE_HEADER_SIZE + 2 * (6 * 240 + 120 + 12_000) + 9 + 12_000
    );
    let back = loaded(&bytes);
    assert!(back.relief_rules());
    assert!(!back.relief_edited());
    assert_eq!(heights(&back), heights(&s));
}

#[test]
fn an_unedited_120x100_city_is_the_old_plain_cty() {
    let s = city(120, 100, 5);
    assert!(!s.relief_edited() && !s.relief_rules());
    let bytes = file_of(&s);
    assert_eq!(bytes.len(), CTY_SIZE);
    assert_eq!(bytes, s.save_cty());

    let haight = loaded(HAIGHT);
    assert!(!haight.relief_edited() && !haight.relief_rules());
    assert_eq!(file_of(&haight), haight.save_cty());
    assert_eq!(file_of(&haight).len(), CTY_SIZE);
}

#[test]
fn version_1_and_plain_files_load_as_before() {
    let v1 = file_of(&city(97, 83, 3));
    assert_eq!(
        version(&v1),
        1,
        "an unedited city without rules has no relief block"
    );
    let s = loaded(&v1);
    assert_eq!(s.world_size(), (97, 83));
    assert!(!s.relief_edited() && !s.relief_rules());
    assert_eq!(file_of(&loaded(&v1)), file_of(&s));

    let plain = loaded(HAIGHT);
    assert!(!plain.relief_edited() && !plain.relief_rules());
}

#[test]
fn a_loaded_plain_file_resets_the_rules_and_the_edit() {
    let mut t = Simulation::with_default_size();
    t.set_relief_rules(true);
    edit_relief(&mut t);
    t.load_city(HAIGHT, 1).unwrap();
    assert!(!t.relief_rules());
    assert!(!t.relief_edited());
}

#[test]
fn a_truncated_relief_block_is_cty_truncated() {
    let mut s = city(97, 83, 2);
    edit_relief(&mut s);
    let full = file_of(&s);
    let block = RELIEF_BLOCK_OVERHEAD + 97 * 83;
    let without_block = full.len() - block;
    for len in [
        without_block,
        without_block + 1,
        full.len() - 5,
        full.len() - 1,
    ] {
        assert_eq!(code_of(&full[..len]), "cty_truncated", "length {len}");
    }
}

#[test]
fn a_corrupt_relief_block_is_cty_bad_relief() {
    let mut s = city(97, 83, 2);
    let v1 = file_of(&s);
    edit_relief(&mut s);
    let good = file_of(&s);
    let n = 97 * 83;
    let heights = heights(&s);

    // A changed altitude without a new checksum.
    let mut flipped = good.clone();
    let len = flipped.len();
    flipped[len - 5] ^= 1;
    assert_eq!(code_of(&flipped), "cty_bad_relief");

    // A checksum that is not the block's.
    let mut bad_sum = good.clone();
    let len = bad_sum.len();
    bad_sum[len - 1] ^= 0x40;
    assert_eq!(code_of(&bad_sum), "cty_bad_relief");

    // Each field wrong, with a checksum that matches the block as written.
    assert_eq!(
        code_of(&with_block(&v1, 0b100, n as u32, &heights)),
        "cty_bad_relief"
    );
    assert_eq!(
        code_of(&with_block(&v1, FLAG_EDITED, n as u32 - 1, &heights)),
        "cty_bad_relief"
    );
    let mut high = heights.clone();
    high[7] = 64;
    assert_eq!(
        code_of(&with_block(&v1, FLAG_EDITED, n as u32, &high)),
        "cty_bad_relief"
    );
}

#[test]
fn a_refused_relief_block_leaves_the_engine_untouched() {
    let mut src = city(97, 83, 2);
    edit_relief(&mut src);
    src.set_relief_rules(true);
    let good = file_of(&src);
    let v1 = file_of(&city(97, 83, 2));
    let n = 97 * 83;
    let mut flipped = good.clone();
    let len = flipped.len();
    flipped[len - 5] ^= 1;
    let refused = [
        good[..good.len() - 1].to_vec(),
        flipped,
        with_block(&v1, 0b100, n as u32, &heights(&src)),
    ];

    let mut a = Simulation::with_default_size();
    a.load_city(&good, 2).unwrap();
    run(&mut a, 10);
    let mut b = Simulation::with_default_size();
    b.load_city(&good, 2).unwrap();
    run(&mut b, 10);

    for bad in &refused {
        assert!(a.load_city(bad, 7).is_err());
        assert_eq!(state(&a), state(&b));
        assert_eq!(file_of(&a), file_of(&b));
        assert_eq!(heights(&a), heights(&b));
        assert_eq!((a.relief_rules(), a.relief_edited()), (true, true));
    }
}

#[test]
fn sizes_other_than_120x100_keep_their_files_unless_the_relief_needs_a_block() {
    for (w, h) in [(80, 67), (300, 250), (512, 512)] {
        let plain = city(w, h, 6);
        let bytes = file_of(&plain);
        assert_eq!(version(&bytes), 1, "{w}x{h} unedited");
        assert_eq!(
            bytes.len(),
            CITY_FILE_HEADER_SIZE + 2 * (6 * 240 + 120 + (w * h) as usize)
        );

        let mut edited = city(w, h, 6);
        edit_relief(&mut edited);
        assert_eq!(
            heights(&loaded(&file_of(&edited))),
            heights(&edited),
            "{w}x{h} edited"
        );
    }
}

#[test]
fn a_city_of_120x100_with_the_rules_is_an_extended_file() {
    let mut s = city(120, 100, 8);
    s.set_relief_rules(true);
    let bytes = file_of(&s);
    assert_eq!(&bytes[..4], b"MCTY");
    assert_eq!(version(&bytes), 2);
    assert_ne!(bytes.len(), CTY_SIZE);
    assert!(loaded(&bytes).relief_rules());
}
