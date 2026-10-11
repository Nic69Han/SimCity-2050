//! Rust twin of `reference/oracle_gen.cpp`: a new random city, then one fingerprint
//! line per tick (tick 0 = right after generation), in the same format as `fingerprint`.
//! Usage: [ORACLE_DISASTERS=1] cargo run --release --example fingerprint_gen -- seed ticks [some|map]
//! (`some`: `new_random_city(seed)`; `map`: `generate_map()` with the generator seeded by `seed`.)
//! Compare: diff <(reference/build/oracle_gen seed ticks) <(that command)

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
    if args.len() < 3 {
        eprintln!("usage: fingerprint_gen seed ticks [some|map]");
        std::process::exit(2);
    }
    let seed: i32 = args[1].parse().unwrap();
    let ticks: usize = args[2].parse().unwrap();
    let mut s = Simulation::with_default_size();
    if args.get(3).map(String::as_str) == Some("map") {
        // The oracle's constructor leaves the generator seeded with `seed`; generateMap()
        // then draws its seed from it.
        s.sim_init();
        s.rng.seed(seed);
        s.generate_map();
    } else {
        s.new_random_city(seed);
    }
    // Same settings as reference/oracle_gen.cpp, applied after generation.
    s.set_enable_disasters(std::env::var_os("ORACLE_DISASTERS").is_some());
    s.set_speed(3);
    s.set_passes(1);
    for t in 0..=ticks {
        if t > 0 {
            s.sim_tick();
        }
        println!("{}", fingerprint(&s, t));
    }
}
