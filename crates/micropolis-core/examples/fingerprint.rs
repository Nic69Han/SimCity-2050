//! Rust twin of `reference/oracle.cpp`: prints the same fingerprint line per tick.
//! Usage: [ORACLE_DISASTERS=1] cargo run --release --example fingerprint -- city.cty seed ticks
//! Compare: diff <(reference/build/oracle city.cty seed ticks) <(that command)

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
    for t in 0..=ticks {
        if t > 0 {
            s.sim_tick();
        }
        println!("{}", fingerprint(&s, t));
    }
}
