//! Native tests of `City::take_messages` on the real engine: the records are well formed,
//! the messages the engine sends are the ones the page gets, and a drain empties the queue.
//! The record layout is documented at the top of `crates/micropolis-wasm/src/messages.rs`.

use micropolis_core::tool::EditingTool;
use micropolis_wasm::City;

const HAIGHT: &[u8] = include_bytes!("../../../assets/cities/haight.cty");

const KIND_MESSAGE: i32 = 1;
const KIND_SOUND: i32 = 2;
const KIND_WIN: i32 = 3;
const KIND_LOSE: i32 = 4;
const KIND_QUAKE: i32 = 5;
const KIND_GOTO: i32 = 6;

/// `MESSAGE_NEED_ELECTRICITY` and `MESSAGE_LAST` of `message.rs`.
const MESSAGE_NEED_ELECTRICITY: i32 = 6;
const MESSAGE_LAST: i32 = 57;

/// The records of a drain, as `[kind, a, b, c, d, e]` arrays.
fn records(flat: &[i32]) -> Vec<[i32; 6]> {
    assert_eq!(flat.len() % 6, 0, "records are fixed size: {}", flat.len());
    flat.as_chunks::<6>().0.to_vec()
}

/// Checks the fields every record must have, whatever its kind.
fn assert_well_formed(r: &[i32; 6]) {
    match r[0] {
        KIND_MESSAGE => {
            assert!((1..=MESSAGE_LAST).contains(&r[1]), "message number {r:?}");
            assert!(r[4] == 0 || r[4] == 1, "picture flag {r:?}");
            assert!(r[5] == 0 || r[5] == 1, "important flag {r:?}");
        }
        KIND_SOUND => {
            assert!(!City::sound_name(r[1]).is_empty(), "known sound {r:?}");
        }
        KIND_WIN | KIND_LOSE => assert_eq!(&r[1..], &[0, 0, 0, 0, 0], "{r:?}"),
        KIND_QUAKE => assert!(r[1] > 0, "earthquake strength {r:?}"),
        KIND_GOTO => assert_eq!(r[4..], [0, 0], "{r:?}"),
        other => panic!("unknown record kind {other}: {r:?}"),
    }
}

#[test]
fn a_drain_empties_the_queue() {
    let mut city = City::new(1);
    city.load_cty(HAIGHT).expect("haight.cty loads");
    city.take_messages();
    assert!(city.take_messages().is_empty());
}

#[test]
fn disastrous_run_sends_well_formed_messages() {
    let mut city = City::new(1);
    city.load_cty(HAIGHT).expect("haight.cty loads");
    city.enable_disasters(true);
    city.set_speed(3);
    let mut all = Vec::new();
    for _ in 0..3000 {
        city.tick();
        all.extend(city.take_messages());
    }
    let recs = records(&all);
    assert!(
        recs.iter().any(|r| r[0] == KIND_MESSAGE),
        "a 3000-tick haight run with disasters sends messages"
    );
    for r in &recs {
        assert_well_formed(r);
    }
}

#[test]
fn zones_without_power_send_the_electricity_message() {
    // An empty city with zones and no power plant (the events_power.tools scenario).
    let mut city = City::new(1);
    city.enable_disasters(false);
    city.set_speed(3);
    // Big tools are placed at the click only, so the zones are clicked one by one.
    for x in (20..60).step_by(3) {
        for y in (40..60).step_by(3) {
            city.tool_down(EditingTool::Residential as i32, x, y);
        }
    }
    city.take_messages();
    let mut all = Vec::new();
    for _ in 0..1500 {
        city.tick();
        all.extend(city.take_messages());
    }
    let recs = records(&all);
    assert!(
        recs.iter()
            .any(|r| r[0] == KIND_MESSAGE && r[1] == MESSAGE_NEED_ELECTRICITY),
        "unpowered zones: NEED_ELECTRICITY is sent, got {recs:?}"
    );
    let electricity = recs
        .iter()
        .find(|r| r[0] == KIND_MESSAGE && r[1] == MESSAGE_NEED_ELECTRICITY)
        .expect("checked above");
    // Not located: the engine sends it with no position and no picture.
    assert_eq!(electricity[2..], [-1, -1, 0, 0]);
}

#[test]
fn sound_names_are_known_for_known_indices_only() {
    let known: Vec<String> = (0..11).map(City::sound_name).collect();
    assert!(known.iter().all(|s| s.contains('/') && !s.is_empty()));
    assert_eq!(City::sound_name(11), "");
    assert_eq!(City::sound_name(-1), "");
    assert_eq!(City::sound_name(i32::MAX), "");
}
