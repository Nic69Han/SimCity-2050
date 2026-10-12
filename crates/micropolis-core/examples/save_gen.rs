//! Writes a city file of a new random city, as the differential load test needs it:
//! `new_random_city(seed)` on a `W` x `H` map, a starter-like build (a road cross, zones,
//! power, services placed at the first free spot near the centre), then `ticks` ticks at
//! speed 3 with one pass. The output is `save_city()` (a plain `.cty` for 120x100, an
//! extended file otherwise) on stdout; the placements are reported on stderr.
//!
//! Usage: save_gen W H seed ticks > city.bin
//!        save_gen --from city.cty seed ticks > city.bin   (a city file loaded, then run on)

use micropolis_core::simulation::Simulation;
use micropolis_core::tool::{EditingTool, ToolResult};
use std::io::Write;

/// Places `tool` at the first spot, nearest to `(cx, cy)` (searched within `radius`), where
/// `tool_preview` says it would be built. Reports the outcome on stderr.
fn place(s: &mut Simulation, tool: EditingTool, cx: i32, cy: i32, radius: i32) {
    let mut spots: Vec<(i32, i32)> = (-radius..=radius)
        .flat_map(|dy| (-radius..=radius).map(move |dx| (dx, dy)))
        .collect();
    spots.sort_by_key(|&(dx, dy)| dx * dx + dy * dy);
    for (dx, dy) in spots {
        let (x, y) = (cx + dx, cy + dy);
        if s.tool_preview(tool, x, y).result == ToolResult::Ok {
            let result = s.tool_down(tool, x, y);
            eprintln!("{tool:?} at {x},{y}: {}", result as i32);
            return;
        }
    }
    eprintln!("{tool:?} near {cx},{cy}: no spot");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let parse = |i: usize| -> i64 { args.get(i).and_then(|a| a.parse().ok()).expect("a number") };
    let usage = || -> ! {
        eprintln!("usage: save_gen W H seed ticks | save_gen --from city.cty seed ticks");
        std::process::exit(2)
    };
    if args.len() == 5 && args[1] == "--from" {
        // A city file (a plain .cty: 120x100) loaded with the seed, then run on, then saved.
        let bytes = std::fs::read(&args[2]).unwrap_or_else(|e| {
            eprintln!("cannot read {}: {e}", args[2]);
            std::process::exit(2)
        });
        let seed = args[3].parse().expect("a number");
        let ticks = args[4].parse().expect("a number");
        let mut s = Simulation::with_default_size();
        s.starting_year = 1900;
        s.load_city(&bytes, seed).expect("a city file");
        run(&mut s, ticks);
        emit(&s);
        return;
    }
    if args.len() != 5 {
        usage();
    }
    let (w, h) = (parse(1) as i32, parse(2) as i32);
    let seed = parse(3) as i32;
    let ticks = parse(4) as usize;

    let mut s = Simulation::new(w, h);
    s.new_random_city(seed);
    s.set_speed(3);
    s.set_passes(1);
    let (cx, cy) = (w / 2, h / 2);
    // Roads, with power lines along the same tiles (a wire on a road is a crossing): zones
    // need both to grow.
    s.tool_drag(EditingTool::Road, cx - 15, cy, cx + 15, cy);
    s.tool_drag(EditingTool::Road, cx, cy - 10, cx, cy + 10);
    s.tool_drag(EditingTool::Wire, cx - 15, cy, cx + 15, cy);
    s.tool_drag(EditingTool::Wire, cx, cy - 10, cx, cy + 10);
    // Zones next to the road cross (a 3x3 zone centred 2 tiles off a road touches it).
    place(&mut s, EditingTool::Residential, cx - 8, cy - 2, 3);
    place(&mut s, EditingTool::Residential, cx + 8, cy + 2, 3);
    place(&mut s, EditingTool::Residential, cx - 2, cy - 6, 3);
    place(&mut s, EditingTool::Commercial, cx + 12, cy - 2, 3);
    place(&mut s, EditingTool::Industrial, cx - 12, cy + 2, 3);
    place(&mut s, EditingTool::CoalPower, cx - 18, cy - 3, 3);
    place(&mut s, EditingTool::Park, cx + 3, cy + 6, 4);
    place(&mut s, EditingTool::FireStation, cx + 8, cy - 6, 4);
    place(&mut s, EditingTool::PoliceStation, cx - 3, cy + 7, 4);
    run(&mut s, ticks);
    emit(&s);
}

fn run(s: &mut Simulation, ticks: usize) {
    s.set_speed(3);
    s.set_passes(1);
    for _ in 0..ticks {
        s.sim_tick();
    }
}

fn emit(s: &Simulation) {
    std::io::stdout()
        .write_all(&s.save_city())
        .expect("write the city file");
}
