//! The economy in a saved city (docs/game-design-v11.md): chunk 11 and the second rules byte
//! bit 2. Rule off and nothing stored = the file is what it always was; the rates, the bonds and
//! the goods round-trip; a bad chunk is `cty_bad_extension`.

#[path = "save_support/mod.rs"]
mod support;

use micropolis_core::economy::{
    Bond, EconomyState, BOND_AMOUNT, BOND_RECORD_SIZE, MAX_BONDS, STATE_FIXED_SIZE,
};
use micropolis_core::extensions::{CHUNK_ECONOMY, CHUNK_MAX_TAG, CHUNK_RULES};
use micropolis_core::fileio::{CITY_FILE_HEADER_SIZE, RELIEF_BLOCK_OVERHEAD};
use micropolis_core::simulation::Simulation;
use support::{file_of, run};

const W: i32 = 120;
const H: i32 = 100;

/// The sample city: it has people, so it collects taxes.
fn city() -> Simulation {
    let mut s = Simulation::with_default_size();
    s.load_city(support::HAIGHT, 1).expect("the sample city");
    s.total_funds = 1_000_000;
    s.set_city_tax(7);
    s
}

/// The rule on, a custom rate, two bonds and one year passed.
fn with_economy() -> Simulation {
    let mut s = city();
    s.set_economy_rules(true);
    assert!(s.set_zone_tax_rate(2, 3, 15));
    assert!(s.set_zone_tax_rate(1, 1, 3));
    assert_eq!(s.issue_bond(), 1);
    assert_eq!(s.issue_bond(), 1);
    run(&mut s, 2000);
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
    let mut s = city();
    s.set_economy_rules(true);
    assert!(s.set_zone_tax_rate(1, 1, 3));
    assert_eq!(s.issue_bond(), 1);
    s.set_economy_rules(false);
    s.total_funds = city().total_funds;
    assert!(!s.needs_extension_block());
    assert_eq!(file_of(&s), pristine);
}

#[test]
fn the_rule_alone_is_two_rule_bytes_and_no_chunk_11() {
    let mut s = city();
    s.set_economy_rules(true);
    let file = file_of(&s);
    assert_eq!(tags_of(&file), [CHUNK_RULES], "start state: not written");
    let chunks = &file[block_at() + 4..];
    assert_eq!(&chunks[1..5], &[0, 0, 0, 2]);
    assert_eq!(chunks[6] & 0b100, 0b100, "second byte, bit 2");
    let back = loaded(&file);
    assert!(back.economy_rules() && !back.structure_rules());
    assert_eq!(back.extensions().economy_state, EconomyState::default());
}

#[test]
fn rates_bonds_and_goods_round_trip() {
    let s = with_economy();
    assert!(s.extensions().economy_state.custom && s.bonds().len() == 2);
    let file = file_of(&s);
    let back = loaded(&file);
    assert!(back.economy_rules());
    assert_eq!(
        back.extensions().economy_state,
        s.extensions().economy_state
    );
    assert_eq!(back.tax_rates(), s.tax_rates());
    assert_eq!(back.tax_income(), s.tax_income());
    assert_eq!(back.goods_stats(), s.goods_stats());
    assert_eq!(back.bonds(), s.bonds());
    assert!(back.bonds()[0].years >= 1, "the years are saved");
    assert!(
        back.tax_income().iter().sum::<i32>() > 0,
        "a year of taxes is saved"
    );
    // the extension block (rules and chunks) is stable from the second save on; the classic
    // part of a played city is not byte-stable, which is the classic engine's business
    let again = file_of(&back);
    let third = file_of(&loaded(&again));
    assert_eq!(again[block_at()..], third[block_at()..]);
    assert_eq!(file_of(&s)[block_at()..], again[block_at()..]);
}

#[test]
fn two_loads_of_an_economy_file_play_the_same() {
    let file = file_of(&with_economy());
    let (mut a, mut b) = (loaded(&file), loaded(&file));
    run(&mut a, 600);
    run(&mut b, 600);
    assert_eq!(support::state(&a), support::state(&b));
    assert_eq!(a.bonds(), b.bonds());
    assert_eq!(a.tax_income(), b.tax_income());
    assert_eq!(a.goods_stats(), b.goods_stats());
}

#[test]
fn the_economy_chunk_has_tag_11_and_is_the_last_one() {
    assert_eq!((CHUNK_ECONOMY, CHUNK_MAX_TAG), (11, 12));
    let tags = tags_of(&file_of(&with_economy()));
    assert_eq!(tags.last(), Some(&CHUNK_ECONOMY));
    assert!(tags.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn a_bad_chunk_is_refused_and_leaves_the_engine_untouched() {
    let mut engine = with_economy();
    let good = file_of(&engine);
    let valid = engine.extensions().economy_state.encode();
    assert_eq!(valid.len(), STATE_FIXED_SIZE + 2 * BOND_RECORD_SIZE);
    let mut cut = valid.clone();
    cut.pop();
    let mut long = valid.clone();
    long.push(0);
    let mut flag = valid.clone();
    flag[0] = 2;
    let mut rate = valid.clone();
    rate[1] = 21;
    let mut count = valid.clone();
    count[STATE_FIXED_SIZE - 1] = (MAX_BONDS + 1) as u8;
    let mut amount = valid.clone();
    amount[STATE_FIXED_SIZE..STATE_FIXED_SIZE + 4].fill(0);
    let bad_chunks = [
        ("short", chunk(CHUNK_ECONOMY, &[1, 2, 3])),
        ("cut", chunk(CHUNK_ECONOMY, &cut)),
        ("long", chunk(CHUNK_ECONOMY, &long)),
        ("flag", chunk(CHUNK_ECONOMY, &flag)),
        ("rate over 20", chunk(CHUNK_ECONOMY, &rate)),
        ("too many bonds", chunk(CHUNK_ECONOMY, &count)),
        ("bond of nothing", chunk(CHUNK_ECONOMY, &amount)),
    ];
    let before = file_of(&engine);
    for (name, chunks) in &bad_chunks {
        let rules = chunk(CHUNK_RULES, &[0, 0b100]);
        let file = with_chunks(&good, &[rules, chunks.clone()].concat());
        let err = engine.load_city(&file, 1).expect_err(name);
        assert_eq!(err.code(), "cty_bad_extension", "{name}");
        assert_eq!(file_of(&engine), before, "{name}");
    }
}

#[test]
fn a_chunk_with_the_rule_off_is_forgotten_on_load() {
    let s = with_economy();
    let bytes = s.extensions().economy_state.encode();
    let file = with_chunks(&file_of(&s), &chunk(CHUNK_ECONOMY, &bytes));
    let back = loaded(&file);
    assert!(!back.economy_rules());
    assert_eq!(back.extensions().economy_state, EconomyState::default());
    assert!(back.bonds().is_empty());
}

#[test]
fn many_bonds_at_the_cap_round_trip() {
    let mut s = city();
    s.set_economy_rules(true);
    for _ in 0..MAX_BONDS {
        assert_eq!(s.issue_bond(), 1);
    }
    let back = loaded(&file_of(&s));
    assert_eq!(back.bonds().len(), MAX_BONDS);
    assert_eq!(back.bonds()[MAX_BONDS - 1].permille, 30 + 10 * 9);
    assert_eq!(back.bond_offer(), (0, 0));
    let _ = (
        BOND_AMOUNT,
        Bond {
            amount: 1,
            permille: 1,
            years: 0,
        },
    );
}
