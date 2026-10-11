//! Golden test for utilities.cpp, update.cpp, message.cpp (sendMessages,
//! doScenarioScore, doMakeSound), graph.cpp and stubs.cpp.
//!
//! The expected log is `reference/gold/misc_events.out`, produced by
//! `reference/gold/misc_events.cpp` against the original engine:
//!   reference/build-harness.sh reference/gold/misc_events.cpp reference/build/misc_events
//!   reference/build/misc_events > reference/gold/misc_events.out
//! This file replays the same steps on the Rust port and must print the same lines.
//! The steps and their format strings mirror the harness one for one.

use micropolis_core::events::{Event, Update};
use micropolis_core::simulation::{CityClass, GameLevel, Scenario, Simulation};

fn drain(s: &mut Simulation, out: &mut Vec<String>) {
    for e in s.drain_events() {
        out.push(match e {
            Event::Updated(u) => format!(
                "U {}",
                match u {
                    Update::Map => "map",
                    Update::History => "history",
                    Update::Date => "date",
                    Update::Demand => "demand",
                    Update::Paused => "paused",
                    Update::Speed => "speed",
                    Update::Passes => "passes",
                    Update::GameLevel => "gameLevel",
                    Update::CityName => "cityName",
                }
            ),
            Event::FundsChanged(_) => "U funds".to_string(),
            Event::OptionsChanged => "U options".to_string(),
            Event::Message {
                number,
                x,
                y,
                picture,
                important,
            } => format!(
                "M {} {} {} {} {}",
                number, x, y, picture as i32, important as i32
            ),
            Event::Sound {
                channel,
                sound,
                x,
                y,
            } => format!("S {channel} {sound} {x} {y}"),
            Event::AutoGoto { x, y } => format!("G {x} {y}"),
            Event::StartEarthquake(n) => format!("QUAKE {n}"),
            Event::WinGame => "WIN".to_string(),
            Event::LoseGame => "LOSE".to_string(),
            Event::NewGame => "NEW".to_string(),
            other => format!("?? {other:?}"),
        });
    }
}

fn class_of(i: u8) -> CityClass {
    match i {
        0 => CityClass::Village,
        1 => CityClass::Town,
        2 => CityClass::City,
        3 => CityClass::Capital,
        4 => CityClass::Metropolis,
        _ => CityClass::Megalopolis,
    }
}

fn scenario_of(i: i32) -> Scenario {
    match i {
        0 => Scenario::None,
        1 => Scenario::Dullsville,
        2 => Scenario::SanFrancisco,
        3 => Scenario::Hamburg,
        4 => Scenario::Bern,
        5 => Scenario::Tokyo,
        6 => Scenario::Detroit,
        7 => Scenario::Boston,
        _ => Scenario::Rio,
    }
}

/// `resetState` + the zeroing block of `setCensus` in the harness.
fn set_census(s: &mut Simulation, preset: i32) {
    s.scenario = Scenario::None;
    s.score_type = Scenario::None;
    s.score_wait = 0;
    s.city_class = CityClass::Village;
    s.traffic_average = 0;
    s.crime_average = 0;
    s.city_score = 500;
    s.city_pop_last = 0;
    s.category_last = 0;

    s.res_pop = 0;
    s.com_pop = 0;
    s.ind_pop = 0;
    s.stadium_pop = 0;
    s.seaport_pop = 0;
    s.airport_pop = 0;
    s.res_zone_pop = 0;
    s.com_zone_pop = 0;
    s.ind_zone_pop = 0;
    s.road_total = 0;
    s.rail_total = 0;
    s.powered_zone_count = 0;
    s.unpowered_zone_count = 0;
    s.pollution_average = 0;
    s.crime_average = 0;
    s.traffic_average = 0;
    s.total_pop = 0;
    s.fire_station_pop = 0;
    s.police_station_pop = 0;
    s.city_tax = 7;
    s.road_effect = 32;
    s.fire_effect = 1000;
    s.police_effect = 1000;
    s.nuclear_power_pop = 0;
    s.coal_power_pop = 0;
    s.res_cap = false;
    s.com_cap = false;
    s.ind_cap = false;

    match preset {
        0 => {}
        1 => {
            s.res_pop = 600;
            s.com_pop = 150;
            s.ind_pop = 80;
            s.res_zone_pop = 10;
            s.com_zone_pop = 3;
            s.ind_zone_pop = 2;
            s.road_total = 50;
            s.rail_total = 10;
            s.powered_zone_count = 3;
            s.unpowered_zone_count = 5;
            s.pollution_average = 70;
            s.crime_average = 120;
            s.traffic_average = 70;
            s.total_pop = 70;
            s.city_tax = 13;
            s.road_effect = 10;
            s.fire_effect = 600;
            s.police_effect = 600;
        }
        2 => {
            s.res_pop = 100;
            s.stadium_pop = 5;
            s.com_pop = 10;
            s.airport_pop = 3;
            s.ind_pop = 10;
            s.seaport_pop = 2;
            s.res_zone_pop = 400;
            s.com_zone_pop = 100;
            s.ind_zone_pop = 50;
            s.road_total = 20;
            s.rail_total = 500;
            s.powered_zone_count = 10;
            s.unpowered_zone_count = 0;
            s.pollution_average = 30;
            s.crime_average = 50;
            s.traffic_average = 10;
            s.total_pop = 1000;
            s.fire_station_pop = 2;
            s.police_station_pop = 3;
            s.city_tax = 5;
            s.road_effect = 20;
            s.fire_effect = 900;
            s.police_effect = 999;
        }
        3 => {
            s.res_pop = 0;
            s.com_pop = 300;
            s.ind_pop = 100;
            s.res_zone_pop = 0;
            s.com_zone_pop = 20;
            s.ind_zone_pop = 0;
            s.powered_zone_count = 7;
            s.unpowered_zone_count = 3;
            s.total_pop = 21;
            s.road_total = 31;
            s.road_effect = 19;
            s.fire_effect = 699;
            s.police_effect = 700;
            s.city_tax = 12;
        }
        4 => {
            s.nuclear_power_pop = 1;
            s.coal_power_pop = 0;
            s.res_zone_pop = 40;
            s.com_zone_pop = 25;
            s.ind_zone_pop = 10;
            s.crime_average = 101;
            s.pollution_average = 61;
            s.traffic_average = 61;
            s.total_pop = 61;
            s.fire_station_pop = 0;
            s.police_station_pop = 0;
            s.ind_pop = 71;
            s.seaport_pop = 0;
            s.com_pop = 101;
            s.airport_pop = 0;
            s.res_pop = 501;
            s.stadium_pop = 0;
        }
        5 => {
            s.scenario = Scenario::Bern;
            s.score_type = Scenario::Bern;
            s.score_wait = 3;
            s.traffic_average = 79;
            s.res_pop = 9;
            s.total_pop = 9;
        }
        _ => unreachable!(),
    }
}

fn run() -> Vec<String> {
    let mut out = Vec::new();
    let mut s = Simulation::with_default_size();
    // Same pinned "last shown" values as the harness.
    s.city_time_last = -1;
    s.city_year_last = -1;
    s.city_month_last = -1;
    s.total_funds_last = -1;
    s.res_last = -999_999;
    s.com_last = -999_999;
    s.ind_last = -999_999;
    s.must_update_funds = false;
    s.valve_flag = false;

    // ---- setSpeed clamping, paused or not ----
    for paused in 0..=1 {
        for v in -2..=5i16 {
            s.sim_paused = paused != 0;
            s.sim_speed_meta = 0;
            s.sim_speed = 0;
            s.sim_paused_speed = 3;
            out.push(format!("SPEED p={paused} v={v}"));
            s.set_speed(v);
            drain(&mut s, &mut out);
            out.push(format!(
                "SPEED-STATE meta={} speed={} pausedSpeed={}",
                s.sim_speed_meta, s.sim_speed, s.sim_paused_speed
            ));
        }
    }

    // ---- pause / resume ----
    s.sim_paused = false;
    s.sim_speed_meta = 0;
    s.sim_speed = 0;
    s.sim_paused_speed = 3;
    s.set_speed(2);
    drain(&mut s, &mut out);
    out.push(format!(
        "PR setSpeed(2) meta={} speed={}",
        s.sim_speed_meta, s.sim_speed
    ));
    s.pause();
    drain(&mut s, &mut out);
    out.push(format!(
        "PR pause meta={} speed={} pausedSpeed={} paused={}",
        s.sim_speed_meta, s.sim_speed, s.sim_paused_speed, s.sim_paused as i32
    ));
    s.pause();
    drain(&mut s, &mut out);
    out.push(format!(
        "PR pause2 meta={} speed={} pausedSpeed={} paused={}",
        s.sim_speed_meta, s.sim_speed, s.sim_paused_speed, s.sim_paused as i32
    ));
    s.set_speed(3);
    drain(&mut s, &mut out);
    out.push(format!(
        "PR setSpeed(3) while paused meta={} speed={} pausedSpeed={}",
        s.sim_speed_meta, s.sim_speed, s.sim_paused_speed
    ));
    s.resume();
    drain(&mut s, &mut out);
    out.push(format!(
        "PR resume meta={} speed={} pausedSpeed={} paused={}",
        s.sim_speed_meta, s.sim_speed, s.sim_paused_speed, s.sim_paused as i32
    ));
    s.resume();
    drain(&mut s, &mut out);
    out.push(format!(
        "PR resume2 meta={} speed={} paused={}",
        s.sim_speed_meta, s.sim_speed, s.sim_paused as i32
    ));

    // ---- passes, game level, city name ----
    s.set_passes(5);
    drain(&mut s, &mut out);
    out.push(format!(
        "PASSES passes={} pass={}",
        s.sim_passes, s.sim_pass
    ));
    s.set_game_level(GameLevel::Hard);
    drain(&mut s, &mut out);
    out.push(format!("LEVEL {}", GameLevel::Hard as i32));
    s.set_city_name("San Fran-cisco 2!");
    drain(&mut s, &mut out);
    out.push(format!("CITYNAME [{}]", s.city_name));
    s.set_city_name("");
    drain(&mut s, &mut out);
    out.push(format!("CITYNAME [{}]", s.city_name));
    s.set_clean_city_name("Ab_c");
    drain(&mut s, &mut out);
    out.push(format!("CITYNAME [{}]", s.city_name));

    // ---- setYear / currentYear ----
    s.starting_year = 1990;
    for t in [0i64, 47, 48, 95, 4800, 100_000] {
        for y in [1900i32, 1990, 2000, 2050] {
            s.city_time = t;
            s.set_year(y);
            drain(&mut s, &mut out);
            out.push(format!(
                "YEAR t={t} y={y} -> time={} cityYear={} cityMonth={} cur={}",
                s.city_time,
                s.city_year,
                s.city_month,
                s.current_year()
            ));
        }
    }

    // ---- option flags are flushed once ----
    s.must_update_options = false;
    s.set_enable_disasters(false);
    s.set_auto_budget(false);
    s.set_auto_bulldoze(true);
    s.set_auto_goto(true);
    s.set_enable_sound(true);
    s.set_do_animation(false);
    s.set_do_messages(false);
    s.set_do_notices(true);
    s.update_options();
    drain(&mut s, &mut out);
    out.push(format!(
        "OPT dis={} budget={} bull={} goto={} sound={} anim={} msg={} notice={}",
        s.enable_disasters as i32,
        s.auto_budget as i32,
        s.auto_bulldoze as i32,
        s.auto_goto as i32,
        s.enable_sound as i32,
        s.do_animation as i32,
        s.do_messages as i32,
        s.do_notices as i32
    ));
    s.update_options();
    drain(&mut s, &mut out);
    out.push("OPT-again".to_string());
    s.enable_sound = false;

    // ---- funds ----
    s.total_funds = 20_000;
    s.total_funds_last = -1;
    s.must_update_funds = false;
    s.update_funds();
    s.really_update_funds();
    drain(&mut s, &mut out);
    out.push(format!(
        "FUNDS 1 total={} last={}",
        s.total_funds, s.total_funds_last
    ));
    s.really_update_funds();
    drain(&mut s, &mut out);
    s.spend(1500);
    s.really_update_funds();
    drain(&mut s, &mut out);
    out.push(format!("FUNDS 2 total={}", s.total_funds));
    s.set_funds(7);
    s.update_funds();
    s.really_update_funds();
    s.update_funds();
    s.really_update_funds();
    drain(&mut s, &mut out);
    out.push(format!(
        "FUNDS 3 total={} last={}",
        s.total_funds, s.total_funds_last
    ));

    // ---- updateDate ----
    let dates: [i64; 10] = [
        0,
        1,
        3,
        4,
        47,
        48,
        50,
        4799,
        100_000,
        48 * (1_000_000 - 1990 + 3),
    ];
    for t in dates {
        s.city_time = t;
        s.city_time_last = -1;
        s.city_year_last = -1;
        s.city_month_last = -1;
        s.update_date();
        drain(&mut s, &mut out);
        out.push(format!(
            "DATE t={t} -> time={} timeLast={} year={} month={} yearLast={} monthLast={}",
            s.city_time,
            s.city_time_last,
            s.city_year,
            s.city_month,
            s.city_year_last,
            s.city_month_last
        ));
    }

    // ---- valves (drawValve clamps to +-1500) and updateHeads ----
    let valves: [(i16, i16, i16); 5] = [
        (0, 0, 0),
        (-3000, 1500, 700),
        (1500, -1500, -1499),
        (17, 17, 17),
        (2600, -7, 0),
    ];
    for (r, c, i) in valves {
        s.res_valve = r;
        s.com_valve = c;
        s.ind_valve = i;
        s.valve_flag = true;
        s.show_valves();
        drain(&mut s, &mut out);
        out.push(format!(
            "VALVE r={r} c={c} i={i} -> last {} {} {} flag={}",
            s.res_last, s.com_last, s.ind_last, s.valve_flag as i32
        ));
        s.show_valves();
        drain(&mut s, &mut out);
    }
    s.res_valve = 1200;
    s.com_valve = -400;
    s.ind_valve = 90;
    s.update_heads();
    drain(&mut s, &mut out);
    out.push(format!(
        "HEADS last {} {} {} timeLast={} yearLast={} monthLast={} fundsLast={}",
        s.res_last,
        s.com_last,
        s.ind_last,
        s.city_time_last,
        s.city_year_last,
        s.city_month_last,
        s.total_funds_last
    ));

    // ---- graphs ----
    {
        let arrays: [&mut Vec<i16>; 6] = [
            &mut s.res_hist,
            &mut s.com_hist,
            &mut s.ind_hist,
            &mut s.money_hist,
            &mut s.crime_hist,
            &mut s.pollution_hist,
        ];
        for (a, arr) in arrays.into_iter().enumerate() {
            for (i, v) in arr.iter_mut().enumerate().take(240) {
                *v = ((i as i32 * (37 + a as i32 * 11)) % 301 - 50) as i16;
            }
        }
    }
    for t in -1..=6 {
        for sc in -1..=2 {
            for idx in [-1, 0, 5, 119, 120, 239, 240] {
                out.push(format!(
                    "GET {t} {sc} {idx} = {}",
                    s.get_history(t, sc, idx)
                ));
            }
        }
    }
    for t in -1..=6 {
        for sc in -1..=2 {
            let (mn, mx) = s.get_history_range(t, sc);
            out.push(format!("RANGE {t} {sc} = {mn} {mx}"));
        }
    }
    s.set_history(3, 1, 7, 1234);
    s.set_history(0, 0, 119, -5);
    s.set_history(0, 0, 120, 9);
    s.set_history(9, 0, 1, 77);
    out.push(format!(
        "SET money-long7={} res-short119={} bad={}",
        s.get_history(3, 1, 7),
        s.get_history(0, 0, 119),
        s.get_history(9, 0, 1)
    ));
    s.change_census();
    s.graph_doer();
    drain(&mut s, &mut out);
    s.graph_doer();
    drain(&mut s, &mut out);
    out.push("GRAPH-DOER done".to_string());

    // ---- map accessors ----
    s.set_tile(3, 4, 0x1234);
    out.push(format!(
        "TILE get(-1,0)={} get(0,0)={} get(3,4)={}",
        s.get_tile(-1, 0),
        s.get_tile(0, 0),
        s.get_tile(3, 4)
    ));
    s.set_tile(120, 0, 5);
    out.push(format!(
        "TILE off-map set ignored get(120,0)={}",
        s.get_tile(120, 0)
    ));
    s.set_power_grid(5, 7, 300);
    out.push(format!(
        "POWER {} {} {}",
        s.get_power_grid(5, 7),
        s.get_power_grid(-1, 0),
        s.get_power_grid(119, 99)
    ));
    s.set_power_grid(119, 99, 9);
    out.push(format!("POWER-set {}", s.get_power_grid(119, 99)));
    s.set_population_density(3, 4, 300);
    s.set_population_density(-1, 0, 5);
    out.push(format!(
        "POPDENS {} {} {}",
        s.get_population_density_at(3, 4),
        s.get_population_density_at(-1, 0),
        s.get_population_density_at(59, 49)
    ));
    s.set_rate_of_growth(3, 4, 70000);
    s.set_rate_of_growth(15, 0, 1);
    out.push(format!(
        "ROG {} {}",
        s.get_rate_of_growth(3, 4),
        s.get_rate_of_growth(15, 0)
    ));
    s.set_traffic_density(3, 4, 255);
    s.set_traffic_density(2, 2, 256);
    out.push(format!(
        "TRAF {} {} {}",
        s.get_traffic_density(3, 4),
        s.get_traffic_density(2, 2),
        s.get_traffic_density(-2, 0)
    ));
    s.set_pollution_density(3, 4, 201);
    s.set_pollution_density(60, 0, 3);
    out.push(format!(
        "POLL {} {}",
        s.get_pollution_density(3, 4),
        s.get_pollution_density(60, 0)
    ));
    s.set_crime_rate(3, 4, 99);
    s.set_crime_rate(1, -1, 4);
    out.push(format!(
        "CRIME {} {}",
        s.get_crime_rate(3, 4),
        s.get_crime_rate(1, -1)
    ));
    s.set_land_value(3, 4, 150);
    s.set_land_value(3, 4, 1000);
    out.push(format!(
        "LAND {} {}",
        s.get_land_value(3, 4),
        s.get_land_value(-1, -1)
    ));
    s.set_fire_coverage(3, 4, 70000);
    s.set_fire_coverage(14, 12, -33);
    out.push(format!(
        "FIRE {} {}",
        s.get_fire_coverage(3, 4),
        s.get_fire_coverage(14, 12)
    ));
    s.set_police_coverage(3, 4, -70000);
    s.set_police_coverage(15, 0, 2);
    out.push(format!(
        "POLICE {} {}",
        s.get_police_coverage(3, 4),
        s.get_police_coverage(15, 0)
    ));

    // ---- invalidateMaps, sounds, notifications ----
    s.map_serial = 1;
    s.invalidate_maps();
    drain(&mut s, &mut out);
    out.push(format!("MAPSERIAL {}", s.map_serial));
    s.make_sound("city", "Siren", 3, 4); // sound disabled: nothing
    s.enable_sound = true;
    s.make_sound("city", "Siren", 3, 4);
    s.make_sound("city", "Monster", -1, -1);
    s.do_earthquake(5);
    drain(&mut s, &mut out);
    s.enable_sound = false;
    s.do_earthquake(6);
    drain(&mut s, &mut out);
    s.enable_sound = true;
    s.do_auto_goto(10, 20);
    s.do_lose_game();
    s.do_win_game();
    s.do_new_game();
    drain(&mut s, &mut out);
    out.push("NOTIFY done".to_string());

    // ---- sendMessages over the 64-step cycle (checkGrowth skipped: t & 3 != 0) ----
    for preset in 0..=5 {
        set_census(&mut s, preset);
        out.push(format!("PRESET {preset}"));
        for t in 1..=255i64 {
            if t & 3 == 0 {
                continue;
            }
            s.city_time = t;
            s.send_messages();
            drain(&mut s, &mut out);
        }
        out.push(format!(
            "S2 res={} com={} ind={} resCap={} comCap={} indCap={} totalZone={} scoreWait={}",
            s.res_pop,
            s.com_pop,
            s.ind_pop,
            s.res_cap as i32,
            s.com_cap as i32,
            s.ind_cap as i32,
            s.total_zone_pop,
            s.score_wait
        ));
    }

    // ---- doScenarioScore for every scenario and outcome ----
    for sc in 1..=8 {
        for cls in 0..=5u8 {
            for traffic in [79i16, 80] {
                for crime in [59i16, 60] {
                    for score in [500i16, 501] {
                        s.city_class = class_of(cls);
                        s.traffic_average = traffic;
                        s.crime_average = crime;
                        s.city_score = score;
                        out.push(format!(
                            "SCORE sc={sc} cls={cls} traf={traffic} crime={crime} score={score}"
                        ));
                        s.do_scenario_score(scenario_of(sc));
                        drain(&mut s, &mut out);
                    }
                }
            }
        }
    }

    // ---- doMakeSound (draws from the generator) ----
    s.enable_sound = true;
    let msgs = [1i32, 12, 11, 20, 21, 22, 23, 24, 25, 26, 27, 30, 43, 44, 40];
    for seed in [1i32, 777, 123_456] {
        for msg in msgs {
            s.rng.seed(seed);
            out.push(format!("MSND seed={seed} msg={msg}"));
            s.do_make_sound(msg, 5, -1);
            drain(&mut s, &mut out);
        }
    }
    out
}

#[test]
fn misc_events_match_original_engine() {
    let expected: Vec<&str> = include_str!("../../../reference/gold/misc_events.out")
        .lines()
        .collect();
    let got = run();
    for (i, (g, e)) in got.iter().zip(expected.iter()).enumerate() {
        assert_eq!(g, e, "first difference at line {}", i + 1);
    }
    assert_eq!(got.len(), expected.len(), "number of lines");
}
