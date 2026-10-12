//! Rust twin of `reference/oracle_load.cpp`: loads a city file with `Simulation::load_city`
//! (a plain `.cty` or an extended `MCTY` file), then one fingerprint line per tick (tick 0 =
//! right after loading), in the format of `fingerprint_gen`.
//!
//! Usage: [ORACLE_DISASTERS=1] cargo run --release --example fingerprint_load -- seed ticks file
//! Compare with reference/build/oracle_load_WxH on the payload of the same file (the file
//! without its 10-byte header; a 120x100 file is its own payload): scripts/compare-saveload.sh.

use micropolis_core::simulation::Simulation;

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

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: fingerprint_load seed ticks city_file");
        std::process::exit(2);
    }
    let seed: i32 = args[1].parse().expect("seed");
    let ticks: usize = args[2].parse().expect("ticks");
    let bytes = std::fs::read(&args[3]).unwrap_or_else(|e| {
        eprintln!("cannot read {}: {e}", args[3]);
        std::process::exit(2)
    });
    let mut s = Simulation::with_default_size();
    // The C++ constructor (simInit) leaves the start year 1900; load_city keeps it.
    s.starting_year = 1900;
    s.load_city(&bytes, seed).unwrap_or_else(|e| {
        eprintln!("load_city: {e}");
        std::process::exit(2)
    });
    // Same as reference/oracle_load.cpp: the disasters flag is set after loading.
    s.set_enable_disasters(std::env::var_os("ORACLE_DISASTERS").is_some());
    for t in 0..=ticks {
        if t > 0 {
            s.sim_tick();
        }
        println!("{}", fingerprint(&s, t));
    }
}
