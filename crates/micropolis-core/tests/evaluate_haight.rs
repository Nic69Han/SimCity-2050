//! Golden test of `cityEvaluation` on the real city `assets/cities/haight.cty`.
//!
//! `tests/data/evaluate_haight.txt` was written by `reference/gold/evaluate_haight.cpp`
//! (through the fixed-slot oracle, see `reference/gold/build-fixed-oracle.sh`).
//! For each snapshot it holds the evaluation inputs of the ORIGINAL engine
//! (census, density maps, RNG state) and the outputs of the original
//! `cityEvaluation()`. The census values are taken as inputs because the
//! census, load and simulation modules are not part of this port yet.

use micropolis_core::simulation::Simulation;
use std::collections::BTreeMap;

const GOLD: &str = include_str!("data/evaluate_haight.txt");
const LV_W: i32 = 60;
const LV_H: i32 = 50;

type Block = BTreeMap<String, Vec<i64>>;

fn blocks() -> Vec<(i64, Block)> {
    let mut out = Vec::new();
    let mut tick = 0;
    let mut cur: Option<Block> = None;
    for line in GOLD.lines() {
        let mut parts = line.split_whitespace();
        let Some(key) = parts.next() else { continue };
        if key == "snapshot" {
            tick = parts.next().unwrap().parse().unwrap();
            cur = Some(BTreeMap::new());
        } else if key == "end" {
            out.push((tick, cur.take().unwrap()));
        } else {
            let vals = parts.map(|v| v.parse::<i64>().unwrap()).collect();
            cur.as_mut().unwrap().insert(key.to_string(), vals);
        }
    }
    out
}

fn one(b: &Block, key: &str) -> i64 {
    b[key][0]
}

fn load(b: &Block) -> Simulation {
    let mut s = Simulation::new(120, 100);
    s.total_pop = one(b, "totalPop") as i16;
    s.res_pop = one(b, "resPop") as i16;
    s.com_pop = one(b, "comPop") as i16;
    s.ind_pop = one(b, "indPop") as i16;
    s.fire_pop = one(b, "firePop") as i16;
    s.road_total = one(b, "roadTotal") as i16;
    s.rail_total = one(b, "railTotal") as i16;
    s.police_station_pop = one(b, "policeStationPop") as i16;
    s.fire_station_pop = one(b, "fireStationPop") as i16;
    s.hospital_pop = one(b, "hospitalPop") as i16;
    s.stadium_pop = one(b, "stadiumPop") as i16;
    s.seaport_pop = one(b, "seaportPop") as i16;
    s.airport_pop = one(b, "airportPop") as i16;
    s.coal_power_pop = one(b, "coalPowerPop") as i16;
    s.nuclear_power_pop = one(b, "nuclearPowerPop") as i16;
    s.crime_average = one(b, "crimeAverage") as i16;
    s.pollution_average = one(b, "pollutionAverage") as i16;
    s.land_value_average = one(b, "landValueAverage") as i16;
    s.city_tax = one(b, "cityTax") as i16;
    s.city_pop = one(b, "cityPop");
    s.city_pop_delta = one(b, "cityPopDelta");
    s.powered_zone_count = one(b, "poweredZoneCount") as i16;
    s.unpowered_zone_count = one(b, "unpoweredZoneCount") as i16;
    s.res_valve = one(b, "resValve") as i16;
    s.com_valve = one(b, "comValve") as i16;
    s.ind_valve = one(b, "indValve") as i16;
    s.res_cap = one(b, "resCap") != 0;
    s.com_cap = one(b, "comCap") != 0;
    s.ind_cap = one(b, "indCap") != 0;
    s.road_effect = one(b, "roadEffect") as i32;
    s.police_effect = one(b, "policeEffect") as i32;
    s.fire_effect = one(b, "fireEffect") as i32;
    s.city_score = one(b, "cityScore") as i16;
    s.rng.seed(one(b, "rng") as u32 as i32);
    for x in 0..LV_W {
        for y in 0..LV_H {
            let i = (x * LV_H + y) as usize;
            s.land_value_map.set(x, y, b["lv"][i] as u8);
            s.traffic_density_map.set(x, y, b["tr"][i] as u8);
        }
    }
    s
}

#[test]
fn city_evaluation_matches_original_on_haight() {
    let all = blocks();
    assert_eq!(all.len(), 4, "snapshot count");
    for (tick, b) in &all {
        let mut s = load(b);
        s.city_evaluation();
        let ctx = |k: &str| format!("tick {tick}: {k}");
        assert_eq!(
            s.city_yes as i64,
            one(b, "out_cityYes"),
            "{}",
            ctx("cityYes")
        );
        assert_eq!(
            s.city_score as i64,
            one(b, "out_cityScore"),
            "{}",
            ctx("cityScore")
        );
        assert_eq!(
            s.city_score_delta as i64,
            one(b, "out_cityScoreDelta"),
            "{}",
            ctx("cityScoreDelta")
        );
        assert_eq!(s.city_pop, one(b, "out_cityPop"), "{}", ctx("cityPop"));
        assert_eq!(
            s.city_pop_delta,
            one(b, "out_cityPopDelta"),
            "{}",
            ctx("cityPopDelta")
        );
        assert_eq!(
            s.city_class as i64,
            one(b, "out_cityClass"),
            "{}",
            ctx("cityClass")
        );
        assert_eq!(
            s.city_assessed_value,
            one(b, "out_cityAssessedValue"),
            "{}",
            ctx("cityAssessedValue")
        );
        assert_eq!(
            s.traffic_average as i64,
            one(b, "out_trafficAverage"),
            "{}",
            ctx("trafficAverage")
        );
        assert_eq!(
            s.eval_changed as i64,
            one(b, "out_evalChanged"),
            "{}",
            ctx("evalChanged")
        );
        let votes: Vec<i64> = s.problem_votes.iter().map(|&v| v as i64).collect();
        assert_eq!(votes, b["out_problemVotes"], "{}", ctx("problemVotes"));
        let order: Vec<i64> = s.problem_order.iter().map(|&v| v as i64).collect();
        assert_eq!(order, b["out_problemOrder"], "{}", ctx("problemOrder"));
        assert_eq!(
            s.rng.random16() as i64,
            one(b, "out_rng"),
            "{}",
            ctx("rng after")
        );
    }
}
