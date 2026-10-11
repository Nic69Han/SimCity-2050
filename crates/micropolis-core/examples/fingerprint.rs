//! Rust twin of `reference/oracle.cpp`: prints the same fingerprint line per tick.
//! Usage: [ORACLE_DISASTERS=1] [ORACLE_SCRIPT=actions.tools] cargo run --release --example fingerprint -- city.cty seed ticks
//! Compare: diff <(reference/build/oracle city.cty seed ticks) <(that command)
//!
//! With ORACLE_SCRIPT, player actions are applied before the tick they name and
//! printed as `act <tick> <index> result=<ToolResult or 0 for drag> funds=<funds>`,
//! exactly as the oracle does.

use micropolis_core::simulation::Simulation;
use micropolis_core::tool::EditingTool;

fn fingerprint(s: &Simulation, tick: usize) -> String {
    let mut h: u64 = 1_469_598_103_934_665_603;
    for &w in &s.tiles {
        h ^= (w & 0xff) as u64;
        h = h.wrapping_mul(1_099_511_628_211);
        h ^= (w >> 8) as u64;
        h = h.wrapping_mul(1_099_511_628_211);
    }
    format!(
        "tick {tick} time={} funds={} pop={} res={} com={} ind={} resV={} comV={} indV={} \
         crime={} poll={} lv={} traf={} maphash={h:016x}",
        s.city_time,
        s.total_funds,
        s.total_pop,
        s.res_pop,
        s.com_pop,
        s.ind_pop,
        s.res_valve,
        s.com_valve,
        s.ind_valve,
        s.crime_average,
        s.pollution_average,
        s.land_value_average,
        s.traffic_average,
    )
}

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
/// lines; `#` starts a comment. Exits on a malformed line.
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
        let tick = num(0);
        let tool = EditingTool::from_index(num(2)).unwrap_or_else(|| bad());
        let tick = usize::try_from(tick).unwrap_or_else(|_| bad());
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

fn apply_action(s: &mut Simulation, a: &Action, index: usize) {
    let result = match a.drag_to {
        None => s.tool_down(a.tool, a.x0, a.y0) as i32,
        Some((x1, y1)) => {
            s.tool_drag(a.tool, a.x0, a.y0, x1, y1);
            0
        }
    };
    println!(
        "act {} {index} result={result} funds={}",
        a.tick, s.total_funds
    );
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&args[1]).expect("read city");
    let seed: i32 = args[2].parse().unwrap();
    let ticks: usize = args[3].parse().unwrap();
    let mut s = Simulation::with_default_size();
    s.rng.seed(seed);
    s.load_cty(&bytes).expect("load");
    // env ORACLE_DISASTERS=1 enables disasters, as in the C++ oracle.
    s.enable_disasters = std::env::var_os("ORACLE_DISASTERS").is_some();
    s.sim_speed = 3;
    s.sim_passes = 1;
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
        println!("{}", fingerprint(&s, t));
    }
}
