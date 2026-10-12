//! Rust twin of `reference/oracle_events.cpp`: runs the simulation and prints, per tick,
//! the front-end events the page presents, in the same text format as the oracle.
//! Usage: [ORACLE_DISASTERS=1] [ORACLE_SCRIPT=actions.tools] \
//!        cargo run --release --example fingerprint_events -- <city.cty|gen> seed ticks
//! Compare: scripts/compare-events.sh
//!
//! Events are drained from `Simulation::drain_events()` after each action and after each
//! tick. Lines: `act <tick> <index> result=<r> funds=<f>`, `<tick> M <num> <x> <y> <pic> <imp>`,
//! `<tick> S <channel> <sound> <x> <y>`, `<tick> G <x> <y>`, `<tick> QUAKE <n>`,
//! `<tick> LOSE|WIN|NEW`.
//!
//! The C++ `toolDown()` wrapper sends NOT_ENOUGH_FUNDS / BULLDOZE_AREA_FIRST messages (and
//! their sounds) after `doTool()`; the core's `tool_down` does not (reported for tool.rs).
//! This driver applies that wrapper itself, as `oracle_events.cpp` does, so that the
//! streams can be compared.

use micropolis_core::events::Event;
use micropolis_core::message::{MESSAGE_BULLDOZE_AREA_FIRST, MESSAGE_NOT_ENOUGH_FUNDS};
use micropolis_core::simulation::{Simulation, NOWHERE};
use micropolis_core::tool::{EditingTool, ToolResult};

/// One player action of a `.tools` script.
struct Action {
    tick: usize,
    tool: EditingTool,
    /// `None` for `down`; `Some((x1, y1))` end point for `drag`.
    drag_to: Option<(i32, i32)>,
    x0: i32,
    y0: i32,
}

/// Parses `<tick> down <tool> <x> <y>` / `<tick> drag <tool> <x0> <y0> <x1> <y1>`
/// lines; `#` starts a comment. Exits on a malformed line (same syntax as oracle.cpp).
fn load_script(path: &str) -> Vec<Action> {
    let text = std::fs::read_to_string(path).expect("read script");
    let mut acts = Vec::new();
    for (lineno, raw) in text.lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let f: Vec<&str> = line.split_whitespace().collect();
        let bad = || -> ! {
            eprintln!("{path}:{}: bad action", lineno + 1);
            std::process::exit(2)
        };
        let num = |i: usize| -> i32 {
            f.get(i)
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| bad())
        };
        let tick = usize::try_from(num(0)).unwrap_or_else(|_| bad());
        let tool = EditingTool::from_index(num(2)).unwrap_or_else(|| bad());
        let act = match (f.get(1).copied(), f.len()) {
            (Some("down"), 5) => Action {
                tick,
                tool,
                drag_to: None,
                x0: num(3),
                y0: num(4),
            },
            (Some("drag"), 7) => Action {
                tick,
                tool,
                drag_to: Some((num(5), num(6))),
                x0: num(3),
                y0: num(4),
            },
            _ => bad(),
        };
        acts.push(act);
    }
    acts
}

/// Prints the recorded callbacks the page is interested in, in the oracle's format.
fn print_events(s: &mut Simulation, tick: usize) {
    for e in s.drain_events() {
        match e {
            Event::Message {
                number,
                x,
                y,
                picture,
                important,
            } => println!(
                "{tick} M {number} {x} {y} {} {}",
                u8::from(picture),
                u8::from(important)
            ),
            Event::Sound {
                channel,
                sound,
                x,
                y,
            } => println!("{tick} S {channel} {sound} {x} {y}"),
            Event::AutoGoto { x, y } => println!("{tick} G {x} {y}"),
            Event::StartEarthquake(n) => println!("{tick} QUAKE {n}"),
            Event::LoseGame => println!("{tick} LOSE"),
            Event::WinGame => println!("{tick} WIN"),
            Event::NewGame => println!("{tick} NEW"),
            _ => {}
        }
    }
}

/// The C++ `toolDown()` wrapper: the tool, then its UI-only message and sound.
fn tool_down_wrapped(s: &mut Simulation, tool: EditingTool, x: i32, y: i32) -> ToolResult {
    let result = s.tool_down(tool, x, y);
    match result {
        ToolResult::NeedBulldoze => {
            s.send_message(
                MESSAGE_BULLDOZE_AREA_FIRST,
                NOWHERE as i16,
                NOWHERE as i16,
                false,
                true,
            );
            s.make_sound("interface", "UhUh", x * 16, y * 16);
        }
        ToolResult::NoMoney => {
            s.send_message(
                MESSAGE_NOT_ENOUGH_FUNDS,
                NOWHERE as i16,
                NOWHERE as i16,
                false,
                true,
            );
            s.make_sound("interface", "Sorry", x * 16, y * 16);
        }
        _ => {}
    }
    result
}

fn apply_action(s: &mut Simulation, a: &Action, index: usize) {
    let result = match a.drag_to {
        None => tool_down_wrapped(s, a.tool, a.x0, a.y0) as i32,
        Some((x1, y1)) => {
            s.tool_drag(a.tool, a.x0, a.y0, x1, y1);
            0
        }
    };
    print_events(s, a.tick);
    println!(
        "act {} {index} result={result} funds={}",
        a.tick, s.total_funds
    );
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: fingerprint_events <city.cty|gen> seed ticks");
        std::process::exit(2);
    }
    let seed: i32 = args[2].parse().unwrap();
    let ticks: usize = args[3].parse().unwrap();
    let mut s = Simulation::with_default_size();
    if args[1] == "gen" {
        s.new_random_city(seed);
    } else {
        let bytes = std::fs::read(&args[1]).expect("read city");
        s.rng.seed(seed);
        s.load_cty(&bytes).expect("load");
    }
    // Same settings as reference/oracle_events.cpp, applied after the city exists.
    s.set_enable_disasters(std::env::var_os("ORACLE_DISASTERS").is_some());
    s.set_enable_sound(true);
    s.set_speed(3);
    s.set_passes(1);
    // Recording starts now: generation and load events are not part of the stream.
    s.drain_events();
    let acts = match std::env::var("ORACLE_SCRIPT") {
        Ok(path) => load_script(&path),
        Err(_) => Vec::new(),
    };
    let mut next = 0;
    for t in 0..=ticks {
        while next < acts.len() && acts[next].tick == t {
            apply_action(&mut s, &acts[next], next);
            next += 1;
        }
        if t > 0 {
            s.sim_tick();
        }
        print_events(&mut s, t);
    }
}
