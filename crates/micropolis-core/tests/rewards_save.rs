//! The rewards in a saved city (docs/game-design-v12.md): chunk 12 and the second rules byte
//! bit 3. Rule off and nothing stored = the file is what it always was; the unlocks, the
//! answers and the buildings round-trip; a bad chunk is `cty_bad_extension`; a loaded city is
//! made consistent.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::extensions::{CHUNK_MAX_TAG, CHUNK_REWARDS, CHUNK_RULES};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::rewards::{ANSWER_ACCEPTED, ANSWER_PROPOSED, ANSWER_REFUSED, CHUNK_SIZE};
use micropolis_core::simulation::Simulation;
use micropolis_core::tool::ToolResult;
use support::{file_of, run};

const W: i32 = 97;
const H: i32 = 83;

fn city() -> Simulation {
    let mut s = Simulation::new(W, H);
    s.new_random_city(3);
    support::starter(&mut s);
    run(&mut s, 10);
    s.total_funds = 1_000_000;
    s
}

fn free_spot(s: &Simulation, genre: u8) -> (i32, i32) {
    for x in 0..W - 4 {
        for y in 0..H - 4 {
            if s.structure_preview(genre, x, y).result == ToolResult::Ok {
                return (x, y);
            }
        }
    }
    panic!("no free spot");
}

/// Both rules on; the statue unlocked and built, the casino accepted and built, the prison
/// refused, the dump proposed.
fn with_rewards() -> Simulation {
    let mut s = city();
    s.set_structure_rules(true);
    s.set_reward_rules(true);
    let state = &mut s.extensions_mut().reward_state;
    state.unlock(52);
    state.unlock(50);
    state.set_answer(60, ANSWER_ACCEPTED);
    state.set_answer(61, ANSWER_REFUSED);
    state.set_answer(62, ANSWER_PROPOSED);
    for g in [52, 60] {
        let (x, y) = free_spot(&s, g);
        assert_eq!(s.place_structure(g, x, y), ToolResult::Ok, "{g}");
    }
    s
}

fn loaded(file: &[u8]) -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(file, 1).expect("a file this crate wrote");
    s
}

fn block_at() -> usize {
    CITY_FILE_HEADER_SIZE
        + 2 * (6 * 240 + 120 + (W * H) as usize)
        + RELIEF_BLOCK_OVERHEAD
        + (W * H) as usize
}

fn chunk(tag: u8, bytes: &[u8]) -> Vec<u8> {
    let mut c = vec![tag];
    c.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    c.extend_from_slice(bytes);
    c
}

fn with_chunks(good: &[u8], chunks: &[u8]) -> Vec<u8> {
    let mut out = good[..block_at()].to_vec();
    out.extend_from_slice(&(chunks.len() as u32).to_be_bytes());
    out.extend_from_slice(chunks);
    out
}

/// The tags of the chunks of a file, in order.
fn tags_of(file: &[u8]) -> Vec<u8> {
    let chunks = &file[block_at() + 4..];
    let (mut at, mut tags) = (0, Vec::new());
    while at < chunks.len() {
        tags.push(chunks[at]);
        let len = u32::from_be_bytes([
            chunks[at + 1],
            chunks[at + 2],
            chunks[at + 3],
            chunks[at + 4],
        ]);
        at += 5 + len as usize;
    }
    tags
}

#[test]
fn rule_off_and_nothing_stored_is_the_file_it_always_was() {
    let pristine = file_of(&city());
    let mut s = with_rewards();
    s.set_reward_rules(false);
    s.set_structure_rules(false);
    s.total_funds = city().total_funds;
    assert!(!s.needs_extension_block());
    assert_eq!(file_of(&s), pristine);
}

#[test]
fn the_rule_alone_is_two_rule_bytes_and_no_chunk_12() {
    let mut s = city();
    s.set_structure_rules(true);
    s.set_reward_rules(true);
    let file = file_of(&s);
    assert_eq!(tags_of(&file), [CHUNK_RULES], "nothing stored: not written");
    let chunks = &file[block_at() + 4..];
    assert_eq!(&chunks[1..5], &[0, 0, 0, 2]);
    assert_eq!(chunks[6] & 0b1000, 0b1000, "second byte, bit 3");
    let back = loaded(&file);
    assert!(back.reward_rules() && back.structure_rules());
    assert!(back.extensions().reward_state.is_empty());
}

#[test]
fn unlocks_answers_and_buildings_round_trip() {
    let s = with_rewards();
    let file = file_of(&s);
    let back = loaded(&file);
    assert!(back.reward_rules());
    assert_eq!(back.extensions().reward_state, s.extensions().reward_state);
    assert_eq!(back.reward_list(), s.reward_list());
    assert_eq!(back.offer_list(), s.offer_list());
    assert_eq!(back.structures(), s.structures());
    assert_eq!(back.reward_stats()[2..], s.reward_stats()[2..]);
    // stable from the second save on
    let again = file_of(&back);
    assert_eq!(file_of(&loaded(&again)), again);
}

#[test]
fn the_rewards_chunk_has_tag_12_holds_four_bytes_and_is_the_last_one() {
    assert_eq!((CHUNK_REWARDS, CHUNK_MAX_TAG, CHUNK_SIZE), (12, 12, 4));
    let file = file_of(&with_rewards());
    let tags = tags_of(&file);
    assert_eq!(tags.last(), Some(&CHUNK_REWARDS));
    assert!(tags.windows(2).all(|w| w[0] < w[1]));
    // unlock bits 0 and 2; offers 0 accepted (2), 1 refused (3 << 2), 2 proposed (1 << 4)
    let chunks = &file[block_at() + 4..];
    assert_eq!(&chunks[chunks.len() - 4..], &[0, 0b101, 0, 0b0001_1110]);
}

#[test]
fn a_bad_chunk_is_refused_and_leaves_the_engine_untouched() {
    let mut engine = with_rewards();
    let good = file_of(&engine);
    let bad_chunks = [
        ("empty", chunk(CHUNK_REWARDS, &[])),
        ("short", chunk(CHUNK_REWARDS, &[0, 1, 0])),
        ("long", chunk(CHUNK_REWARDS, &[0, 1, 0, 0, 0])),
        ("all zero", chunk(CHUNK_REWARDS, &[0, 0, 0, 0])),
        (
            "unlock of no genre",
            chunk(CHUNK_REWARDS, &[0, 0b10_0000, 0, 0]),
        ),
        ("unlock high byte", chunk(CHUNK_REWARDS, &[1, 0, 0, 0])),
        ("answer of no offer", chunk(CHUNK_REWARDS, &[0, 1, 1, 0])),
    ];
    let before = file_of(&engine);
    for (name, chunks) in &bad_chunks {
        let file = with_chunks(&good, chunks);
        let err = engine.load_city(&file, 1).expect_err(name);
        assert_eq!(err.code(), "cty_bad_extension", "{name}");
        assert_eq!(file_of(&engine), before, "{name}");
    }
    // a tag past the last one is refused too
    let file = with_chunks(&good, &chunk(CHUNK_MAX_TAG + 1, &[0, 1, 0, 0]));
    assert_eq!(
        engine.load_city(&file, 1).expect_err("tag 13").code(),
        "cty_bad_extension"
    );
}

#[test]
fn a_loaded_city_is_made_consistent() {
    let s = with_rewards();
    let good = file_of(&s);
    // state stored while the rule is off (no rules chunk): forgotten
    let off_chunks = chunk(CHUNK_REWARDS, &[0, 0b101, 0, 0b10]);
    let back = loaded(&with_chunks(&good, &off_chunks));
    assert!(!back.reward_rules());
    assert!(back.extensions().reward_state.is_empty());
    // buildings the state does not allow are dropped: the statue stays locked, the casino not
    // accepted, so nothing may stand
    let mut t = with_rewards();
    t.extensions_mut().reward_state = Default::default();
    t.extensions_mut().reward_state.unlock(50);
    let back = loaded(&file_of(&t));
    assert!(back.structures().is_empty());
    assert!(back.reward_list()[0].unlocked && !back.reward_list()[2].unlocked);
}
