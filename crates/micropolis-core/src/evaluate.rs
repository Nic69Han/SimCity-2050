//! Port of `evaluate.cpp` — city evaluation: population and class, assessed
//! value, problem severities, the vote on problems, the score and the mayor's
//! approval rating.
//!
//! Numeric fidelity: the C++ mixes `short`, `int`, `long` (`Quad`), `float`
//! and `double`. Every promotion and every truncating conversion is kept at the
//! same point as in the original (see the comments on each function). Float to
//! integer conversions use [`c_f32_to_i32`] / [`c_f32_to_i16`], which reproduce
//! what x86-64 code does for an out-of-range value instead of saturating.
//!
//! Deliberate divergence: `voteProblems` in the C++ runs one slot past the end
//! of `problemTable` / `problemVotes` (`problem` reaches `PROBNUM`, the check
//! is `problem > PROBNUM`). Reading that slot is undefined behaviour: in the
//! original build the value is whatever is on the stack, and it was non-zero in
//! most random states, so the original's votes differ. Here the slot's
//! threshold is 0 and it can never receive a vote. The random number is still
//! drawn for it at every attempt, so the number of draws per attempt is the
//! same. The golden tests use an oracle whose `cityEvaluation` has a zeroed
//! slot (`reference/gold/build-fixed-oracle.sh`).

use crate::simulation::{
    CityClass, Simulation, CVP_PROBLEM_COMPLAINTS, MAX_FIRE_STATION_EFFECT,
    MAX_POLICE_STATION_EFFECT, MAX_ROAD_EFFECT, PROBNUM,
};

/// `CVP_NUMPROBLEMS`: number of problem kinds, also the "no problem" marker.
pub const CVP_NUMPROBLEMS: i16 = 7;
pub const CVP_CRIME: usize = 0;
pub const CVP_POLLUTION: usize = 1;
pub const CVP_HOUSING: usize = 2;
pub const CVP_TAXES: usize = 3;
pub const CVP_TRAFFIC: usize = 4;
pub const CVP_UNEMPLOYMENT: usize = 5;
pub const CVP_FIRE: usize = 6;

/// `(int)f` for a `float` on x86-64: out of range and NaN give `INT_MIN`.
pub fn c_f32_to_i32(f: f32) -> i32 {
    if !(-2_147_483_648.0..2_147_483_648.0).contains(&f) {
        i32::MIN
    } else {
        f as i32
    }
}

/// `(short)f` for a `float` as GCC compiles it on x86-64: convert to 32 bits
/// first, then keep the low 16 bits.
pub fn c_f32_to_i16(f: f32) -> i16 {
    c_f32_to_i32(f) as i16
}

/// `(int)d` for a `double` on x86-64 (same convention as [`c_f32_to_i32`]).
fn c_f64_to_i32(d: f64) -> i32 {
    if !(-2_147_483_648.0..2_147_483_648.0).contains(&d) {
        i32::MIN
    } else {
        d as i32
    }
}

/// `clamp()` from `micropolis.h`.
fn clamp<T: PartialOrd>(val: T, lower: T, upper: T) -> T {
    if val < lower {
        lower
    } else if val > upper {
        upper
    } else {
        val
    }
}

/// `getCityClass`: classification from the population (thresholds are strict).
pub fn city_class_for_population(city_population: i64) -> CityClass {
    let mut class = CityClass::Village;
    if city_population > 2000 {
        class = CityClass::Town;
    }
    if city_population > 10_000 {
        class = CityClass::City;
    }
    if city_population > 50_000 {
        class = CityClass::Capital;
    }
    if city_population > 100_000 {
        class = CityClass::Metropolis;
    }
    if city_population > 500_000 {
        class = CityClass::Megalopolis;
    }
    class
}

/// Severity of unemployment from the residential and job populations.
///
/// `short b = (comPop + indPop) * 8` truncates to 16 bits, and the float to
/// short conversion is done as in the original.
pub fn unemployment_severity(res_pop: i16, com_pop: i16, ind_pop: i16) -> i16 {
    let mut b = ((com_pop as i32 + ind_pop as i32) * 8) as i16;
    if b == 0 {
        return 0;
    }
    // Ratio total people / working.
    let r = (res_pop as f32) / (b as f32);
    b = c_f32_to_i16((r - 1.0) * 255.0);
    b.min(255)
}

/// Severity of fire from the fire-station-covered population.
pub fn fire_severity(fire_pop: i16) -> i16 {
    (fire_pop as i32 * 5).min(255) as i16
}

/// Inputs of the score formula in `getScore`, gathered from the simulator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScoreInputs {
    pub res_cap: bool,
    pub com_cap: bool,
    pub ind_cap: bool,
    pub road_effect: i32,
    pub police_effect: i32,
    pub fire_effect: i32,
    pub res_valve: i16,
    pub com_valve: i16,
    pub ind_valve: i16,
    pub city_pop: i64,
    pub city_pop_delta: i64,
    pub city_tax: i16,
    /// `getFireSeverity()` for the current fire population.
    pub fire_severity: i16,
    pub powered_zone_count: i16,
    pub unpowered_zone_count: i16,
}

/// The score value `z` of `getScore`, in `0..=1000`, before it is averaged
/// with the previous score. Pure: depends only on its arguments.
pub fn score_value(problem_table: &[i16; PROBNUM], s: &ScoreInputs) -> i32 {
    // add the 7 problems, then "7 + 2 average" (the division by 3 is intended)
    let mut x: i32 = 0;
    for &p in problem_table.iter().take(CVP_NUMPROBLEMS as usize) {
        x += p as i32;
    }
    x /= 3;
    x = x.min(256);

    let mut z = clamp((256 - x) * 4, 0, 1000);

    if s.res_cap {
        z = c_f64_to_i32(z as f64 * 0.85);
    }
    if s.com_cap {
        z = c_f64_to_i32(z as f64 * 0.85);
    }
    if s.ind_cap {
        z = c_f64_to_i32(z as f64 * 0.85);
    }

    if s.road_effect < MAX_ROAD_EFFECT {
        z -= MAX_ROAD_EFFECT - s.road_effect;
    }

    if s.police_effect < MAX_POLICE_STATION_EFFECT {
        // 10.0001 = 10000.1 / 1000, 1/10.0001 is about 0.1
        let f = 0.9 + (s.police_effect as f64 / (10.0001 * MAX_POLICE_STATION_EFFECT as f64));
        z = c_f64_to_i32(z as f64 * f);
    }

    if s.fire_effect < MAX_FIRE_STATION_EFFECT {
        let f = 0.9 + (s.fire_effect as f64 / (10.0001 * MAX_FIRE_STATION_EFFECT as f64));
        z = c_f64_to_i32(z as f64 * f);
    }

    if s.res_valve < -1000 {
        z = c_f64_to_i32(z as f64 * 0.85);
    }
    if s.com_valve < -1000 {
        z = c_f64_to_i32(z as f64 * 0.85);
    }
    if s.ind_valve < -1000 {
        z = c_f64_to_i32(z as f64 * 0.85);
    }

    // Population change factor, in single precision as in the original.
    let sm: f32 = if s.city_pop == 0
        || s.city_pop_delta == 0 // nobody, or no migration happened
        || s.city_pop_delta == s.city_pop
    // city sprang into existence or doubled in size
    {
        1.0
    } else if s.city_pop_delta > 0 {
        ((s.city_pop_delta as f32) / (s.city_pop as f32)) + 1.0
    } else if s.city_pop_delta < 0 {
        0.95 + ((s.city_pop_delta as f32) / ((s.city_pop - s.city_pop_delta) as f32))
    } else {
        1.0
    };

    z = c_f32_to_i32((z as f32) * sm);
    // dec score for fires and taxes
    z = z - s.fire_severity as i32 - s.city_tax as i32;

    // dec score for unpowered zones
    let tm = (s.unpowered_zone_count as i32 + s.powered_zone_count as i32) as f32;
    if tm > 0.0 {
        let ratio = (s.powered_zone_count as f32) / tm;
        z = c_f32_to_i32((z as f32) * ratio);
    }

    clamp(z, 0, 1000)
}

impl Simulation {
    /// `cityEvaluation`: evaluate the city, or reset it if it is empty.
    pub fn city_evaluation(&mut self) {
        if self.total_pop > 0 {
            let mut problem_table = [0i16; PROBNUM];
            self.get_assessed_value();
            self.do_pop_num();
            self.do_problems(&mut problem_table);
            self.get_score(&problem_table);
            self.do_votes(); // How well is the mayor doing?
            self.change_eval();
        } else {
            self.eval_init();
            self.city_yes = 50; // No population => no voting. Let's say 50/50.
            self.change_eval();
        }
    }

    /// `evalInit`: reset the evaluation variables.
    pub fn eval_init(&mut self) {
        self.city_yes = 0;
        self.city_pop = 0;
        self.city_pop_delta = 0;
        self.city_assessed_value = 0;
        self.city_class = CityClass::Village;
        self.city_score = 500;
        self.city_score_delta = 0;
        self.problem_votes = [0; PROBNUM];
        self.problem_order = [CVP_NUMPROBLEMS; CVP_PROBLEM_COMPLAINTS];
    }

    /// `getAssessedValue`: total value of the city's infrastructure, in
    /// thousands of dollars times 1000.
    pub fn get_assessed_value(&mut self) {
        let mut z: i64 = self.road_total as i64 * 5;
        z += self.rail_total as i64 * 10;
        z += self.police_station_pop as i64 * 1000;
        z += self.fire_station_pop as i64 * 1000;
        z += self.hospital_pop as i64 * 400;
        z += self.stadium_pop as i64 * 3000;
        z += self.seaport_pop as i64 * 5000;
        z += self.airport_pop as i64 * 10000;
        z += self.coal_power_pop as i64 * 3000;
        z += self.nuclear_power_pop as i64 * 6000;
        self.city_assessed_value = z * 1000;
    }

    /// `doPopNum`: population, its change, and the city class.
    pub fn do_pop_num(&mut self) {
        let mut old_city_pop = self.city_pop;
        self.city_pop = self.get_population();
        if old_city_pop == -1 {
            old_city_pop = self.city_pop;
        }
        self.city_pop_delta = self.city_pop - old_city_pop;
        self.city_class = self.get_city_class(self.city_pop);
    }

    /// `getPopulation`: residents plus eight times the workers, times 20.
    pub fn get_population(&self) -> i64 {
        (self.res_pop as i64 + (self.com_pop as i64 + self.ind_pop as i64) * 8) * 20
    }

    /// `getCityClass`.
    pub fn get_city_class(&self, city_population: i64) -> CityClass {
        city_class_for_population(city_population)
    }

    /// `doProblems`: severity of every problem, the vote, and the ordering of
    /// the worst problems (`problem_order`).
    pub fn do_problems(&mut self, problem_table: &mut [i16; PROBNUM]) {
        let mut problem_taken = [false; PROBNUM];
        *problem_table = [0; PROBNUM];

        problem_table[CVP_CRIME] = self.crime_average;
        problem_table[CVP_POLLUTION] = self.pollution_average;
        problem_table[CVP_HOUSING] = ((self.land_value_average as i32) * 7 / 10) as i16;
        problem_table[CVP_TAXES] = ((self.city_tax as i32) * 10) as i16;
        problem_table[CVP_TRAFFIC] = self.get_traffic_average();
        problem_table[CVP_UNEMPLOYMENT] = self.get_unemployment();
        problem_table[CVP_FIRE] = self.get_fire_severity();
        self.vote_problems(problem_table);

        for z in 0..CVP_PROBLEM_COMPLAINTS {
            // Find biggest problem not taken yet
            let mut max_votes: i16 = 0;
            let mut best_problem = CVP_NUMPROBLEMS;
            for (i, &votes) in self
                .problem_votes
                .iter()
                .enumerate()
                .take(CVP_NUMPROBLEMS as usize)
            {
                if votes > max_votes && !problem_taken[i] {
                    best_problem = i as i16;
                    max_votes = votes;
                }
            }
            // bestProblem == CVP_NUMPROBLEMS means no problem found
            self.problem_order[z] = best_problem;
            if best_problem < CVP_NUMPROBLEMS {
                problem_taken[best_problem as usize] = true;
            }
        }
    }

    /// `voteProblems`: 100 votes, each cast for a problem with probability
    /// `problemTable[p] / 300`, cycling over the problems for at most 600
    /// attempts. See the module documentation for the slot past the end.
    pub fn vote_problems(&mut self, problem_table: &[i16; PROBNUM]) {
        self.problem_votes = [0; PROBNUM];

        let mut problem: usize = 0; // Problem to vote for
        let mut vote_count = 0; // Number of votes
        let mut loop_count = 0; // Number of attempts
        while vote_count < 100 && loop_count < 600 {
            // Slot PROBNUM is out of bounds in the original (undefined value);
            // it counts as threshold 0 here, so it never receives a vote.
            let threshold = problem_table.get(problem).copied().unwrap_or(0);
            if (self.rng.random(300) as i32) < threshold as i32 {
                if problem < PROBNUM {
                    self.problem_votes[problem] += 1;
                }
                vote_count += 1;
            }
            problem += 1;
            if problem > PROBNUM {
                problem = 0;
            }
            loop_count += 1;
        }
    }

    /// `getTrafficAverage`: average traffic density where there is land value.
    pub fn get_traffic_average(&mut self) -> i16 {
        let mut traffic_total: i64 = 0;
        let mut count: i64 = 1;
        let (world_w, world_h) = self.world_size();
        let block = self.land_value_map.block_size();
        let mut x = 0;
        while x < world_w {
            let mut y = 0;
            while y < world_h {
                if self.land_value_map.world_get(x, y) > 0 {
                    traffic_total += self.traffic_density_map.world_get(x, y) as i64;
                    count += 1;
                }
                y += block;
            }
            x += block;
        }
        self.traffic_average = ((traffic_total / count) as f64 * 2.4) as i16;
        self.traffic_average
    }

    /// `getUnemployment`.
    pub fn get_unemployment(&self) -> i16 {
        unemployment_severity(self.res_pop, self.com_pop, self.ind_pop)
    }

    /// `getFireSeverity`.
    pub fn get_fire_severity(&self) -> i16 {
        fire_severity(self.fire_pop)
    }

    /// `getScore`: the score moves half-way towards the new value `z`.
    pub fn get_score(&mut self, problem_table: &[i16; PROBNUM]) {
        let city_score_last = self.city_score;
        let inputs = ScoreInputs {
            res_cap: self.res_cap,
            com_cap: self.com_cap,
            ind_cap: self.ind_cap,
            road_effect: self.road_effect,
            police_effect: self.police_effect,
            fire_effect: self.fire_effect,
            res_valve: self.res_valve,
            com_valve: self.com_valve,
            ind_valve: self.ind_valve,
            city_pop: self.city_pop,
            city_pop_delta: self.city_pop_delta,
            city_tax: self.city_tax,
            fire_severity: self.get_fire_severity(),
            powered_zone_count: self.powered_zone_count,
            unpowered_zone_count: self.unpowered_zone_count,
        };
        let z = score_value(problem_table, &inputs);

        self.city_score = (((self.city_score as i32) + z) / 2) as i16;
        self.city_score_delta = (self.city_score as i32 - city_score_last as i32) as i16;
    }

    /// `doVotes`: 100 citizens each vote yes with probability `cityScore / 1000`.
    pub fn do_votes(&mut self) {
        self.city_yes = 0;
        for _ in 0..100 {
            if (self.rng.random(1000) as i32) < self.city_score as i32 {
                self.city_yes += 1;
            }
        }
    }

    /// `doScoreCard`: only pushes the front-end score card, which has no
    /// counterpart in the core (the UI reads the raw values itself).
    pub fn do_score_card(&mut self) {}

    /// `changeEval`: ask for the evaluation to be shown again.
    pub fn change_eval(&mut self) {
        self.eval_changed = true;
    }

    /// `scoreDoer`: show the score card if it was requested.
    pub fn score_doer(&mut self) {
        if self.eval_changed {
            self.do_score_card();
            self.eval_changed = false;
        }
    }

    /// `countProblems`: number of entries of `problem_order` in use.
    pub fn count_problems(&self) -> i32 {
        for i in 0..CVP_PROBLEM_COMPLAINTS {
            if self.problem_order[i] == CVP_NUMPROBLEMS {
                return i as i32;
            }
        }
        CVP_PROBLEM_COMPLAINTS as i32
    }

    /// `getProblemNumber`: the `i`-th worst problem, or -1 if there is none.
    pub fn get_problem_number(&self, i: i32) -> i32 {
        if i < 0 || i >= CVP_PROBLEM_COMPLAINTS as i32 {
            return -1;
        }
        let p = self.problem_order[i as usize];
        if p == CVP_NUMPROBLEMS {
            -1
        } else {
            p as i32
        }
    }

    /// `getProblemVotes`: votes for the `i`-th worst problem, or -1.
    pub fn get_problem_votes(&self, i: i32) -> i32 {
        if i < 0 || i >= CVP_PROBLEM_COMPLAINTS as i32 {
            return -1;
        }
        let p = self.problem_order[i as usize];
        if p == CVP_NUMPROBLEMS {
            -1
        } else {
            self.problem_votes[p as usize] as i32
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn city_class_thresholds_are_strict() {
        assert_eq!(city_class_for_population(0), CityClass::Village);
        assert_eq!(city_class_for_population(2000), CityClass::Village);
        assert_eq!(city_class_for_population(2001), CityClass::Town);
        assert_eq!(city_class_for_population(10_000), CityClass::Town);
        assert_eq!(city_class_for_population(10_001), CityClass::City);
        assert_eq!(city_class_for_population(50_001), CityClass::Capital);
        assert_eq!(city_class_for_population(100_001), CityClass::Metropolis);
        assert_eq!(city_class_for_population(500_001), CityClass::Megalopolis);
    }

    #[test]
    fn float_conversions_follow_x86() {
        assert_eq!(c_f32_to_i16(35205.0), 35205u32 as i16);
        assert_eq!(c_f32_to_i16(1_018_245.0), -30331);
        assert_eq!(c_f32_to_i16(3.0e9), 0); // INT_MIN has no low bits
        assert_eq!(c_f32_to_i32(-7.9), -7);
    }
}
