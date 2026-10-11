//! Replays the action sequence of `reference/gold/tool_scenarios.cpp` on
//! `assets/cities/haight.cty` and compares every line with the output of the
//! ORIGINAL C++ engine (golden text below, produced by that harness).
//!
//! The sequence avoids the paths that still need unported modules
//! (`connectTile`, `isTree`, `smoothTreesAt`); see the module report for the
//! paths that are not covered yet.

use micropolis_core::simulation::Simulation;
use micropolis_core::tool::{EditingTool, ToolResult};
use std::fmt::Write;

const HAIGHT: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../assets/cities/haight.cty"
));

/// FNV-1a over the tile map, as `fnv()` in the C++ harness (column-major tiles).
fn map_hash(s: &Simulation) -> u64 {
    let mut h: u64 = 1_469_598_103_934_665_603;
    for &t in &s.tiles {
        h ^= u64::from(t & 0xff);
        h = h.wrapping_mul(1_099_511_628_211);
        h ^= u64::from(t >> 8);
        h = h.wrapping_mul(1_099_511_628_211);
    }
    h
}

fn state(s: &Simulation) -> String {
    format!(" funds={} hash={:016x}\n", s.total_funds, map_hash(s))
}

fn doit(out: &mut String, s: &mut Simulation, label: &str, tool: EditingTool, x: i32, y: i32) {
    let res = s.do_tool(tool, x, y);
    write!(out, "{label} x={x} y={y} res={}", res as i32).unwrap();
    if tool == EditingTool::Query && res == ToolResult::Ok {
        let z = s.do_zone_status(x, y).unwrap();
        let [a, b, c, d, e] = z.status;
        write!(out, " zone={}:{a},{b},{c},{d},{e}", z.category).unwrap();
    }
    out.push_str(&state(s));
}

fn drag(
    out: &mut String,
    s: &mut Simulation,
    label: &str,
    tool: EditingTool,
    from: (i32, i32),
    to: (i32, i32),
) {
    s.tool_drag(tool, from.0, from.1, to.0, to.1);
    write!(
        out,
        "drag {label} from={},{} to={},{}",
        from.0, from.1, to.0, to.1
    )
    .unwrap();
    out.push_str(&state(s));
}

fn down(out: &mut String, s: &mut Simulation, label: &str, tool: EditingTool, x: i32, y: i32) {
    s.tool_down(tool, x, y);
    write!(out, "down {label} x={x} y={y}").unwrap();
    out.push_str(&state(s));
}

fn bulldozer2(out: &mut String, s: &mut Simulation, x: i32, y: i32) {
    let res = s.bulldozer_tool(x, y);
    write!(out, "bulldozer2 x={x} y={y} res={}", res as i32).unwrap();
    out.push_str(&state(s));
}

fn window(out: &mut String, s: &Simulation, label: &str, (x0, y0): (i32, i32), (w, h): (i32, i32)) {
    for y in y0..y0 + h {
        write!(out, "{label} y={y}:").unwrap();
        for x in x0..x0 + w {
            write!(out, " {}", s.tile(x, y).unwrap()).unwrap();
        }
        out.push('\n');
    }
}

/// The steps of `tool_scenarios.cpp`, in the same order.
fn scenario() -> String {
    use EditingTool::*;

    let mut s = Simulation::with_default_size();
    s.load_cty(HAIGHT).unwrap();
    s.auto_bulldoze = true;
    s.do_animation = true;
    s.total_funds = 100_000;
    s.rng.seed(12345);
    let mut out = String::new();
    write!(out, "load").unwrap();
    out.push_str(&state(&s));

    // Query.
    for (x, y) in [
        (2, 68),
        (10, 2),
        (7, 10),
        (31, 88),
        (0, 0),
        (119, 99),
        (-1, 0),
        (120, 0),
        (50, 47),
        (93, 2),
        (0, 6),
    ] {
        doit(&mut out, &mut s, "query", Query, x, y);
    }

    // Park.
    doit(&mut out, &mut s, "park", Park, 7, 10);
    doit(&mut out, &mut s, "park", Park, 7, 10);
    doit(&mut out, &mut s, "park", Park, 31, 88);
    doit(&mut out, &mut s, "park", Park, 0, 6);
    doit(&mut out, &mut s, "park", Park, 0, 0);
    doit(&mut out, &mut s, "park", Park, 83, 60);
    doit(&mut out, &mut s, "park", Park, -1, 5);
    drag(&mut out, &mut s, "park", Park, (101, 76), (98, 70));
    drag(&mut out, &mut s, "park", Park, (115, 91), (115, 95));

    // Network.
    doit(&mut out, &mut s, "network", Network, 0, 6);
    doit(&mut out, &mut s, "network", Network, 0, 6);
    doit(&mut out, &mut s, "network", Network, 0, 7);
    doit(&mut out, &mut s, "network", Network, 2, 68);
    drag(&mut out, &mut s, "network", Network, (20, 20), (23, 25));
    s.total_funds = 5;
    doit(&mut out, &mut s, "network", Network, 0, 8);
    s.total_funds = 100_000;

    // Bulldozer on zone centres.
    doit(&mut out, &mut s, "bulldozer", Bulldozer, 10, 13);
    doit(&mut out, &mut s, "bulldozer", Bulldozer, 2, 68);
    doit(&mut out, &mut s, "bulldozer", Bulldozer, 6, 73);
    doit(&mut out, &mut s, "bulldozer", Bulldozer, -1, 0);
    s.total_funds = 0;
    doit(&mut out, &mut s, "bulldozer", Bulldozer, 10, 43);
    bulldozer2(&mut out, &mut s, 10, 43);
    s.total_funds = 100_000;

    // Water and land on zone centres.
    doit(&mut out, &mut s, "water", Water, 2, 87);
    doit(&mut out, &mut s, "land", Land, 6, 77);

    // Buildings that fail before any connect.
    doit(&mut out, &mut s, "residential", Residential, 1, 1);
    doit(&mut out, &mut s, "commercial", Commercial, 0, 0);
    doit(&mut out, &mut s, "industrial", Industrial, 119, 99);
    doit(&mut out, &mut s, "firestation", FireStation, 1, 1);
    doit(&mut out, &mut s, "policestation", PoliceStation, 2, 1);
    doit(&mut out, &mut s, "stadium", Stadium, 1, 1);
    doit(&mut out, &mut s, "seaport", Seaport, 119, 0);
    doit(&mut out, &mut s, "coalpower", CoalPower, 1, 99);
    doit(&mut out, &mut s, "airport", Airport, 1, 1);

    // Auto-bulldoze off: trees need a bulldozer first.
    s.auto_bulldoze = false;
    doit(&mut out, &mut s, "residential", Residential, 13, 28);
    drag(
        &mut out,
        &mut s,
        "residential",
        Residential,
        (1, 1),
        (13, 28),
    );
    s.auto_bulldoze = true;

    // toolDown: the messages are dropped, the state is unchanged.
    down(&mut out, &mut s, "residential", Residential, 1, 1);
    down(&mut out, &mut s, "park", Park, 0, 0);

    window(&mut out, &s, "win-a", (0, 0), (6, 4));
    window(&mut out, &s, "win-b", (9, 11), (6, 6));
    out
}

#[test]
fn tool_actions_match_original_engine() {
    let got = scenario();
    let mut got_lines = got.lines();
    let mut want_lines = EXPECTED.lines();
    let mut n = 0;
    loop {
        n += 1;
        match (got_lines.next(), want_lines.next()) {
            (None, None) => break,
            (g, w) => assert_eq!(g, w, "line {n} differs from the original engine"),
        }
    }
}

/// Golden output of `reference/gold/tool_scenarios.cpp` (the original engine).
const EXPECTED: &str = r#"load funds=100000 hash=127c3c57b6ba3a57
query x=2 y=68 res=1 zone=19:1,5,9,13,18 funds=100000 hash=127c3c57b6ba3a57
query x=10 y=2 res=1 zone=13:1,5,9,13,18 funds=100000 hash=127c3c57b6ba3a57
query x=7 y=10 res=1 zone=29:1,5,9,13,18 funds=100000 hash=127c3c57b6ba3a57
query x=31 y=88 res=1 zone=29:1,5,9,13,18 funds=100000 hash=127c3c57b6ba3a57
query x=0 y=0 res=1 zone=8:1,5,9,13,18 funds=100000 hash=127c3c57b6ba3a57
query x=119 y=99 res=1 zone=3:1,5,9,13,18 funds=100000 hash=127c3c57b6ba3a57
query x=-1 y=0 res=0 funds=100000 hash=127c3c57b6ba3a57
query x=120 y=0 res=0 funds=100000 hash=127c3c57b6ba3a57
query x=50 y=47 res=1 zone=12:1,5,9,13,18 funds=100000 hash=127c3c57b6ba3a57
query x=93 y=2 res=1 zone=20:1,5,9,13,18 funds=100000 hash=127c3c57b6ba3a57
query x=0 y=6 res=1 zone=3:1,5,9,13,18 funds=100000 hash=127c3c57b6ba3a57
park x=7 y=10 res=1 funds=99990 hash=1f18e27ab50728cd
park x=7 y=10 res=-1 funds=99990 hash=1f18e27ab50728cd
park x=31 y=88 res=1 funds=99980 hash=a54c7a70be1ec75c
park x=0 y=6 res=-1 funds=99980 hash=a54c7a70be1ec75c
park x=0 y=0 res=-1 funds=99980 hash=a54c7a70be1ec75c
park x=83 y=60 res=1 funds=99970 hash=e879fe2ec9b67d19
park x=-1 y=5 res=0 funds=99970 hash=e879fe2ec9b67d19
drag park from=101,76 to=98,70 funds=99960 hash=26214d557ff64160
drag park from=115,91 to=115,95 funds=99950 hash=2dc344e2d9f8d22f
network x=0 y=6 res=1 funds=99849 hash=3cfd032f9a84de8a
network x=0 y=6 res=-1 funds=99849 hash=3cfd032f9a84de8a
network x=0 y=7 res=1 funds=99748 hash=915e124a7b6a8b98
network x=2 y=68 res=-1 funds=99748 hash=915e124a7b6a8b98
drag network from=20,20 to=23,25 funds=99445 hash=93e73b0672b0fcc5
network x=0 y=8 res=-2 funds=5 hash=93e73b0672b0fcc5
bulldozer x=10 y=13 res=1 funds=99999 hash=c338f2a253551e7d
bulldozer x=2 y=68 res=1 funds=99998 hash=b32056196c246263
bulldozer x=6 y=73 res=1 funds=99997 hash=0a398625975a8af2
bulldozer x=-1 y=0 res=0 funds=99997 hash=0a398625975a8af2
bulldozer x=10 y=43 res=-2 funds=0 hash=0a398625975a8af2
bulldozer2 x=10 y=43 res=1 funds=-1 hash=077fc62acbb6396e
water x=2 y=87 res=1 funds=99999 hash=d9b9cc201d67eb0b
land x=6 y=77 res=1 funds=99998 hash=c2eb07c5a5453daa
residential x=1 y=1 res=-1 funds=99998 hash=c2eb07c5a5453daa
commercial x=0 y=0 res=0 funds=99998 hash=c2eb07c5a5453daa
industrial x=119 y=99 res=0 funds=99998 hash=c2eb07c5a5453daa
firestation x=1 y=1 res=-1 funds=99998 hash=c2eb07c5a5453daa
policestation x=2 y=1 res=-1 funds=99998 hash=c2eb07c5a5453daa
stadium x=1 y=1 res=-1 funds=99998 hash=c2eb07c5a5453daa
seaport x=119 y=0 res=0 funds=99998 hash=c2eb07c5a5453daa
coalpower x=1 y=99 res=0 funds=99998 hash=c2eb07c5a5453daa
airport x=1 y=1 res=-1 funds=99998 hash=c2eb07c5a5453daa
residential x=13 y=28 res=-1 funds=99998 hash=c2eb07c5a5453daa
drag residential from=1,1 to=13,28 funds=99998 hash=c2eb07c5a5453daa
down residential x=1 y=1 funds=99998 hash=c2eb07c5a5453daa
down park x=0 y=0 funds=99998 hash=c2eb07c5a5453daa
win-a y=0: 12354 12354 12354 12354 12354 12354
win-a y=1: 12328 12328 12328 12324 12309 12325
win-a y=2: 12329 12328 12324 12325 12325 12311
win-a y=3: 12328 12324 12325 12321 12313 12320
win-b y=11: 12323 61651 15178 12330 12331 12329
win-b y=12: 7005 7005 7004 12331 61680 61681
win-b y=13: 7006 7005 7005 15178 57587 58612
win-b y=14: 7006 7004 7006 61650 61686 61687
win-b y=15: 12354 61517 12354 12354 12354 12354
win-b y=16: 57830 57831 57832 57659 57660 57661
"#;
