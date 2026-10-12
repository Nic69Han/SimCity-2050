//! Rust twin of `reference/oracle.cpp`: prints the same lines per tick.
//! Usage: [ORACLE_DISASTERS=1] [ORACLE_SCRIPT=actions.tools] [ORACLE_NEWCITY=1] \
//!        cargo run --release --example fingerprint -- city.cty seed ticks
//! Compare: diff <(reference/build/oracle city.cty seed ticks) <(that command)
//!
//! With ORACLE_NEWCITY=1 the city is `new_random_city(seed)` (city.cty is ignored).
//!
//! With ORACLE_SCRIPT, player actions are applied before the tick they name and
//! printed as `act <tick> <index> result=<ToolResult or 0 for drag/budget/tax> funds=<funds>`,
//! exactly as the oracle does. Budget actions (`<tick> tax <rate>`,
//! `<tick> budget <road%> <fire%> <police%>`) print a `fin` line after each action and
//! every 100 ticks, as the oracle does.

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

/// The financial and evaluation line (`fin`), from the public budget/evaluation API.
fn fin_line(s: &Simulation, tick: usize) -> String {
    let b = s.budget_report();
    let e = s.evaluation_report();
    format!(
        "fin {tick} funds={} tax={} cashflow={} score={} class={} pop={} taxfund={} taxavg={} spend={}/{}/{} fund={}/{}/{} pct={:08x}/{:08x}/{:08x} yes={} delta={}",
        b.total_funds,
        b.tax_rate,
        b.cash_flow,
        e.score,
        e.class as i32,
        e.population,
        b.tax_fund,
        b.city_tax_average,
        b.road_spend,
        b.fire_spend,
        b.police_spend,
        b.road_fund,
        b.fire_fund,
        b.police_fund,
        b.road_percent.to_bits(),
        b.fire_percent.to_bits(),
        b.police_percent.to_bits(),
        e.yes_percent,
        e.score_delta,
    )
}

/// One player action of a `.tools` script.
enum Action {
    /// `<tick> down <tool> <x> <y>`
    Down {
        tick: usize,
        tool: EditingTool,
        x: i32,
        y: i32,
    },
    /// `<tick> drag <tool> <x0> <y0> <x1> <y1>`
    Drag {
        tick: usize,
        tool: EditingTool,
        x0: i32,
        y0: i32,
        x1: i32,
        y1: i32,
    },
    /// `<tick> tax <rate>` with rate 0..=20
    Tax { tick: usize, rate: i32 },
    /// `<tick> budget <road%> <fire%> <police%>` with percents 0..=100
    Budget {
        tick: usize,
        road: i32,
        fire: i32,
        police: i32,
    },
}

impl Action {
    fn tick(&self) -> usize {
        match self {
            Action::Down { tick, .. }
            | Action::Drag { tick, .. }
            | Action::Tax { tick, .. }
            | Action::Budget { tick, .. } => *tick,
        }
    }
}

/// Parses the script lines; `#` starts a comment. Exits on a malformed line.
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
        let act = match (f.get(1).copied(), f.len()) {
            (Some("down"), 5) => {
                let tool = EditingTool::from_index(num(2)).unwrap_or_else(|| bad());
                Action::Down {
                    tick,
                    tool,
                    x: num(3),
                    y: num(4),
                }
            }
            (Some("drag"), 7) => {
                let tool = EditingTool::from_index(num(2)).unwrap_or_else(|| bad());
                Action::Drag {
                    tick,
                    tool,
                    x0: num(3),
                    y0: num(4),
                    x1: num(5),
                    y1: num(6),
                }
            }
            (Some("tax"), 3) => {
                let rate = num(2);
                if !(0..=20).contains(&rate) {
                    bad()
                }
                Action::Tax { tick, rate }
            }
            (Some("budget"), 5) => {
                let (road, fire, police) = (num(2), num(3), num(4));
                if [road, fire, police].iter().any(|p| !(0..=100).contains(p)) {
                    bad()
                }
                Action::Budget {
                    tick,
                    road,
                    fire,
                    police,
                }
            }
            _ => bad(),
        };
        acts.push(act);
    }
    acts
}

fn apply_action(s: &mut Simulation, a: &Action, index: usize) {
    let result = match *a {
        Action::Down { tool, x, y, .. } => s.tool_down(tool, x, y) as i32,
        Action::Drag {
            tool,
            x0,
            y0,
            x1,
            y1,
            ..
        } => {
            s.tool_drag(tool, x0, y0, x1, y1);
            0
        }
        Action::Tax { rate, .. } => {
            s.set_tax_rate(rate);
            0
        }
        Action::Budget {
            road, fire, police, ..
        } => {
            s.set_budget_percents(road, fire, police);
            0
        }
    };
    println!(
        "act {} {index} result={result} funds={}",
        a.tick(),
        s.total_funds
    );
    println!("{}", fin_line(s, a.tick()));
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let seed: i32 = args[2].parse().unwrap();
    let ticks: usize = args[3].parse().unwrap();
    let mut s = Simulation::with_default_size();
    if std::env::var_os("ORACLE_NEWCITY").is_some() {
        // Same order as the oracle: generate, then the settings below.
        s.new_random_city(seed);
    } else {
        let bytes = std::fs::read(&args[1]).expect("read city");
        s.rng.seed(seed);
        s.load_cty(&bytes).expect("load");
    }
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
        while next < acts.len() && acts[next].tick() == t {
            apply_action(&mut s, &acts[next], next);
            next += 1;
        }
        if t > 0 {
            s.sim_tick();
        }
        println!("{}", fingerprint(&s, t));
        if t % 100 == 0 {
            println!("{}", fin_line(&s, t));
        }
    }
}
