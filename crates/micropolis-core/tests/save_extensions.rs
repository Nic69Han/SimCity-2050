//! The extensions block of MCTY version 3 (docs/game-design-v02.md, phase A): written only when
//! an extended rule is on or a network holds something, so every other file stays what it was;
//! read back exactly; a bad block is `cty_bad_extension` and leaves the engine untouched.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::extensions::{CHUNK_RULES, CHUNK_TRANSIT, CHUNK_WATER};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, CTY_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::simulation::Simulation;
use support::{file_of, run, starter, state, HAIGHT};

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

fn version(file: &[u8]) -> u16 {
    u16::from_be_bytes([file[4], file[5]])
}

/// A city with every kind of content in its extensions block.
fn full(w: i32, h: i32) -> Simulation {
    let mut s = city(w, h, 3);
    s.extensions_mut().ordinances = 0x0000_0105;
    s.extensions_mut().water_rules = true;
    s.extensions_mut().transit_rules = true;
    s.water_mut().pipes.set(4, 5, 1);
    s.water_mut().pipes.set(w - 1, h - 1, 2);
    s.transit_mut().underground.set(7, 8, 3);
    s
}

/// Offset of the extensions block (its length) in a version-3 file of a `w` x `h` map.
fn block_at(w: i32, h: i32) -> usize {
    CITY_FILE_HEADER_SIZE
        + 2 * (6 * 240 + 120 + (w * h) as usize)
        + RELIEF_BLOCK_OVERHEAD
        + (w * h) as usize
}

/// The file with the chunk bytes `chunks` as its extensions block.
fn with_chunks(good: &[u8], w: i32, h: i32, chunks: &[u8]) -> Vec<u8> {
    let mut out = good[..block_at(w, h)].to_vec();
    out.extend_from_slice(&(chunks.len() as u32).to_be_bytes());
    out.extend_from_slice(chunks);
    out
}

fn chunk(tag: u8, bytes: &[u8]) -> Vec<u8> {
    let mut c = vec![tag];
    c.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    c.extend_from_slice(bytes);
    c
}

#[test]
fn files_without_extensions_are_what_they_always_were() {
    // Plain .cty at 120x100.
    let s = city(120, 100, 5);
    assert!(!s.needs_extension_block());
    assert_eq!(file_of(&s), s.save_cty());
    assert_eq!(file_of(&s).len(), CTY_SIZE);
    // Version 1 at another size.
    let v1 = file_of(&city(97, 83, 3));
    assert_eq!(version(&v1), 1);
    assert_eq!(
        v1.len(),
        CITY_FILE_HEADER_SIZE + 2 * (6 * 240 + 120 + 97 * 83)
    );
    // Version 2 with the relief rules.
    let mut r = city(97, 83, 3);
    r.set_relief_rules(true);
    let v2 = file_of(&r);
    assert_eq!(version(&v2), 2);
    assert_eq!(v2.len(), v1.len() + RELIEF_BLOCK_OVERHEAD + 97 * 83);
    // Networks that were emptied again do not leave a block behind.
    let mut e = city(97, 83, 3);
    e.water_mut().pipes.set(1, 1, 1);
    e.water_mut().pipes.set(1, 1, 0);
    e.extensions_mut().water_rules = true;
    e.extensions_mut().water_rules = false;
    assert_eq!(file_of(&e), v1);
    // A sample city loaded and saved again.
    let haight = loaded(HAIGHT);
    assert_eq!(file_of(&haight), haight.save_cty());
    assert_eq!(file_of(&haight).len(), CTY_SIZE);
}

#[test]
fn old_files_load_with_every_extended_rule_off() {
    for file in [HAIGHT.to_vec(), file_of(&city(97, 83, 3)), {
        let mut r = city(97, 83, 3);
        r.set_relief_rules(true);
        file_of(&r)
    }] {
        let s = loaded(&file);
        assert!(!s.extensions_active());
        assert!(s.water().is_empty() && s.transit().is_empty());
        // Saved again, the file keeps its format (a plain .cty, or the same version and size).
        let again = file_of(&s);
        assert_eq!(again.len(), file.len());
        if file.len() != CTY_SIZE {
            assert_eq!(version(&again), version(&file));
        }
    }
}

#[test]
fn a_rule_alone_makes_a_version_3_file_that_loads_back() {
    for i in 0..3 {
        let mut s = city(120, 100, 4);
        match i {
            0 => s.extensions_mut().ordinances = 8,
            1 => s.extensions_mut().water_rules = true,
            _ => s.extensions_mut().transit_rules = true,
        }
        let bytes = file_of(&s);
        assert_eq!(&bytes[..4], b"MCTY", "switch {i}");
        assert_eq!(version(&bytes), 3, "switch {i}");
        let back = loaded(&bytes);
        assert_eq!(back.extensions(), s.extensions(), "switch {i}");
        let again = file_of(&back);
        assert_eq!(
            again[block_at(120, 100)..],
            bytes[block_at(120, 100)..],
            "switch {i}: block"
        );
        assert_eq!(file_of(&loaded(&again)), again, "switch {i}: stable");
        assert!(!back.relief_edited() && !back.relief_rules(), "switch {i}");
    }
}

#[test]
fn a_network_alone_makes_a_version_3_file_with_the_rules_off() {
    let mut s = city(97, 83, 3);
    s.transit_mut().underground.set(10, 11, 4);
    let bytes = file_of(&s);
    assert_eq!(version(&bytes), 3);
    let back = loaded(&bytes);
    assert!(!back.extensions_active());
    assert_eq!(back.transit(), s.transit());
    let again = file_of(&back);
    assert_eq!(again[block_at(97, 83)..], bytes[block_at(97, 83)..]);
    assert_eq!(file_of(&loaded(&again)), again);
}

#[test]
fn everything_survives_save_and_load_at_several_sizes() {
    for (w, h) in [(120, 100), (97, 83), (300, 250)] {
        let mut s = full(w, h);
        s.set_relief_rules(true);
        let bytes = file_of(&s);
        assert_eq!(version(&bytes), 3, "{w}x{h}");
        let back = loaded(&bytes);
        assert_eq!(back.world_size(), (w, h));
        assert_eq!(back.extensions(), s.extensions(), "{w}x{h}");
        assert_eq!(back.water(), s.water(), "{w}x{h}");
        assert_eq!(back.transit(), s.transit(), "{w}x{h}");
        assert!(back.relief_rules(), "{w}x{h}");
        assert_eq!(state(&back), state(&loaded(&bytes)), "{w}x{h}");
        let again = file_of(&back);
        assert_eq!(
            again[block_at(w, h)..],
            bytes[block_at(w, h)..],
            "{w}x{h}: block"
        );
        assert_eq!(file_of(&loaded(&again)), again, "{w}x{h}: stable");
    }
}

#[test]
fn an_edited_relief_and_the_extensions_share_a_file() {
    let mut s = full(97, 83);
    s.relief_mut().set_height_at(3, 3, 40);
    let back = loaded(&file_of(&s));
    assert!(back.relief_edited());
    assert_eq!(back.relief().height_at(3, 3), Some(40));
    assert_eq!(back.water(), s.water());
}

#[test]
fn loading_a_plain_file_clears_the_extensions_of_the_engine() {
    let mut t = full(120, 100);
    t.load_city(HAIGHT, 1).unwrap();
    assert!(!t.extensions_active());
    assert!(t.water().is_empty() && t.transit().is_empty());
}

#[test]
fn a_new_city_empties_the_networks() {
    let mut s = full(97, 83);
    s.new_random_city(9);
    assert!(s.water().is_empty() && s.transit().is_empty());
}

#[test]
fn a_bad_block_is_cty_bad_extension() {
    let (w, h) = (97, 83);
    let good = file_of(&full(w, h));
    let n = (w * h) as usize;
    let refused = [
        ("unknown tag", chunk(9, &[1])),
        ("tag zero", chunk(0, &[])),
        (
            "out of order",
            [chunk(CHUNK_WATER, &vec![1; n]), chunk(CHUNK_RULES, &[1])].concat(),
        ),
        (
            "repeated",
            [chunk(CHUNK_RULES, &[1]), chunk(CHUNK_RULES, &[1])].concat(),
        ),
        ("unknown flag", chunk(CHUNK_RULES, &[0b1_0000])),
        ("rules too long", chunk(CHUNK_RULES, &[1, 1])),
        ("ordinances length", chunk(2, &[1, 2, 3])),
        ("water size", chunk(CHUNK_WATER, &[1, 2, 3])),
        ("transit size", chunk(CHUNK_TRANSIT, &vec![1; n + 1])),
        ("header cut short", vec![1, 0, 0]),
        ("chunk longer than block", vec![1, 0, 0, 0, 9, 1]),
        ("stray byte", [chunk(CHUNK_RULES, &[1]), vec![9]].concat()),
    ];
    for (name, chunks) in &refused {
        let file = with_chunks(&good, w, h, chunks);
        assert_eq!(code_of(&file), "cty_bad_extension", "{name}");
    }
}

#[test]
fn a_block_whose_length_disagrees_with_the_file_is_a_size_error() {
    let (w, h) = (97, 83);
    let good = file_of(&full(w, h));
    assert_eq!(code_of(&good[..good.len() - 1]), "cty_truncated");
    let mut longer = good.clone();
    longer.push(0);
    assert_eq!(code_of(&longer), "cty_bad_size");
    // The file ends inside the block length itself.
    let at = block_at(w, h);
    assert_eq!(code_of(&good[..at + 2]), "cty_truncated");
    assert_eq!(code_of(&good[..at]), "cty_truncated");
}

#[test]
fn a_refused_block_leaves_the_engine_untouched() {
    let (w, h) = (97, 83);
    let mut src = full(w, h);
    src.set_relief_rules(true);
    let good = file_of(&src);
    let refused = [
        good[..good.len() - 1].to_vec(),
        with_chunks(&good, w, h, &chunk(9, &[1])),
        with_chunks(&good, w, h, &chunk(CHUNK_WATER, &[1, 2])),
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
        assert_eq!(a.extensions(), b.extensions());
        assert_eq!(a.water(), b.water());
        assert_eq!(a.world_size(), (w, h));
    }
}

#[test]
fn the_error_text_names_the_code() {
    let (w, h) = (97, 83);
    let good = file_of(&full(w, h));
    let file = with_chunks(&good, w, h, &chunk(9, &[1]));
    let mut s = Simulation::with_default_size();
    let text = s.load_city(&file, 1).unwrap_err().to_string();
    assert!(text.starts_with("cty_bad_extension: "), "{text}");
}
